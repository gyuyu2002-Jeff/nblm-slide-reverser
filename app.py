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
你的使命是【像素級與拓撲級真實還原】使用者上傳的簡報範例（PDF、PPTX 或投影片截圖），徹底洞察其「真實幾何骨架、圖解隱喻、邊框材質、文字節奏與色彩系統」，並轉譯為能 100% 忠實對齊的 NotebookLM 結構化提示詞、排版設計規範、以及可直接渲染的 HTML/Tailwind 投影片代碼。

⚠️【最高原則：實事求是、零幻覺還原（Zero-Hallucination Constraints）】：
1. 🚫【嚴禁無中生有幻覺「巨型 KPI 統計大數字」】：
   - 很多 AI 會預設套用現代 SaaS/儀表板風格，在畫面上胡亂放大數字（例如「100 小時」、「25%」等）。
   - 【鐵律】：除非原始投影片頁面上本來就存在該巨型統計數字，否則【絕對嚴格禁止】在提示詞或結構中加入任何巨型 KPI 大數字！
   - 若原稿是企管架構、培訓模型、進程導軌、組織樹或條理清單，必須 100% 忠實還原其圖解幾何形態！
2. 🚫【嚴格區分「線框卡片」與「色塊卡片」】：
   - 仔細觀察卡片是「純白底 + 1px~1.5px 深色細邊框」，還是「灰色色塊填充」。絕不可將線框卡片誤判或簡化為色塊卡片。
3. 🚫【精準還原列表形式（斑馬條紋 vs 圓點清單）】：
   - 若卡片內條目是「水平灰白相間的斑馬紋條塊 (Zebra Stripe Rows / Pills)」，必須明確指認並記錄，不可粗糙降級為普通圓點 (Bullet points)。
4. 🚫【精確提取核心幾何圖解隱喻】：
   - 若畫面中包含「同心圓靶心 (Concentric Rings)」、「水平箭頭進程軸 (Milestone Timeline)」、「金字塔」、「組織架構樹」、「象限矩陣」或「雙色 Icon」，必須精準拆解其層級數、節點數與連線邏輯！
5. 🚫【致命防護：嚴禁「主題語意風格污染」(Anti-Topic Semantic Bias)】：
   - 當使用者日後拿提示詞去生成不同主題（例如「AI 科技」、「雲端大數據」）時，下游簡報工具常會「自動腦補擅自加戲」（例如自動加上：工程方格紙背景、刻度標尺、十字座標、3D 立體陰影、45 度斜向發射導軌、化學燒杯或賽博科幻分子）！
   - 【鐵律約束】：提示詞必須包含【視覺風格鎖定契約 (Visual Style Lock Contract)】與【強力負向排除詞 (Negative Style Directives)】，強制要求下游工具：
     * 背景必須 100% 保持乾淨純色畫布（如純白 #FFFFFF），嚴禁網格方格紙、工程線條、刻度尺、十字標記。
     * 所有圖解必須嚴格保持純 2D 平面向量 (Strictly Flat 2D)，嚴禁 3D 陰影、立體圓環與擬物立體感。
     * 時間軸必須嚴格保持水平對齊 (Strictly Horizontal)，嚴禁 45 度斜向飛行發射導軌。
     * 色彩必須牢牢鎖定本簡報原色的 Hex 色碼（如海軍藍 #0E3B5D + 赭石金 #C59B27），嚴禁因為主題是 AI 就擅自漂移成冰冷賽博藍。
     * 圖示必須維持簡約商務雙色 Icon，嚴禁出現與主題硬湊的科幻燒杯、分子等雜亂元素。

請以繁體中文（台灣習慣用語）輸出以下結構化報告：

# 🎨 簡報風格精準逆向報告

## 1. 逐頁版面拓撲與幾何骨架 (Slide-by-Slide Topology)
[對上傳的每頁投影片進行精準幾何拆解，實事求是，忠實對應上傳內容]
- **第 1 頁拓撲**：
  - 佈局結構：(指認版面結構，例如「左右 50/50 分割 + 中央 1px 深色垂直分割線」)
  - 幾何圖解與組件：(詳細描述圖解形態，例如「左側同心圓靶心圖 (3 層圓環由外而內，右側水平箭線引出文字標籤)；右側橫向金色箭頭進程軸，串接 4 個雙色圓形徽章節點」)
  - 容器與材質：(背景顏色、線條粗細與色碼)
- **第 2 頁拓撲**：
  - 佈局結構：(指認版面結構，例如「橫向等寬 3 欄獨立卡片佈局」)
  - 容器規格：(例如「純白背景、1.5px 深海軍藍俐落細邊框、直角無陰影」)
  - 卡片內部層級：(例如「頂部居中雙色向量 Icon (海軍藍+赭石金) -> 粗體卡片標題 -> 斑馬紋條列區塊 (灰白相間水平色塊條)」)
(若有更多頁面，請依序逐頁精確拆解)

## 2. 精確設計系統規範 (Design System)
- **色彩系統 (Exact Hex Palette)**：
  - 畫布背景色：#XXXXXX (精準提取底色)
  - 主文字色：#XXXXXX (主要標題與深色文字)
  - 核心強調色 (Accent)：#XXXXXX (品牌金/藍等重點用色)
  - 線框與分割線色：#XXXXXX (卡片邊框與線條用色)
  - 條塊背景色：#XXXXXX (卡片內斑馬紋條列灰底用色，如 #F3F4F6)
- **字型與排印層級**：標題字重、卡片標題字級、內文字距與對齊方式
- **圖示系統 (Iconography)**：圖示風格（雙色幾何向量、線條等）、主次顏色配比、尺寸規格與擺放位置

## 3. 📋 NotebookLM 專用 1:1 骨架還原提示詞 (System Prompt)
> 複製以下指令貼入 NotebookLM。它將強制 NotebookLM 根據您的筆記來源，100% 依循原始簡報的「幾何骨架槽位」輸出投影片文案，徹底杜絕巨型數字幻覺：

```markdown
[在此輸出一段為 NotebookLM 量身打造的高階引導指令。
必須包含：
1. 角色設定：高階簡報內容架構師。
2. 全局原則與視覺風格保護鎖：
   - 嚴格維持簡報的高雅專業性與留白節奏。
   - 🚫【絕對禁令】：嚴禁無中生有生成巨型 KPI 統計大數字！重點在於概念框架、邏輯推導與條理清單。
   - 🚫【視覺鎖定】：背景保持 100% 純白無雜訊；嚴禁方格網格紙；圖解嚴格保持純 2D 平面；時間軸嚴格保持水平對齊。
   - 每頁投影片輸出必須明確標記其【版面幾何結構標籤】與對應插槽。
3. 根據上述「第 1 節實際辨識到的各頁幾何拓撲」，精確產生對應的投影片型態骨架插槽（例如型態 1: 概念架構與進程頁 [左右分割/同心圓/里程碑]；型態 2: 模組分析與檢視頁 [三欄線框卡片/斑馬紋條列] 等）！]
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

            max_preview = min(total_pages, 6)
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
                
                # 附加上前 4 頁投影片的視覺佈局縮圖
                for page in pptx_res["preview_pages"][:4]:
                    standard_images.append((page["bytes"], "image/jpeg"))
                
                # 附加上 PPTX 內置的高畫質插圖/背景圖（最多前 4 張）
                for _, img_bytes in pptx_res["media_images"][:4]:
                    standard_images.append((img_bytes, "image/png"))

            elif filename.endswith(".pdf"):
                try:
                    doc = fitz.open(stream=content, filetype="pdf")
                    total_detected_pages += len(doc)
                    sample_pages = min(len(doc), 4)
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
            "1. 必須逐頁精確拆解投影片的真實骨架（如左右分割、同心圓靶心、橫向進程軸、N 欄線框卡片、斑馬紋條列區塊），實事求是，嚴格禁止無中生有幻覺巨型 KPI 統計大數字！\n"
            "2. 產出的 NotebookLM 提示詞必須與上傳投影片的真實骨架 1:1 精確對齊，讓使用者貼入 NotebookLM 後能將筆記內容填入對應的幾何槽位中。\n"
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
            if model == "auto":
                if is_complex:
                    selected_model = "gemini-1.5-pro"
                    auto_reason = f"⚡ 智慧判定：簡報頁數較多（約 {total_detected_pages} 頁），自動選用深度推論模型 Gemini 1.5 Pro。"
                else:
                    selected_model = "gemini-2.5-flash"
                    auto_reason = "⚡ 智慧判定：精選投影片截圖（少於 10 頁），自動選用極速高精準的 Gemini 2.5 Flash（3秒完成）。"
            else:
                supported = ["gemini-2.5-flash", "gemini-1.5-pro", "gemini-2.5-pro", "gemini-2.0-flash"]
                selected_model = model if model in supported else "gemini-2.5-flash"

            client = genai.Client(api_key=api_key)
            gemini_parts = []
            for img_bytes, mime in standard_images:
                gemini_parts.append(types.Part.from_bytes(data=img_bytes, mime_type=mime))
            gemini_parts.append(types.Part.from_text(text=user_prompt_text))

            response = client.models.generate_content(
                model=selected_model,
                contents=gemini_parts,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.4,
                )
            )
            analysis_text = response.text or ""

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
