import os
import io
import json
import base64
import logging
import time
from collections import defaultdict
import threading
from typing import List, Optional, Dict
from fastapi import FastAPI, File, UploadFile, Form, Header, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import fitz  # PyMuPDF
from PIL import Image
from google import genai
from google.genai import types
import openai
import anthropic

# ==================== 安全防護配置 ====================
MAX_UPLOAD_SIZE = 25 * 1024 * 1024       # 單一檔案最大 25MB
MAX_REQUEST_SIZE = 50 * 1024 * 1024      # 整體請求最大 50MB
MAX_UPLOAD_FILES_COUNT = 10              # 單次請求最多上傳 10 個檔案
MAX_PDF_PAGES_ANALYZE = 30               # PDF 解析最多取前 30 頁
MAX_PDF_TOTAL_PAGES = 150                # 拒絕超過 150 頁的巨大 PDF 防止 DoS

# 是否允許伺服器端環境變數 API Key 兜底（預設關閉，嚴格實行 BYOK 防止未授權調用耗盡伺服器額度）
ALLOW_SERVER_ENV_KEYS = os.environ.get("ALLOW_SERVER_ENV_KEYS", "false").lower() in ("true", "1", "yes")

# CORS 網域白名單配置
DEFAULT_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://gyuyu2002-jeff.github.io"
]
custom_origins = os.environ.get("ALLOWED_ORIGINS", "")
if custom_origins.strip() == "*":
    ALLOWED_ORIGINS = ["*"]
    ALLOW_CREDENTIALS = False
elif custom_origins.strip():
    ALLOWED_ORIGINS = [orig.strip() for orig in custom_origins.split(",") if orig.strip()]
    ALLOW_CREDENTIALS = True
else:
    ALLOWED_ORIGINS = DEFAULT_ORIGINS
    ALLOW_CREDENTIALS = True

# 設置日誌（嚴格過濾敏感資訊）
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("nblm-reverser")

# 記憶體限流器
class InMemoryRateLimiter:
    """輕量級線程安全滑動窗口限流器 (防止暴力猜測與阻斷服務攻擊)"""
    def __init__(self):
        self._records: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def is_allowed(self, client_id: str, max_requests: int, window_seconds: int = 60) -> bool:
        now = time.time()
        cutoff = now - window_seconds
        with self._lock:
            timestamps = [t for t in self._records[client_id] if t > cutoff]
            if len(timestamps) >= max_requests:
                self._records[client_id] = timestamps
                return False
            timestamps.append(now)
            self._records[client_id] = timestamps
            return True

rate_limiter = InMemoryRateLimiter()

def get_client_ip(request: Request) -> str:
    """安全取得客戶端真實 IP"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"

async def read_uploaded_file_safely(upload_file: UploadFile, max_bytes: int = MAX_UPLOAD_SIZE) -> bytes:
    """流式讀取上傳檔案，若超出大小立即中斷，防禦大檔案記憶體耗盡攻擊"""
    chunk_size = 1024 * 1024  # 1MB
    total = 0
    buf = io.BytesIO()
    while True:
        chunk = await upload_file.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"檔案「{upload_file.filename}」大小超過限制 ({max_bytes // (1024 * 1024)}MB)，已終止處理"
            )
        buf.write(chunk)
    return buf.getvalue()

app = FastAPI(
    title="NBLM Presentation Style Reverse-Engineer",
    description="簡報風格逆向工程與 NotebookLM 提示詞生成器",
    version="1.0.0"
)

# 註冊安全標頭與檔案大小檢查中間件
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > MAX_REQUEST_SIZE:
            return JSONResponse(
                status_code=413,
                content={"detail": f"上傳檔案總大小超出伺服器上限 ({MAX_REQUEST_SIZE // (1024 * 1024)}MB)"}
            )

        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        
        csp = (
            "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: "
            "https://fonts.googleapis.com https://fonts.gstatic.com "
            "https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
            "img-src 'self' data: blob: https:; "
            "connect-src 'self' https: http:;"
        )
        response.headers["Content-Security-Policy"] = csp
        return response

app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# 系統逆向工程 Prompt (真確幾何骨架與視覺還原專用引擎 - 零幻覺標準)
SYSTEM_INSTRUCTION = """
你是一位世界頂級的簡報視覺逆向架構師（Presentation Layout Reverse-Engineer）與幾何排版專家。
你的使命是【像素級與拓撲級真實還原】使用者上傳的簡報範例（PDF、PPTX 或投影片截圖），徹底洞察其「真實幾何骨架、容器填色極性（空心描邊 vs 實心色塊 vs 無外框）、畫布材質紋理、多色輪替序列、連接線幾何型態、塗鴉/插畫解剖細節與色彩系統」，並轉譯為能 100% 忠實對齊的 NotebookLM 專用提示詞與排版設計規範。

⚠️【最高原則：實事求是、真確還原（True-to-Source Visual Fidelity）】：
1. 🎨【100% 忠實提取畫布材質、色彩與多色輪替規範】：
   - 仔細觀察畫布底色與表面幾何肌理：
     - 若為「橫格線筆記本紙張（Ruled Notebook Paper，如 #F5F4EF）」，必須明確標註『全篇維持等距水平淺灰橫格線與左側單條垂直邊界線，🚫 嚴禁替換為皺摺牛皮紙、髒舊噴濺墨點，🚫 嚴禁在標題四角添加無關的 L 型直角框線（┌ ┘）』！
     - 若為「深色黑板材質（Chalkboard，如 #191A1D）」，必須標註『深炭灰黑板底色配白粉筆擦拭微肌理』。
     - 若為「商務暖象牙米灰（#F4F3EE）」或深海軍藍，精準給出 HEX 色碼，嚴禁死白或刺眼高飽和螢光檸檬黃。
   - ★【多色輪替鐵律 (Multi-Color Cycling)】：若原圖擁有多種粉彩/強調色（例如：柔粉紅、薄荷青綠、柔和黃、蜜桃橘、晴空藍），在提示詞中必須強制規定『同一頁面的並列欄位、對話框或標題筆刷，必須依序輪替不同色相（如：欄1粉紅 ➔ 欄2薄荷綠 ➔ 欄3柔黃 ➔ 欄4粉藍），🚫 絕對嚴禁整頁所有欄位偷懶重複塗成同一種顏色』！
   - ★【高光部位精準鎖定 (Highlight Placement Lock)】：必須清楚區分高光是『僅墊於區塊小標題（Sub-heading）下方的螢光筆刷色帶（🚫 嚴禁在下方內文段落亂塗螢光筆）』，還是『長句中特定 2~3 個關鍵字詞直接變換粉筆字色（行內變色，不加底色塊）』！

2. 📐【容器填色極性與邊框解剖（★關鍵抗失真核心，嚴禁混淆空心與實心！）】：
   - 必須逐頁精準鑑定每種容器與箭頭的「填色極性（Fill Polarity）」，並在提示詞中寫死：
     - **(A) 空心手繪描邊容器 (Hollow Outline / No-Fill)**：如黑板上的粉彩手繪對話框（Speech Bubbles）、雲朵思維框（Thought Clouds）、手繪空心粗箭頭，必須強制寫明『內部完全無填色（直接透出畫布底色），僅外圍使用雙線/單線彩色描邊，框內文字為純白或純黑高對比字；🚫 絕對嚴禁將空心對話框或空心雲朵塗滿實心色塊！』
     - **(B) 無外框純筆刷底條欄位 (Borderless Columns)**：若原圖的 3 欄或 4 欄排版僅在小標題下方墊有彩色螢光筆刷，欄位四周無外框、欄位之間無分隔線，必須強制寫明『欄位外圍完全無框線、欄位之間無垂直/十字格線；🚫 絕對嚴禁自行加上黑色矩形外框或十字分隔線！』
     - **(C) 獨立線框卡片 / 實心標籤 (Framed Cards / Solid Pills)**：僅在原圖確實有手繪黑線矩形框（如比較表 4 欄黑框）或實心黑色膠囊標籤（如 STAGE 01）時，才指定繪製外框或實心填色。

3. 🔗【機械級拓撲與連接線幾何保真（★嚴禁將圖解退化為圓點清單或走樣曲線！）】：
   - ★【時間軸與連接線幾何型態】：必須精確區分『單條 90 度直角水平垂直轉折之階梯折線箭頭（Orthogonal Stepped Arrow Line ┌─┐）』與『波浪曲線』！若原圖為直角階梯折線（如 STAGE 01~05 上下交錯階梯折線），必須明文規定『🚫 絕對嚴禁畫成雙股麻花交叉波浪線（Figure-8 Wave）或圓弧線』！
   - ★【大括號、文氏圖與中心放射心智圖】：若有手繪大括號 { }、3 環交疊文氏圖（左文右圖）、中央人物向左右發射 6 支空心粗箭頭心智圖、45 度引線（Leader Lines），必須完整描述其幾何方位、節點數量（Step-Count 1:1 守恆）與箭頭空心/實心屬性。
   - ★【塗鴉小人與裝飾解剖】：若原圖包含手繪塗鴉小人（Stick Figures），必須指明『純黑單線條空心極簡小人（軀幹內部完全留白透明，🚫 嚴禁將身體塗黑或填滿雜亂黑線，🚫 嚴禁改為美式卡通人物）』，並精確列出手勢動作（如：舉手指亮燈泡、雙人看地圖、搬運高疊書籍、白板討論、多人圓桌開會）。

4. 🔤【封面與全篇文字零亂碼鐵律（Zero-Gibberish & Exact Text Lock）】：
   - 在產出的 NotebookLM 提示詞中，必須強制加入：
     『🚫【絕對文字潔淨與零亂碼鐵律】：投影片畫面中的所有文字必須 100% 為清晰正確的繁體中文或指定英文，嚴格取自提示詞文案！絕對嚴禁在封面主標題下方、角落或插畫旁自行捏造無意義的偽漢字、湊字數亂碼詞彙或假字塗鴉！主標題保持單行或指定雙行清晰呈現，未指定署名時嚴禁自行添加對話框署名。』
   - 🚫 除非來源筆記具備明確數據，否則嚴禁無中生有編造巨型 KPI 統計大數字。

請以繁體中文（台灣習慣用語）輸出以下結構化報告：

# 🎨 簡報風格精準逆向報告

## 1. 逐頁版面拓撲與幾何骨架 (Slide-by-Slide Topology)
[對上傳的每頁投影片進行精準幾何拆解，忠實對應上傳內容之真實細節]
- **第 1 頁拓撲**：
  - 畫布背景與材質：(精確描述底色 HEX、紙張橫格線/黑板粉筆肌理與負向禁令)
  - 容器與幾何裝飾：(詳細指認容器是「空心雙線描邊無填色」、「無外框純筆刷底條」還是「實心色塊」，以及箭頭/折線/塗鴉小人動作與空心屬性)
  - 文字層級與排版：(字體風格、字重、顏色對比、高光部位與對齊方式)
(若有更多頁面，請依序逐頁精確拆解)

## 2. 精確設計系統規範 (Design System)
- **色彩系統 (Exact Hex Palette)**：
  - 畫布背景色：#XXXXXX (精準提取底色與紋理)
  - 主文字與線條色：#XXXXXX (主要標題與手繪線條色)
  - 核心強調色盤 (Accents)：列出所有提取到的強調色 HEX、名稱與各自負責的視覺部位（如：薄荷綠 #7FE3C0 負責空心雲朵框、柔粉紅 #F7A8B8 負責大括號與對話框等）
- **容器填色與邊框規則**：明確定義對話框/雲朵/卡片/箭頭是「空心無填色描邊」、「無外框僅標題筆刷」或「實心填色」
- **字型與排印層級**：標題字重、區塊小標題筆刷規則、內文字距與行內高光方式
- **幾何與插畫語法**：連接線型態（直角階梯折線 vs 放射箭頭）、大括號規格、塗鴉小人與符號庫

## 3. 📋 NotebookLM 專用簡報提示詞 (二合一雙模式輸出)
> 請同時提供以下兩種模式的完整 Markdown 代碼區塊，讓使用者在前端一鍵自由切換：

### 模式 1：全域風格架構（推薦：彈性 3~20 頁，提取整份色彩、字型、標誌裝飾與版型庫，任意筆記皆可直接套用）
```markdown
【任務宣告】：
請嚴格依據我上傳的筆記來源（Sources），提取關鍵事實與洞察，為我規劃一份結構嚴謹、視覺平衡的專業簡報內容。
（總頁數由您根據筆記內容深度自行裁量，建議 3~20 頁均可，每頁皆須嚴格遵循下列風格規範）

【🎨 全域視覺風格與材質鎖定規範 (Visual Style & Material Lock)】：
1. 畫布底色與表面紋理：[精準填入底色 HEX 與紋理，並加上負向禁令，例如：禁止皺摺髒紙、禁止噴濺墨點、禁止四角 L 型框線]
2. 色彩系統與多色輪替鐵律：
   - 主文字與線條色：[HEX 與質感]
   - 強調色盤：[列出各強調色 HEX 與用途]
   - ★【跨欄多色輪替強制規則】：同一頁面的並列欄位、卡片標題筆刷或對話泡泡，必須依序輪替不同色相（如：粉紅 ➔ 薄荷綠 ➔ 柔黃 ➔ 晴空藍），🚫 絕對嚴禁整頁所有欄位偷懶塗成同一種顏色！
   - ★【高光部位鎖定】：[明確規定螢光筆刷僅墊於小標題下方（嚴禁塗抹於內文段落），或僅將關鍵字詞變換粉筆字色]
3. 容器填色極性與邊框鐵律（★關鍵防失真約束）：
   - [明確規定對話框/雲朵框/粗箭頭是否為「空心無填色描邊（內部直接透出畫布底色，🚫 嚴禁填滿實心色塊）」，以及多欄排版是否為「無外框、無垂直分隔線（🚫 嚴禁自行加黑框或十字線）」]
4. 插畫、連接線與字體規範：
   - [明確規定塗鴉小人是否為「純黑單線條空心小人（身體內部留白不塗黑）」、時間軸是否為「90度直角階梯折線箭頭（🚫 嚴禁畫成雙股麻花波浪線）」、字體風格]

【🔤 絕對文字潔淨與零亂碼鐵律（Zero-Gibberish & Exact Text Lock）】：
1. 投影片畫面中的所有文字必須 100% 為清晰正確的文字，嚴格取自下方規劃之簡報文案！
2. 🚫 絕對嚴禁在封面主標題下方、角落或插畫旁自行捏造無意義的偽漢字、湊字數亂碼詞彙或假字塗鴉！
3. 🚫 嚴禁將提示詞中的版型代號、色碼（#XXXXXX）或字數限制印在投影片畫面上！

【🚫 頁面版型零重複最高約束（Layout Diversity & Zero-Repetition Rule）】：
1. 每一頁呈現絕不重複：產出的投影片內容中，相鄰頁面【絕對嚴禁】套用相同版型；整份簡報中，每一個頁面都必須從下方【版型語法庫】挑選截然不同的視覺拓撲結構動態輪替！
2. 強制動態輪替：即便相鄰頁面的主題或內容量相似，也必須強制變換幾何插槽與視覺呈現載體，徹底杜絕千篇一律的卡片或條列式視覺疲乏！

【✂️ 簡報文字密度防爆預算（維持呼吸感，嚴禁散文段落）】：
1. 嚴格溯源：所有內容必須 100% 源自來源筆記，嚴禁添加未提及的外部推論。
2. 字數限制：
   - 投影片主標題：限定 8~14 字（結論先行，單行清晰呈現）。
   - 副標題/導言：限定 15~25 字。
   - 區塊/卡片標題：限定 4~8 字。
   - 條列要點：每條限定 12~20 字（每欄/每卡片最多 2~3 點）。
3. 🚫 負向排除：除非來源筆記中具備明確統計數據，否則【絕對嚴禁】無中生有編造巨型 KPI 統計大數字。

【📐 專屬版型語法庫（提取自原稿各頁真實幾何拓撲，請依內容屬性動態輪替選用）】：
- [版型 A：...]：(詳述該版型之空心/實心容器屬性、欄位無框/有框規格、箭頭指向、塗鴉小人動作與色彩輪替順序)
- [版型 B：...]：(...)
- [版型 C：...]：(...)
- [版型 D：...]：(...)
- [版型 E：...]：(...)
(請將原投影片中所有獨特頁面的版型完整提煉出來，越精確具體越好)

【逐頁簡報內容輸出格式（請依此格式逐頁輸出）】：
---
### 第 X 頁：[頁面主題]（採用版型：[A/B/C/D/E...]，★嚴格約束：版型絕不與前述任何頁面重複）
- 【🎨 視覺與幾何鎖定配置】：(明確指定該頁底色紋理、容器空心/實心屬性、有無外框、多色輪替順序與插畫動作)
- 【📝 簡報文案內容】：
  - 主標題：...
  - 核心重點：（依選定版型填寫各插槽文案，嚴格遵守字數限制與零亂碼鐵律）
```

### 模式 2：逐頁 1:1 對比（適合想要 100% 像素級還原特定投影片的嚴格填寫）
```markdown
【任務宣告】：
請嚴格依據我上傳的筆記來源（Sources），提取關鍵事實與洞察，將筆記內容忠實填寫入下列【逐頁 1:1 投影片排版與文案架構】中。
（總頁數由您根據筆記內容深度自行裁量，建議 3~20 頁均可，每頁皆須嚴格遵循下列風格規範）

【🛡️ 全域抗失真與文字潔淨最高鐵律】：
1. 畫布底色與紋理鎖定：[精確填入原稿底色 HEX 與背景格線/黑板紋理，附上負向禁令]
2. 容器空心/實心與邊框鎖定：[明確規定哪些容器必須為「空心無填色描邊」、哪些欄位「完全無外框與分隔線」、哪些標籤為「實心填色」]
3. 多色輪替與高光部位鎖定：[明確規定各欄色彩輪替順序，以及螢光筆刷/粉筆變色的精確部位]
4. 🔤 零亂碼與文字密度防爆預算：所有文字 100% 源自來源筆記（主標題 8~14 字、副標題 15~25 字、區塊標題 4~8 字、條列 12~20 字）。🚫 絕對嚴禁在封面標題下方或插畫旁捏造無意義的偽漢字或湊字數亂碼！🚫 嚴禁無中生有編造巨型 KPI 數字！

【逐頁 1:1 簡報排版與文案架構（對應原稿各頁）】：
(請嚴格根據實際辨識到的各頁真實視覺特徵逐頁輸出，範例如下：)

---
### 投影片 1：[頁面類型，如：封面主視覺頁]
【🎨 視覺風格與幾何鎖定配置】：
- 畫布背景：[精確填入該頁底色與紋理，含負向禁令]
- 容器與核心裝飾：[精確指定空心/實心屬性、位置、顏色 HEX、塗鴉或插畫動作]
- 字體與高光排印：[字體風格、字色對比、高光位置，強制單一清晰主標、嚴禁偽漢字亂碼]
【📝 簡報文案內容區】：
- 主標題：（提取筆記核心主題，結論先行，8~14字）
- 副標題/導言：（提取簡報核心定位，15~25字）

(請依序對應原簡報的第 2、3... N 頁，逐頁完整輸出每一頁的【🎨 視覺風格與幾何鎖定配置】（明確寫死空心/實心、有無外框、折線/箭頭幾何、多色輪替順序）與【📝 簡報文案內容區】)
```

## 4. 💻 1:1 還原之 HTML / Tailwind 投影片結構碼 (可直接複製使用)
```html
<!-- 完整、乾淨、可以直接在瀏覽器獨立運行的 HTML 代碼，包含 Tailwind CSS CDN 與內聯樣式，100% 忠實重現上述投影片的真實幾何圖解、空心/實心容器與版面 -->
```

---
最後，請務必附上下方的 JSON 區塊，提供前端色票與標籤展示（請確保 JSON 語法合法且欄位完整）：
```json
{
  "style_name": "精準風格中文名稱 (English Style Name)",
  "tags": ["核心視覺特徵1", "特徵2", "特徵3", "特徵4", "特徵5"],
  "palette": [
    {"role": "畫布背景", "hex": "#XXXXXX", "name": "精確顏色名稱"},
    {"role": "主要文字與線條", "hex": "#XXXXXX", "name": "精確顏色名稱"},
    {"role": "核心強調色 1", "hex": "#XXXXXX", "name": "精確顏色名稱"},
    {"role": "核心強調色 2", "hex": "#XXXXXX", "name": "精確顏色名稱"},
    {"role": "輔助強調色 3", "hex": "#XXXXXX", "name": "精確顏色名稱"},
    {"role": "輔助強調色 4", "hex": "#XXXXXX", "name": "精確顏色名稱"}
  ],
  "white_space_ratio": "65%",
  "density": "結構化圖解型"
}
```
"""


def get_system_instruction() -> str:
    """動態載入最新 guardrails.json 並將學習到的約束組裝入提示詞引擎"""
    base = SYSTEM_INSTRUCTION
    guardrails_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guardrails.json")
    if os.path.exists(guardrails_path):
        try:
            with open(guardrails_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            rules = data.get("rules", [])
            if rules:
                rule_lines = []
                for r in rules:
                    title = r.get("title", "").strip()
                    rule_body = r.get("rule", "").strip()
                    if title and rule_body:
                        rule_lines.append(f"   - ★【{title}】：{rule_body}")
                
                if rule_lines:
                    rules_block = "5. 🛡️【實證抗失真約束規範（來自真實 NotebookLM 閉環質檢自動更新）】:\n" + "\n".join(rule_lines)
                    if "5. 🛡️【實證抗失真約束規範" in base:
                        head, rest = base.split("5. 🛡️【實證抗失真約束規範", 1)
                        tail = rest.split("請以繁體中文（台灣習慣用語）輸出以下結構化報告：", 1)[1]
                        return head + rules_block + "\n\n請以繁體中文（台灣習慣用語）輸出以下結構化報告：" + tail
                    else:
                        return base + "\n\n" + rules_block
        except Exception as err:
            logger.warning(f"動態加載 guardrails.json 失敗: {err}")
    return base


from pptx_handler import process_pptx_presentation

@app.post("/api/preview")
@app.post("/api/pdf-preview")
async def file_preview(request: Request, file: UploadFile = File(...)):
    """接收 PDF 或 PPTX 檔案，提取前 6 頁投影片縮圖給前端即時預覽（具備限流與記憶體安全防護）"""
    client_ip = get_client_ip(request)
    if not rate_limiter.is_allowed(f"preview:{client_ip}", max_requests=30, window_seconds=60):
        raise HTTPException(
            status_code=429,
            detail="預覽請求過於頻繁，請稍候 30 秒後再試（已觸發安全限流防護）。",
            headers={"Retry-After": "30"}
        )

    filename = file.filename.lower()
    if not (filename.endswith(".pdf") or filename.endswith(".pptx")):
        raise HTTPException(status_code=400, detail="預覽僅支援 PDF 或 PPTX 簡報檔案")
    
    try:
        content = await read_uploaded_file_safely(file, MAX_UPLOAD_SIZE)
        
        if filename.endswith(".pptx"):
            # 解析 PPTX 投影片與素材
            try:
                pptx_data = process_pptx_presentation(content)
            except ValueError as ve:
                raise HTTPException(status_code=400, detail=str(ve))

            return {
                "status": "success",
                "file_type": "pptx",
                "total_pages": pptx_data["total_slides"],
                "aspect_ratio": pptx_data["aspect_ratio"],
                "preview_pages": pptx_data["preview_pages"],
                "structure_summary": pptx_data["structure_summary"],
                "detected_fonts": pptx_data["detected_fonts"],
                "detected_colors": pptx_data["detected_colors"]
            }

        else:
            # 解析 PDF
            doc = None
            try:
                doc = fitz.open(stream=content, filetype="pdf")
                total_pages = len(doc)
                if total_pages > MAX_PDF_TOTAL_PAGES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"PDF 總頁數過多 ({total_pages} 頁，上限為 {MAX_PDF_TOTAL_PAGES} 頁)，請先擷取關鍵頁面上傳。"
                    )

                preview_pages = []
                max_preview = min(total_pages, 30)
                for i in range(max_preview):
                    page = doc.load_page(i)
                    page_text = page.get_text().strip()
                    pix = page.get_pixmap(dpi=120)
                    img_bytes = pix.tobytes("jpeg")
                    b64_str = base64.b64encode(img_bytes).decode("utf-8")
                    preview_pages.append({
                        "page": i + 1,
                        "image": f"data:image/jpeg;base64,{b64_str}",
                        "text": page_text
                    })
                
                return {
                    "status": "success",
                    "file_type": "pdf",
                    "total_pages": total_pages,
                    "preview_pages": preview_pages
                }
            finally:
                if doc is not None:
                    doc.close()

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("檔案預覽生成失敗")
        raise HTTPException(status_code=500, detail="檔案預覽處理失敗，請確認檔案格式是否正確或未損毀。")


def parse_selected_pages_str(pages_str: Optional[str]) -> Optional[set]:
    """解析使用者指定的頁碼字串，例如 '1, 3, 5-8' -> {1, 3, 5, 6, 7, 8}"""
    if not pages_str or not pages_str.strip():
        return None
    result = set()
    parts = pages_str.split(",")
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            try:
                start_s, end_s = part.split("-", 1)
                start = int(start_s.strip())
                end = int(end_s.strip())
                if 1 <= start <= end <= 300:
                    result.update(range(start, end + 1))
            except ValueError:
                continue
        else:
            try:
                num = int(part)
                if 1 <= num <= 300:
                    result.add(num)
            except ValueError:
                continue
    return result if result else None



@app.post("/api/crawl-preview")
async def crawl_preview(request: Request, source_url: str = Form(...)):
    """接收網址 (Google Slides, PDF, 線上簡報, 網頁)，爬取前 6 頁投影片縮圖給前端即時預覽"""
    client_ip = get_client_ip(request)
    if not rate_limiter.is_allowed(f"preview:{client_ip}", max_requests=30, window_seconds=60):
        raise HTTPException(
            status_code=429,
            detail="預覽請求過於頻繁，請稍候 30 秒後再試（已觸發安全限流防護）。",
            headers={"Retry-After": "30"}
        )

    from url_crawler import crawl_url_to_images, is_valid_url
    clean_url = source_url.strip()
    if not is_valid_url(clean_url):
        raise HTTPException(status_code=400, detail="請提供有效的 HTTP/HTTPS 網址")

    try:
        images = crawl_url_to_images(clean_url, limit=6)
        if not images:
            raise HTTPException(status_code=400, detail="無法從目標網址截取或解析出簡報影像")
        
        preview_pages = []
        for idx, (img_bytes, mime) in enumerate(images, start=1):
            b64 = base64.b64encode(img_bytes).decode("utf-8")
            data_uri = f"data:{mime};base64,{b64}"
            preview_pages.append({
                "page_number": idx,
                "data_uri": data_uri
            })

        return {
            "status": "success",
            "source_type": "url",
            "total_slides": len(images),
            "preview_pages": preview_pages
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"網址預覽爬取失敗: {e}")
        raise HTTPException(status_code=500, detail=f"網址爬取失敗: {str(e)}")


@app.post("/api/analyze")
async def analyze_style(
    request: Request,
    files: Optional[List[UploadFile]] = File(None),
    source_url: Optional[str] = Form(None),
    provider: str = Form("gemini"),
    model: str = Form("auto"),
    target_use: str = Form("notebooklm_slide"),
    selected_pages: Optional[str] = Form(None),
    x_api_key: Optional[str] = Header(None),
    x_gemini_api_key: Optional[str] = Header(None),
    x_openai_api_key: Optional[str] = Header(None),
    x_anthropic_api_key: Optional[str] = Header(None)
):
    """
    接收投影片檔案（PDF、PPTX 或圖片），
    支援 Google Gemini、OpenAI (GPT-4o)、Anthropic Claude (3.5 Sonnet) 進行多模態風格逆向工程。
    支援 selected_pages 參數挑選特定喜好頁面進行高精度解析。
    【資安核心】：API Key 僅於當次請求記憶體中使用，不留存於磁碟或日誌中，杜絕伺服器端金鑰盜用。
    """
    client_ip = get_client_ip(request)
    if not rate_limiter.is_allowed(f"analyze:{client_ip}", max_requests=15, window_seconds=60):
        raise HTTPException(
            status_code=429,
            detail="分析請求次數已達頻率上限，請稍候 60 秒後再試（已觸發安全限流保護）。",
            headers={"Retry-After": "60"}
        )

    provider = provider.lower()
    target_pages_set = parse_selected_pages_str(selected_pages)
    if target_pages_set:
        logger.info(f"使用者指定解析頁面: {sorted(list(target_pages_set))}")
    
    # 決定使用的 API Key（嚴格實施 BYOK 原則，關閉自動耗盡伺服器金鑰通道）
    client_key = ""
    if provider == "openai":
        client_key = x_api_key or x_openai_api_key or ""
        provider_name = "OpenAI"
        env_key = os.environ.get("OPENAI_API_KEY", "").strip() if ALLOW_SERVER_ENV_KEYS else ""
    elif provider == "anthropic":
        client_key = x_api_key or x_anthropic_api_key or ""
        provider_name = "Anthropic Claude"
        env_key = os.environ.get("ANTHROPIC_API_KEY", "").strip() if ALLOW_SERVER_ENV_KEYS else ""
    else:
        provider = "gemini"
        client_key = x_api_key or x_gemini_api_key or ""
        provider_name = "Google Gemini"
        env_key = os.environ.get("GEMINI_API_KEY", "").strip() if ALLOW_SERVER_ENV_KEYS else ""
    
    api_key = (client_key or "").strip()
    if not api_key and env_key:
        logger.info(f"使用伺服器環境變數 {provider_name} 金鑰（ALLOW_SERVER_ENV_KEYS 已啟用）")
        api_key = env_key

    if not api_key:
        raise HTTPException(
            status_code=401,
            detail=f"【未提供 {provider_name} API Key】為了保護資安與隱私，本系統遵循 BYOK (自備金鑰) 原則，不代墊伺服器端金鑰。請在右上角「設定 API Key」選擇 {provider_name} 並輸入您的專屬金鑰。"
        )

    if len(api_key) < 10 or "\n" in api_key or "\r" in api_key:
        raise HTTPException(
            status_code=400,
            detail=f"提供的 {provider_name} API Key 格式不合規，請確認未包含換行符或特殊空格。"
        )

    if not source_url and (not files or len(files) == 0):
        raise HTTPException(status_code=400, detail="請至少上傳一個 PDF/PPTX/圖片檔案，或提供簡報網址")

    if files and len(files) > MAX_UPLOAD_FILES_COUNT:
        raise HTTPException(status_code=400, detail=f"單次分析最多允許上傳 {MAX_UPLOAD_FILES_COUNT} 個檔案")

    # 統一收集圖像素材與投影片結構
    standard_images = []  # List of tuples: (bytes, mime_type)
    pptx_summaries = []
    total_detected_pages = 0

    if source_url and source_url.strip():
        from url_crawler import crawl_url_to_images, is_valid_url
        clean_url = source_url.strip()
        if not is_valid_url(clean_url):
            raise HTTPException(status_code=400, detail="提供的網址格式無效，請輸入包含 http:// 或 https:// 的有效連結")
        logger.info(f"正在自指定網址爬取投影片與視覺素材: {clean_url}")
        try:
            url_images = crawl_url_to_images(clean_url, limit=6)
            if not url_images:
                raise HTTPException(status_code=400, detail="無法從目標網址截取到有效影像")
            for img_bytes, mime in url_images:
                standard_images.append((img_bytes, mime))
            total_detected_pages += len(url_images)
        except HTTPException:
            raise
        except Exception as ue:
            raise HTTPException(status_code=400, detail=f"網址爬取失敗: {str(ue)}")
    
    try:
        for uploaded_file in (files or []):
            content = await read_uploaded_file_safely(uploaded_file, MAX_UPLOAD_SIZE)
            filename = uploaded_file.filename.lower()
            
            if filename.endswith(".pptx"):
                try:
                    pptx_res = process_pptx_presentation(content, target_pages=target_pages_set)
                except ValueError as ve:
                    raise HTTPException(status_code=400, detail=str(ve))

                pptx_summaries.append(pptx_res["structure_summary"])
                total_detected_pages += pptx_res["total_slides"]
                
                # 附加上篩選後投影片的視覺佈局縮圖
                for page in pptx_res["preview_pages"][:30]:
                    standard_images.append((page["bytes"], "image/jpeg"))
                
                # 附加上 PPTX 內置的高畫質插圖/背景圖（最多前 12 張）
                for _, img_bytes in pptx_res["media_images"][:12]:
                    standard_images.append((img_bytes, "image/png"))

            elif filename.endswith(".pdf"):
                doc = None
                try:
                    doc = fitz.open(stream=content, filetype="pdf")
                    if len(doc) > MAX_PDF_TOTAL_PAGES:
                        raise HTTPException(
                            status_code=400,
                            detail=f"PDF 檔案「{uploaded_file.filename}」頁數過多 ({len(doc)} 頁)，上限為 {MAX_PDF_TOTAL_PAGES} 頁"
                        )
                    total_detected_pages += len(doc)
                    
                    for p in range(len(doc)):
                        page_num = p + 1
                        if target_pages_set and page_num not in target_pages_set:
                            continue
                        page = doc.load_page(p)
                        pix = page.get_pixmap(dpi=150)
                        img_bytes = pix.tobytes("jpeg")
                        standard_images.append((img_bytes, "image/jpeg"))
                        if len(standard_images) >= MAX_PDF_PAGES_ANALYZE:
                            break
                except HTTPException:
                    raise
                except Exception as conv_err:
                    logger.warning(f"PDF 頁面渲染略過: {conv_err}")
                finally:
                    if doc is not None:
                        doc.close()

            elif filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
                mime_type = "image/png" if filename.endswith(".png") else "image/jpeg"
                if filename.endswith(".webp"):
                    mime_type = "image/webp"
                
                total_detected_pages += 1
                standard_images.append((content, mime_type))
            else:
                raise HTTPException(status_code=400, detail=f"不支援的檔案格式: {uploaded_file.filename}。請上傳 PPTX, PDF, PNG, JPG, 或 WEBP。")

        # 組裝 Prompt 提示詞
        user_prompt_text = (
            "請詳細審視我上傳的簡報投影片，執行深度視覺與幾何拓撲逆向工程。\n"
            "【核心使命】：\n"
            "1. 必須逐頁精確拆解投影片的真實骨架，★絕對嚴禁將圖解簡化為普通條列！若有同心圓引線對應（Leader Lines）、雙模組並存（如靶心+進程軸）、3D階梯等，必須以機械級拓撲完整描述。\n"
            "2. ★【色彩抗失真】：金色/黃色系一律使用「低飽和啞光駝金/沉穩古銅赭金 (#C29B53)」，嚴禁高飽和鮮黃，內頁淺底一律採用「溫潤暖象牙米灰 (#F4F3EE)」。\n"
            "2. 產出的第 3 節 NotebookLM 提示詞必須同時完整輸出兩種模式代碼區塊：\n"
            "   - 【模式 1：全域風格架構（推薦）】：提取全域視覺手冊與版型語法庫，彈性規劃 3~20 頁，適合任意筆記靈活套用。\n"
            "     ★【最高強制約束：每一個頁面呈現都絕對不能重複（Zero-Repetition Rule）】：在產出的 NotebookLM 提示詞中，必須明文加入不可忽視的最高禁令——『嚴禁連續或重複使用同一種版型！生成的整份簡報中，每一個頁面都必須從版型語法庫中挑選完全不同的視覺拓撲（例如：時間軸 ➔ 心智圖 ➔ 橫向條帶 ➔ 矩陣表格 ➔ 環形流程 ➔ 雙側括號等輪替使用），相鄰頁面與全篇各頁版型呈現皆不得重複！』\n"
            "   - 【模式 2：逐頁 1:1 對比】：嚴格對應原投影片各頁，輸出包含視覺配置與文案內容區的逐頁精確結構，確保每一頁皆展現原稿獨立獨特的拓撲版型。\n"
            "3. 產出一份可直接獨立運行的 HTML/Tailwind 1:1 還原投影片結構代碼。\n"
            "4. 請嚴格依照 SYSTEM INSTRUCTION 規定的章節與 JSON 格式輸出。"
        )
        if target_pages_set:
            selected_list_str = ", ".join(f"P.{p}" for p in sorted(list(target_pages_set)))
            user_prompt_text += f"\n\n【精選頁面解析重點】：使用者已精選特定投影片（{selected_list_str}）進行核心風格逆向，請聚焦剖析這些頁面的真實幾何骨架與設計規範。"

        if pptx_summaries:
            user_prompt_text += "\n\n【從 PPTX 程式碼提取之精確設計元數據】：\n" + "\n\n".join(pptx_summaries)

        is_complex = (total_detected_pages > 10) or (len(standard_images) >= 5)
        auto_reason = None
        analysis_text = ""

        # === 供應商 1: Google Gemini ===
        if provider == "gemini":
            candidate_models = []
            if model and model != "auto":
                candidate_models.append(model)
            for m in ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"]:
                if m not in candidate_models:
                    candidate_models.append(m)

            client = genai.Client(api_key=api_key)
            gemini_parts = []
            for img_bytes, mime in standard_images:
                gemini_parts.append(types.Part.from_bytes(data=img_bytes, mime_type=mime))
            gemini_parts.append(types.Part.from_text(text=user_prompt_text))

            selected_model = candidate_models[0]
            last_err = None
            for candidate in candidate_models:
                try:
                    response = client.models.generate_content(
                        model=candidate,
                        contents=gemini_parts,
                        config=types.GenerateContentConfig(
                            system_instruction=get_system_instruction(),
                            temperature=0.4,
                        )
                    )
                    analysis_text = response.text or ""
                    selected_model = candidate
                    break
                except Exception as g_err:
                    err_str = str(g_err)
                    err_lower = err_str.lower()
                    if "not found" in err_lower or "404" in err_str or "not supported" in err_lower or "high demand" in err_lower or "quota" in err_lower or "exhausted" in err_lower:
                        logger.warning(f"模型 {candidate} 遇到流量尖峰或暫不可用 ({err_str})，正在自動切換至下一個備援模型...")
                        last_err = g_err
                        continue
                    raise g_err
            
            if not analysis_text and last_err:
                raise last_err

        # === 供應商 2: OpenAI (GPT-4o) ===
        elif provider == "openai":
            if model == "auto":
                if is_complex:
                    selected_model = "gpt-4o"
                    auto_reason = "⚡ 智慧判定：已為您自動匹配 OpenAI 旗艦 GPT-4o 視覺模型進行深度剖析。"
                else:
                    selected_model = "gpt-4o-mini"
                    auto_reason = "⚡ 智慧判定：已為您自動選用 OpenAI 極速輕量 GPT-4o mini 視覺模型。"
            else:
                selected_model = "gpt-4o" if "mini" not in model else "gpt-4o-mini"

            client = openai.OpenAI(api_key=api_key)
            content_list = [{"type": "text", "text": user_prompt_text}]
            for img_bytes, mime in standard_images[:6]:  # OpenAI 最多 6 張
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                content_list.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"}
                })

            response = client.chat.completions.create(
                model=selected_model,
                messages=[
                    {"role": "system", "content": get_system_instruction()},
                    {"role": "user", "content": content_list}
                ],
                temperature=0.4
            )
            analysis_text = response.choices[0].message.content or ""

        # === 供應商 3: Anthropic Claude (3.5 Sonnet) ===
        elif provider == "anthropic":
            if model == "auto":
                selected_model = "claude-3-5-sonnet-20241022"
                auto_reason = "⚡ 智慧判定：已為您自動啟用設計與美學頂級的 Claude 3.5 Sonnet 視覺模型。"
            else:
                selected_model = "claude-3-5-sonnet-20241022" if "haiku" not in model else "claude-3-5-haiku-20241022"

            client = anthropic.Anthropic(api_key=api_key)
            content_list = [{"type": "text", "text": user_prompt_text}]
            for img_bytes, mime in standard_images[:6]:
                # Claude 僅支援 jpeg, png, gif, webp
                safe_mime = mime if mime in ["image/jpeg", "image/png", "image/webp"] else "image/jpeg"
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                content_list.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": safe_mime,
                        "data": b64
                    }
                })

            response = client.messages.create(
                model=selected_model,
                max_tokens=4096,
                system=get_system_instruction(),
                messages=[{"role": "user", "content": content_list}],
                temperature=0.4
            )
            analysis_text = response.content[0].text if response.content else ""

        # 提取末端的 JSON 資料（如果有的話）
        parsed_json = None
        if "```json" in analysis_text:
            try:
                json_part = analysis_text.split("```json")[-1].split("```")[0].strip()
                parsed_json = json.loads(json_part)
            except Exception as j_err:
                logger.warning(f"解析 JSON 失敗: {j_err}")

        return {
            "status": "success",
            "provider": provider,
            "model_used": selected_model,
            "auto_reason": auto_reason,
            "markdown_report": analysis_text,
            "structured_meta": parsed_json
        }

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        logger.exception(f"分析過程發生異常: {error_msg}")
        
        if "API_KEY_INVALID" in error_msg or "401" in error_msg or "authentication" in error_msg.lower():
            raise HTTPException(
                status_code=401,
                detail=f"您的 {provider_name} API Key 無效或尚未啟用。請檢查右上角輸入的金鑰是否正確。"
            )
        elif "quota" in error_msg.lower() or "429" in error_msg:
            raise HTTPException(
                status_code=429,
                detail=f"您的 {provider_name} API 呼叫次數已達頻率限制，請稍候 30 秒至 1 分鐘後再試。"
            )
        else:
            raise HTTPException(status_code=500, detail="逆向分析服務執行時發生非預期錯誤，請檢查檔案格式或金鑰權限。")


# 掛載前端靜態檔案（使用絕對路徑確保無論從哪裡執行皆正確）
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    import webbrowser
    import threading

    def open_browser():
        webbrowser.open("http://127.0.0.1:8000")

    threading.Timer(1.5, open_browser).start()
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
