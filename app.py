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

# 系統逆向工程 Prompt
SYSTEM_INSTRUCTION = """
你是一位世界頂級的簡報視覺總監（Presentation Art Director）與提示詞架構大師（Prompt Engineer）。
你的任務是「深度逆向工程（Reverse-Engineer）」使用者上傳的簡報範例（PDF 或投影片截圖），並將其獨特的視覺美學、版面編排節奏與資訊架構，精確轉化為適用於「NotebookLM (NBLM)」及現代 AI 簡報工具的高精度提示詞與風格指南。

請深入剖析下列五大維度：
1. 【色彩系統 (Color Palette)】：精確推敲其背景色、主色（Primary）、輔色（Secondary）、強調重點色（Accent），並列出可使用的 Hex 16進制色碼，分析其色彩心理與光影特徵。
2. 【版面佈局與格線 (Layout & Grid)】：留白比例（例如 70% 留白 vs 高密度看板）、排版網格（Bento Grid 模組化卡片、非對稱雜誌流、單欄焦點、左右對稱比對等）。
3. 【字體排版與層次 (Typography & Hierarchy)】：標題字重（極黑體/優雅襯線/無襯線現代體）、字級對比比率（大標題與內文的巨大反差）、標籤化裝飾字（Kicker / Tag / Badge）。
4. 【視覺元素與質素 (Visual Accents & Texture)】：背景質感（純白極簡、深色科技光暈、柔和微漸層、紙質磨砂）、圖表形態（大字數據卡、極簡線條圖、膠囊進度條）、插畫或意象形態。
5. 【敘事節奏與資訊密度 (Narrative & Information Density)】：單頁核心訊息數量（One Key Takeaway 原則）、條列重點數量限制（嚴格 3-4 點）、卡片切分方式。

你必須以繁體中文（台灣習慣用語，如「投影片」、「排版」、「資訊」）產出結構化解析報告，並且必須包含一段專為 NotebookLM 設計的完整複製提示詞！

輸出格式規範：
請務必輸出包含以下標題的詳細 Markdown 內容：
# 🎨 簡報風格逆向工程報告

## 1. 風格定位與核心摘要
[精準命名此風格，如「現代矽谷極簡發布會風」、「日系知性留白雜誌風」、「Bento Grid 模組化商務看板風」，並以 2-3 句話點出其視覺靈魂]

## 2. 視覺設計系統規範 (Design System)
- **色彩系統**：
  - 背景色：#XXXXXX (說明)
  - 品牌主色：#XXXXXX (說明)
  - 輔助中性色：#XXXXXX (說明)
  - 強調高光色：#XXXXXX (說明)
  - 漸層/光影：(有無漸層、陰影或透明度)
- **版面與網格**：(留白比例、網格佈局、邊界間距)
- **字型與文字層次**：(標題風格、內文規格、標籤/小標特徵)
- **視覺元素與圖表**：(卡片樣式、圖表視覺、圖示 Icon 規範)
- **資訊架構節奏**：(單頁字數限制、核心論點呈現法則)

## 3. 📋 NotebookLM 專用簡報引導提示詞 (System Prompt)
> 請將以下區塊直接複製並貼入 NotebookLM 的「筆記指引 (Notebook Guide)」或聊天提示中：

```markdown
[在此產生一段極其嚴謹、結構分明的 NotebookLM 提示詞。
包含：
1. 角色設定：簡報內容架構師。
2. 輸出格式：單頁投影片的 Markdown 模板（包含 Slide Title、Sub-headline、Key Takeaways 卡片、視覺版面提示標籤 [Visual Directive]）。
3. 遵循上述風格的文字精簡原則、數字凸顯規範與視覺留白指令。]
```

## 4. 🚀 搭配 AI 簡報工具生成提示詞 (Gamma / Midjourney / Canva)
- **Gamma AI 簡報主題提示詞**：(可直接貼給 Gamma 生成簡報的風格指令)
- **Midjourney / 視覺背景生成提示詞**：(英文 Prompt，適合生成配套簡報投影片背景)

## 5. 💡 實戰套用範例 (Example Slide Output)
[以本風格示範「第 1 頁 (封面)」與「第 2 頁 (核心數據內頁)」由 NotebookLM 產出的實際成果範例]

---
最後，請在回答最尾端，附上一個嚴格符合 JSON 格式的代碼塊，用於前端介面渲染顏色色票與標籤：
```json
{
  "style_name": "風格名稱",
  "tags": ["極簡", "科技感", "Bento Grid", "高留白"],
  "palette": [
    {"role": "背景色", "hex": "#111827", "name": "Dark Slate"},
    {"role": "主色", "hex": "#3B82F6", "name": "Electric Blue"},
    {"role": "輔色", "hex": "#9CA3AF", "name": "Cool Gray"},
    {"role": "強調色", "hex": "#10B981", "name": "Emerald Accent"}
  ],
  "white_space_ratio": "75%",
  "density": "中低密度 / 視覺焦點型"
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
        user_prompt_text = "請詳細審視我上傳的簡報投影片，執行深度視覺與排版逆向工程，產出符合規範的報告與適用於 NotebookLM 的結構化提示詞。"
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
