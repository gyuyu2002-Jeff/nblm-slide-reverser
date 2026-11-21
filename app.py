import os
import io
import json
import re
import base64
import logging
import time
from collections import defaultdict
import threading
from typing import List, Optional, Dict
from fastapi import FastAPI, File, UploadFile, Form, Header, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import fitz  # PyMuPDF
from PIL import Image
from google import genai
from google.genai import types
import openai
import anthropic

def extract_style_metadata(text):
    for marker in reversed(list(re.finditer(r"```json\s*", text, re.I))):
        try:
            value, _ = json.JSONDecoder().raw_decode(text[marker.end():])
            if isinstance(value, dict) and (value.get("style_name") or isinstance(value.get("palette"), list)):
                return value
        except (ValueError, TypeError):
            continue
    return None


# ==================== 安全防護配置 ====================
MAX_UPLOAD_SIZE = 25 * 1024 * 1024       # 單一檔案最大 25MB
MAX_REQUEST_SIZE = 50 * 1024 * 1024      # 整體請求最大 50MB
MAX_UPLOAD_FILES_COUNT = 10              # 單次請求最多上傳 10 個檔案
MAX_PDF_PAGES_ANALYZE = 30               # 每次請求合併所有來源，最多均勻選取 30 頁
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
        
        csp = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https: http:; connect-src 'self' https://generativelanguage.googleapis.com https://api.openai.com https://corsproxy.io https://api.allorigins.win https://image.thum.io; worker-src 'self' blob: https://cdnjs.cloudflare.com; frame-src 'self' blob:; base-uri 'self';"
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
def get_system_instruction() -> str:
    """使用與靜態網站相同的原稿優先規則；缺檔時讓分析明確失敗。"""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guardrails.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    base = data["system_instruction"]
    if not isinstance(base, str) or not base.strip():
        raise ValueError("風格規則不完整")
    return base + "\n" + "\n".join(
        r["rule"] for r in data.get("rules", [])
        if isinstance(r, dict) and isinstance(r.get("rule"), str)
    )


from pptx_handler import process_pptx_presentation, select_representative_pages, load_pptx_presentation

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
                pptx_data = process_pptx_presentation(content, max_preview=MAX_PDF_TOTAL_PAGES)
            except ValueError as ve:
                raise HTTPException(status_code=400, detail=str(ve))

            return {
                "status": "success",
                "file_type": "pptx",
                "total_pages": pptx_data["total_slides"],
                "aspect_ratio": pptx_data["aspect_ratio"],
                "preview_pages": [
                    {key: value for key, value in page.items() if key != "bytes"}
                    for page in pptx_data["preview_pages"]
                ],
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
                max_preview = min(total_pages, MAX_PDF_TOTAL_PAGES)
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


def measure_image_pixels(content: bytes) -> dict:
    """提供逐頁影像取樣證據；不將高頻色宣稱為品牌或畫布物件色。"""
    with Image.open(io.BytesIO(content)) as source:
        image = source.convert("RGB")
        image.thumbnail((96, 96))
        colors = image.getcolors(maxcolors=96 * 96)
        total = image.width * image.height
        light = sum(count for count, color in colors if min(color) >= 230) / total
        dark = sum(count for count, color in colors if max(color) <= 60) / total
        palette = image.quantize(colors=5).convert("RGB").getcolors(maxcolors=96 * 96)
        ranked = sorted(palette, reverse=True)[:5]
        candidates = ", ".join("#%02X%02X%02X 約 %.0f%%" % (*color, count * 100 / total) for count, color in ranked)
        return {"lightRatio": light, "darkRatio": dark, "candidates": candidates}

def describe_image_pixels(content: bytes) -> str:
    sample = measure_image_pixels(content)
    return f"近白像素 {sample['lightRatio']:.1%}；近黑像素 {sample['darkRatio']:.1%}；量化候選：{sample['candidates']}"


def parse_selected_pages_str(pages_str: Optional[str]) -> Optional[set]:
    """解析使用者指定的頁碼字串，例如 '1, 3, 5-8' -> {1, 3, 5, 6, 7, 8}"""
    if not pages_str or not pages_str.strip():
        return None
    # 所有上傳檔案的合併頁碼，另包含最多 6 張網址擷取影像。
    max_page = MAX_UPLOAD_FILES_COUNT * MAX_PDF_TOTAL_PAGES + 6
    result = set()
    try:
        for part in pages_str.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                start, end = (int(value.strip()) for value in part.split("-", 1))
            else:
                start = end = int(part)
            if not 1 <= start <= end <= max_page:
                raise ValueError("頁碼超出允許範圍")
            result.update(range(start, end + 1))
        if not result:
            raise ValueError("未提供有效頁碼")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="選取頁碼無效，請使用正整數或有效範圍。") from exc
    return result



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
    standard_images = []  # (bytes, mime_type, source_label)
    source_groups = []
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
            for index, (img_bytes, mime) in enumerate(url_images, 1):
                source_groups.append({"name": f"網址擷取影像 {index}", "kind": "image", "content": img_bytes, "pages": 1, "mime": mime})
        except HTTPException:
            raise
        except Exception as ue:
            raise HTTPException(status_code=400, detail=f"網址爬取失敗: {str(ue)}")
    
    try:
        # 先統計所有來源，再一次決定合併頁碼的 30 頁額度；未選頁不渲染、不送出。
        upload_bytes = 0
        for uploaded_file in (files or []):
            content = await read_uploaded_file_safely(uploaded_file, MAX_UPLOAD_SIZE)
            upload_bytes += len(content)
            if upload_bytes > MAX_REQUEST_SIZE:
                raise HTTPException(status_code=413, detail="單次上傳檔案總大小超過限制。")
            filename = uploaded_file.filename.lower()
            group = {"name": uploaded_file.filename, "content": content}
            try:
                if filename.endswith(".pptx"):
                    group.update(kind="pptx", pages=len(load_pptx_presentation(content).slides))
                elif filename.endswith(".pdf"):
                    with fitz.open(stream=content, filetype="pdf") as doc:
                        count = len(doc)
                    if not 1 <= count <= MAX_PDF_TOTAL_PAGES:
                        raise ValueError(f"PDF 頁數須為 1 至 {MAX_PDF_TOTAL_PAGES} 頁，請先拆分檔案。")
                    group.update(kind="pdf", pages=count)
                elif filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
                    mime = "image/png" if filename.endswith(".png") else "image/webp" if filename.endswith(".webp") else "image/jpeg"
                    group.update(kind="image", pages=1, mime=mime)
                else:
                    raise ValueError("不支援的檔案格式，請上傳 PPTX、PDF 或投影片圖片。")
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"{uploaded_file.filename}：{exc}") from exc
            source_groups.append(group)

        total_detected_pages = sum(group["pages"] for group in source_groups)
        if target_pages_set is not None and any(n > total_detected_pages for n in target_pages_set):
            raise HTTPException(status_code=400, detail="選取頁碼超出上傳來源的總頁數。")
        candidates = sorted(target_pages_set) if target_pages_set is not None else list(range(1, total_detected_pages + 1))
        analyzed_pages = select_representative_pages(candidates, MAX_PDF_PAGES_ANALYZE)
        target_pages_set = set(analyzed_pages)
        page_offset = 0
        for group in source_groups:
            local_pages = {n - page_offset for n in analyzed_pages if page_offset < n <= page_offset + group["pages"]}
            page_offset += group["pages"]
            if not local_pages:
                continue
            if group["kind"] == "pptx":
                pptx_res = process_pptx_presentation(group["content"], target_pages=local_pages)
                pptx_summaries.append(pptx_res["structure_summary"])
                for page in pptx_res["preview_pages"]:
                    standard_images.append((page["bytes"], "image/jpeg", f"P.{page_offset - group['pages'] + page['page']}"))
                # 不附加整個壓縮檔的媒體，避免將未選投影片的素材送進模型。
            elif group["kind"] == "pdf":
                with fitz.open(stream=group["content"], filetype="pdf") as doc:
                    for page_num in sorted(local_pages):
                        pix = doc.load_page(page_num - 1).get_pixmap(dpi=150)
                        standard_images.append((pix.tobytes("jpeg"), "image/jpeg", f"P.{page_offset - group['pages'] + page_num}"))
            else:
                standard_images.append((group["content"], group["mime"], f"P.{page_offset}"))

        # 組裝 Prompt 提示詞
        user_prompt_text = (
            "請依系統規則分析所附來源頁，先記錄原稿特徵與來源證據，"
            "再產生兩種完整提示詞與 design_profile。"
            "影像色碼僅可標示估計，不得依流派名稱替換配色或強制版型輪替。"
        )
        if target_pages_set:
            selected_list_str = ", ".join(f"P.{p}" for p in sorted(list(target_pages_set)))
            user_prompt_text += f"\n\n【本次實際解析範圍】：依上傳來源合併順序選取投影片（{selected_list_str}）進行風格逆向，請聚焦剖析這些頁面的真實幾何骨架與設計規範。"

        pixel_evidence = [f"{label}：{describe_image_pixels(content)}" for content, _, label in standard_images]
        user_prompt_text += "\n\n【各來源頁的影像像素取樣證據】\n" + "\n".join(pixel_evidence)
        user_prompt_text += "\n這些比例與色碼是低解析度取樣，不代表精確品牌色或物件色。請與每頁影像交叉核對，勿把深色頁腳細帶當成整頁背景；若近白區域佔大多數，不能未經說明就寫成滿版深色。照片中的明暗也須與畫布分開判讀。"

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
            for m in ["gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"]:
                if m not in candidate_models:
                    candidate_models.append(m)

            client = genai.Client(api_key=api_key)
            gemini_parts = []
            for img_bytes, mime, source_label in standard_images:
                gemini_parts.append(types.Part.from_text(text=f"來源頁：{source_label}"))
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
                    if "spending cap" in err_lower or "spend cap" in err_lower or "ai.studio/spend" in err_lower:
                        raise HTTPException(status_code=429, detail="您的 Google Gemini 專案已達每月支出上限；稍候重試無法解除。請檢查該專案用量，或使用另一個有可用額度的 API Key。") from g_err
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
            for img_bytes, mime, source_label in standard_images:
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                content_list.append({"type": "text", "text": f"來源頁：{source_label}"})
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
            for img_bytes, mime, source_label in standard_images:
                # Claude 僅支援 jpeg, png, gif, webp
                safe_mime = mime if mime in ["image/jpeg", "image/png", "image/webp"] else "image/jpeg"
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                content_list.append({"type": "text", "text": f"來源頁：{source_label}"})
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

        # JSON may precede the report and may omit only its Markdown closing fence.
        parsed_json = extract_style_metadata(analysis_text)

        return {
            "status": "success",
            "provider": provider,
            "model_used": selected_model,
            "auto_reason": auto_reason,
            "markdown_report": analysis_text,
            "structured_meta": parsed_json,
            "analyzed_pages": analyzed_pages,
            "total_pages": total_detected_pages,
            "analysis_context": {"source_pages": [label for _, _, label in standard_images],
                "pixel_evidence": [{"source_page": label, **measure_image_pixels(content)} for content, _, label in standard_images]}
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
        elif "503" in error_msg or "high demand" in error_msg.lower():
            raise HTTPException(status_code=503, detail=f"{provider_name} 服務目前忙碌，暫時無法完成分析。請稍後再試，或選擇其他可用模型。")
        elif "quota" in error_msg.lower() or "429" in error_msg:
            raise HTTPException(
                status_code=429,
                detail=f"您的 {provider_name} API 呼叫次數已達頻率限制，請稍候 30 秒至 1 分鐘後再試。"
            )
        else:
            raise HTTPException(status_code=500, detail="逆向分析服務執行時發生非預期錯誤，請檢查檔案格式或金鑰權限。")


# 與 GitHub Pages 使用相同的入口與規則；僅開放明列的公開檔案。
@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
def frontend_index():
    return FileResponse(os.path.join(os.path.dirname(__file__), "index.html"))

@app.get("/style-quality.js", include_in_schema=False)
def frontend_quality_script():
    return FileResponse(os.path.join(os.path.dirname(__file__), "style-quality.js"))

@app.get("/app.js", include_in_schema=False)
def frontend_script():
    return FileResponse(os.path.join(os.path.dirname(__file__), "app.js"))

@app.get("/style.css", include_in_schema=False)
def frontend_styles():
    return FileResponse(os.path.join(os.path.dirname(__file__), "style.css"))

@app.get("/guardrails.json", include_in_schema=False)
def frontend_rules():
    return FileResponse(os.path.join(os.path.dirname(__file__), "guardrails.json"))

@app.get("/favicon.svg", include_in_schema=False)
@app.get("/favicon.ico", include_in_schema=False)
@app.get("/favicon-16x16.png", include_in_schema=False)
@app.get("/favicon-32x32.png", include_in_schema=False)
@app.get("/apple-touch-icon.png", include_in_schema=False)
def frontend_icon(request: Request):
    return FileResponse(os.path.join(os.path.dirname(__file__), request.url.path.lstrip("/")))

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
