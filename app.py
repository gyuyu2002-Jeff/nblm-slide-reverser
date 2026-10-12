import os
import io
import json
import base64
import logging
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, Form, Header, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import fitz  # PyMuPDF
from PIL import Image
from google import genai
from google.genai import types
import openai
import anthropic

# 設置日誌（嚴格過濾敏感資訊）
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("nblm-reverser")

app = FastAPI(
    title="NBLM Presentation Style Reverse-Engineer",
    description="簡報風格逆向工程與 NotebookLM 提示詞生成器",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 系統逆向工程 Prompt (真確幾何骨架與視覺還原專用引擎 - 零幻覺標準)
SYSTEM_INSTRUCTION = """
你是一位世界頂級的簡報視覺逆向架構師（Presentation Layout Reverse-Engineer）與幾何排版專家。
你的使命是【像素級與拓撲級真實還原】使用者上傳的簡報範例（PDF、PPTX 或投影片截圖），徹底洞察其「真實幾何骨架、圖解隱喻、邊框材質、文字節奏與色彩系統」，並轉譯為能 100% 忠實對齊的 NotebookLM 專用提示詞與排版設計規範。

⚠️【最高原則：實事求是、真確還原（True-to-Source Visual Fidelity）】：
1. 🎨【100% 忠實提取背景與畫布特徵（嚴禁預設純白偏差）】：
   - 仔細觀察背景是深色商務底、照片遮罩（如暗海軍藍照片疊加層 Photo Overlay），還是極簡純白。
   - 必須精確記錄真實底色 Hex 碼（如深海軍藍 #0E2A38 或純白 #FFFFFF），嚴禁強制漂白或擅自竄改。
2. 📐【精確捕捉並記錄所有核心幾何裝飾與圖解標記】：
   - 若標題旁有「垂直實心粗色塊標柱 (Vertical Accent Bar)」必須精準指認顏色與位置！
   - 若角落或局部有「同心圓弧切角環 (Concentric Arc Rings)」、「同心圓靶心」、「水平進程軸」、「線框獨立卡片」、「斑馬紋條列」，必須 100% 完整捕捉其幾何規格！
3. 🔤【字型與排印節奏真實還原】：
   - 捕捉標題字重（如特大無襯線超粗體 Extra Bold / Impact）、文字色彩（如純白高對比）、對齊方式與大小層級。
4. 🚫【嚴禁無中生有幻覺「巨型 KPI 統計大數字」】：
   - 除非原圖本來就有該巨型數字，否則禁止自行添加。

請以繁體中文（台灣習慣用語）輸出以下結構化報告：

# 🎨 簡報風格精準逆向報告

## 1. 逐頁版面拓撲與幾何骨架 (Slide-by-Slide Topology)
[對上傳的每頁投影片進行精準幾何拆解，忠實對應上傳內容之真實細節]
- **第 1 頁拓撲**：
  - 畫布背景與材質：(精確描述，例如「深海軍藍 (#0E2A38) 商務照片暗色漸層遮罩」)
  - 關鍵幾何裝飾：(詳細指認，例如「主標題左側緊貼垂直實心亮橘色塊標柱；右上角外擴 3 層亮金橘同心圓弧切角環，左下角弧線呼應」)
  - 文字層級與排版：(例如「特大無襯線超粗體全大寫純白標題，下方配 2-3 行純白導言」)
(若有更多頁面，請依序逐頁精確拆解)

## 2. 精確設計系統規範 (Design System)
- **色彩系統 (Exact Hex Palette)**：
  - 畫布背景色：#XXXXXX (精準提取底色)
  - 主文字色：#XXXXXX (主要標題色，如純白 #FFFFFF)
  - 核心強調色 (Accent)：#XXXXXX (亮橘黃/品牌金等重點裝飾色)
  - 次要輔助色：#XXXXXX (線條、分割或次文字色)
- **字型與排印層級**：標題字重、卡片標題字級、內文字距與對齊方式
- **幾何圖解語法**：同心圓弧規格、垂直色塊柱、卡片邊框粗細與圖示風格

## 3. 📋 NotebookLM 專用簡報提示詞 (二合一雙模式輸出)
> 請同時提供以下兩種模式的完整 Markdown 代碼區塊，讓使用者在前端一鍵自由切換：

### 模式 1：全域風格架構（推薦：彈性 3~20 頁，提取整份色彩、字型、標誌裝飾與版型庫，任意筆記皆可直接套用）
```markdown
【任務宣告】：
請嚴格依據我上傳的筆記來源（Sources），提取關鍵事實與洞察，為我規劃一份結構嚴謹、視覺平衡的專業簡報內容。
（總頁數由您根據筆記內容深度自行裁量，建議 3~20 頁均可，每頁皆須嚴格遵循下列風格規範）

【🎨 全域視覺風格規範 (Visual Style Guide)】：
1. 畫布底色與材質：[精準填入辨識到的底色與材質，如：深海軍藍 (#0E2A38) 商務照片暗色漸層遮罩]
2. 核心幾何裝飾特徵（每頁必須標註如何應用）：
   - 主標題旁：[如：左側緊貼 1 條垂直實心粗亮橘色塊標柱 (#F5A623)]
   - 角落幾何：[如：右上角配置 3 層外擴亮金橘同心圓弧切角環，左下角弧線呼應]
3. 字體與排印風格：[如：特大無襯線超粗體 (Extra Bold / Impact)，全大寫，純白高對比]

【✂️ 簡報文字密度防爆預算（維持呼吸感，嚴禁散文段落）】：
1. 嚴格溯源：所有內容必須 100% 源自來源筆記，嚴禁添加未提及的外部推論。
2. 字數限制：
   - 投影片主標題：限定 8~14 字（結論先行，動賓或主謂短語）。
   - 副標題/導言：限定 15~25 字。
   - 區塊/卡片標題：限定 4~8 字。
   - 條列要點：每條限定 12~20 字（每欄/每卡片最多 2~3 點）。
3. 🚫 負向排除：除非來源筆記中具備明確統計數據，否則【絕對嚴禁】無中生有編造巨型 KPI 統計大數字。

【📐 版型語法庫（請依各頁內容屬性動態選用）】：
- [版型 A：封面主視覺]：大標題 + 核心定位導言。
- [版型 B：核心卡片型]：2~4 欄獨立線框卡片，每欄提取 1 個核心洞察 + 2 點短語。
- [版型 C：進程時間軸型]：橫向 3~4 階段節點，標註階段名稱與里程碑。
- [版型 D：數據對比型]：左右雙欄分割，進行優劣對比或趨勢拆解。
- [版型 E：結論與行動型]：關鍵總結 + 下一步行動方案。

【逐頁簡報內容輸出格式（請依此格式逐頁輸出）】：
---
### 第 X 頁：[頁面主題]（採用版型：[A/B/C/D/E]）
- 【🎨 視覺與版面配置】：(標註如何應用全域底色、垂直標柱、同心圓弧等幾何元素)
- 【📝 簡報文案內容】：
  - 主標題：...
  - 核心重點：（依選定版型填寫卡片/時間軸/條列要點，嚴格遵守字數限制）
```

### 模式 2：逐頁 1:1 對比（適合想要 100% 像素級還原特定投影片的嚴格填寫）
```markdown
【任務宣告】：
請嚴格依據我上傳的筆記來源（Sources），提取關鍵事實與洞察，將筆記內容忠實填寫入下列【逐頁 1:1 投影片排版與文案架構】中。

【簡報文字密度防爆預算】：
1. 嚴格溯源：所有內容必須 100% 源自來源筆記，嚴禁添加外部推論。
2. 嚴格字數限制：主標題限定 8~14 字、副標題限定 15~25 字、卡片標題限定 4~8 字、條列限定 12~20 字。
3. 🚫 負向排除：嚴禁無中生有編造巨型 KPI 統計大數字。

【逐頁 1:1 簡報排版與文案架構（對應各頁投影片）】：
(請嚴格根據實際辨識到的各頁真實視覺特徵逐頁輸出，範例如下：)

---
### 投影片 1：[頁面類型，如：封面頁]
【🎨 視覺風格與版面配置】：
- 畫布背景：[填入該頁底色與材質，如：深海軍藍 (#0E2A38) 照片漸層遮罩]
- 核心裝飾：[填入該頁幾何元素，如：左側垂直粗亮橘標柱、右上角同心圓弧切角環]
- 字體排印：[如：特大無襯線超粗體，純白全大寫]
【📝 簡報文案內容區】：
- 主標題：（提取筆記核心主題，結論先行，<14字）
- 導言摘要：（提取 2-3 行簡報核心定位，<25字）

(若原簡報有多頁，請依序對應原簡報的第 2、3... 頁逐頁精準輸出包含視覺配置與文案內容區的架構)
```

## 4. 💻 1:1 還原之 HTML / Tailwind 投影片結構碼 (可直接複製使用)
```html
<!-- 完整、乾淨、可以直接在瀏覽器獨立運行的 HTML 代碼，包含 Tailwind CSS CDN 與內聯樣式，100% 忠實重現上述投影片的真實幾何圖解與版面 -->
```

---
最後，請附上下方的 JSON 區塊，提供前端色票與標籤展示：
```json
{
  "style_name": "精準風格名稱",
  "tags": ["幾何拓撲標籤1", "標籤2", "標籤3", "標籤4"],
  "palette": [
    {"role": "畫布背景", "hex": "#XXXXXX", "name": "顏色名稱"},
    {"role": "主要文字", "hex": "#XXXXXX", "name": "顏色名稱"},
    {"role": "核心強調色", "hex": "#XXXXXX", "name": "顏色名稱"},
    {"role": "線框與分割", "hex": "#XXXXXX", "name": "顏色名稱"}
  ],
  "white_space_ratio": "70%",
  "density": "結構化條理型"
}
```
"""

from pptx_handler import process_pptx_presentation

@app.post("/api/preview")
@app.post("/api/pdf-preview")
async def file_preview(file: UploadFile = File(...)):
    """接收 PDF 或 PPTX 檔案，提取前 6 頁投影片縮圖給前端即時預覽"""
    filename = file.filename.lower()
    if not (filename.endswith(".pdf") or filename.endswith(".pptx")):
        raise HTTPException(status_code=400, detail="預覽僅支援 PDF 或 PPTX 簡報檔案")
    
    try:
        content = await file.read()
        
        if filename.endswith(".pptx"):
            # 解析 PPTX 投影片與素材
            pptx_data = process_pptx_presentation(content)
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
            doc = fitz.open(stream=content, filetype="pdf")
            total_pages = len(doc)
            preview_pages = []

            max_preview = min(total_pages, 30)
            for i in range(max_preview):
                page = doc.load_page(i)
                pix = page.get_pixmap(dpi=120)
                img_bytes = pix.tobytes("jpeg")
                b64_str = base64.b64encode(img_bytes).decode("utf-8")
                preview_pages.append({
                    "page": i + 1,
                    "image": f"data:image/jpeg;base64,{b64_str}"
                })
            
            doc.close()
            return {
                "status": "success",
                "file_type": "pdf",
                "total_pages": total_pages,
                "preview_pages": preview_pages
            }
    except Exception as e:
        logger.error(f"檔案預覽生成失敗: {str(e)}")
        raise HTTPException(status_code=500, detail=f"檔案預覽生成失敗: {str(e)}")


@app.post("/api/analyze")
async def analyze_style(
    files: List[UploadFile] = File(...),
    provider: str = Form("gemini"),
    model: str = Form("auto"),
    target_use: str = Form("notebooklm_slide"),
    x_api_key: Optional[str] = Header(None),
    x_gemini_api_key: Optional[str] = Header(None),
    x_openai_api_key: Optional[str] = Header(None),
    x_anthropic_api_key: Optional[str] = Header(None)
):
    """
    接收投影片檔案（PDF、PPTX 或圖片），
    支援 Google Gemini、OpenAI (GPT-4o)、Anthropic Claude (3.5 Sonnet) 進行多模態風格逆向工程。
    【資安核心】：API Key 僅於當次請求記憶體中使用，不留存於磁碟或日誌中。
    """
    provider = provider.lower()
    
    # 決定使用的 API Key
    if provider == "openai":
        api_key = x_api_key or x_openai_api_key or os.environ.get("OPENAI_API_KEY", "").strip()
        provider_name = "OpenAI"
    elif provider == "anthropic":
        api_key = x_api_key or x_anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY", "").strip()
        provider_name = "Anthropic Claude"
    else:
        provider = "gemini"
        api_key = x_api_key or x_gemini_api_key or os.environ.get("GEMINI_API_KEY", "").strip()
        provider_name = "Google Gemini"
    
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail=f"【未提供 {provider_name} API Key】為了保護資安與隱私，本系統不留存伺服器金鑰。請在右上角「設定 API Key」選擇 {provider_name} 並輸入您的專屬金鑰。"
        )

    if not files or len(files) == 0:
        raise HTTPException(status_code=400, detail="請至少上傳一個 PDF、PPTX 或圖片檔案")

    # 統一收集圖像素材與投影片結構
    standard_images = []  # List of tuples: (bytes, mime_type)
    pptx_summaries = []
    total_detected_pages = 0
    
    try:
        for uploaded_file in files:
            content = await uploaded_file.read()
            filename = uploaded_file.filename.lower()
            
            if filename.endswith(".pptx"):
                pptx_res = process_pptx_presentation(content)
                pptx_summaries.append(pptx_res["structure_summary"])
                total_detected_pages += pptx_res["total_slides"]
                
                # 附加上前 30 頁投影片的視覺佈局縮圖
                for page in pptx_res["preview_pages"][:30]:
                    standard_images.append((page["bytes"], "image/jpeg"))
                
                # 附加上 PPTX 內置的高畫質插圖/背景圖（最多前 12 張）
                for _, img_bytes in pptx_res["media_images"][:12]:
                    standard_images.append((img_bytes, "image/png"))

            elif filename.endswith(".pdf"):
                try:
                    doc = fitz.open(stream=content, filetype="pdf")
                    total_detected_pages += len(doc)
                    sample_pages = min(len(doc), 30)
                    for p in range(sample_pages):
                        page = doc.load_page(p)
                        pix = page.get_pixmap(dpi=150)
                        img_bytes = pix.tobytes("jpeg")
                        standard_images.append((img_bytes, "image/jpeg"))
                    doc.close()
                except Exception as conv_err:
                    logger.warning(f"PDF 頁面渲染略過: {conv_err}")

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
            "1. 必須逐頁精確拆解投影片的真實骨架（如：深色照片遮罩底、標題左側垂直實心粗色塊標柱、右上角外擴亮橘同心圓弧環、超粗無襯線字體、N 欄線框卡片等真實視覺特徵），100% 忠於原稿！\n"
            "2. 產出的第 3 節 NotebookLM 提示詞必須同時完整輸出兩種模式代碼區塊：\n"
            "   - 【模式 1：全域風格架構（推薦）】：提取全域視覺手冊與版型語法庫，彈性規劃 3~20 頁，適合任意筆記靈活套用。\n"
            "   - 【模式 2：逐頁 1:1 對比】：嚴格對應原投影片各頁，輸出包含視覺配置與文案內容區的逐頁精確結構。\n"
            "3. 產出一份可直接獨立運行的 HTML/Tailwind 1:1 還原投影片結構代碼。\n"
            "4. 請嚴格依照 SYSTEM INSTRUCTION 規定的章節與 JSON 格式輸出。"
        )
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
            for m in ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]:
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
                            system_instruction=SYSTEM_INSTRUCTION,
                            temperature=0.4,
                        )
                    )
                    analysis_text = response.text or ""
                    selected_model = candidate
                    break
                except Exception as g_err:
                    err_str = str(g_err)
                    if "not found" in err_str.lower() or "404" in err_str or "not supported" in err_str.lower():
                        logger.warning(f"模型 {candidate} 暫不可用，正在自動切換至下一個備援模型...")
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
                    {"role": "system", "content": SYSTEM_INSTRUCTION},
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
                system=SYSTEM_INSTRUCTION,
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

    except Exception as e:
        error_msg = str(e)
        logger.error(f"分析過程發生異常: {error_msg}")
        
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
            raise HTTPException(status_code=500, detail=f"逆向分析失敗: {error_msg}")


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
