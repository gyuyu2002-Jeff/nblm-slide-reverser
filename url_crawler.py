import os
import re
import io
import time
import logging
from typing import List, Tuple, Optional
from pathlib import Path
import httpx
import fitz  # PyMuPDF
from PIL import Image

logger = logging.getLogger("url_crawler")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
}

def is_valid_url(url: str) -> bool:
    """檢查是否為合法 HTTP/HTTPS 網址"""
    if not url or not isinstance(url, str):
        return False
    return bool(re.match(r"^https?://[^\s/$.?#].[^\s]*$", url.strip(), re.IGNORECASE))


def extract_google_slides_id(url: str) -> Optional[str]:
    """從 Google Slides 網址提取簡報 ID"""
    match = re.search(r"/presentation/d/([a-zA-Z0-9_-]+)", url)
    return match.group(1) if match else None


def crawl_url_to_images(
    url: str,
    output_dir: Optional[Path] = None,
    limit: int = 6
) -> List[Tuple[bytes, str]]:
    """
    爬取目標網址並轉譯為 16:9 高清投影片影像列表。
    支援：
      1. 直接 PDF / 圖片連結
      2. Google Slides 簡報網址
      3. 線上簡報平台 (Speaker Deck, SlideShare, Gamma, Canva 等)
      4. 一般網頁 / 品牌 Landing Page (按 16:9 視窗自動滾動截取關鍵屏)

    回傳：List of (image_bytes, mime_type)
    若提供 output_dir，則同時寫入 page_01.png, page_02.png ...
    """
    url = url.strip()
    if not is_valid_url(url):
        raise ValueError(f"無效的網址格式: {url}")

    results: List[Tuple[bytes, str]] = []

    # -------------------------------------------------------------
    # 策略 1: 檢查是否為 Google Slides
    # -------------------------------------------------------------
    gslide_id = extract_google_slides_id(url)
    if gslide_id:
        export_url = f"https://docs.google.com/presentation/d/{gslide_id}/export/pdf"
        try:
            logger.info(f"偵測到 Google Slides，嘗試透過匯出端點取得 PDF: {export_url}")
            with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=25.0) as client:
                resp = client.get(export_url)
                if resp.status_code == 200 and ("application/pdf" in resp.headers.get("content-type", "") or resp.content[:4] == b"%PDF"):
                    logger.info("成功自 Google Slides 匯出 PDF，正在算繪頁面影像...")
                    doc = fitz.open(stream=resp.content, filetype="pdf")
                    pages_to_take = len(doc) if (limit is None or limit <= 0) else min(len(doc), limit)
                    for i in range(pages_to_take):
                        pix = doc[i].get_pixmap(dpi=150)
                        img_bytes = pix.tobytes("png")
                        results.append((img_bytes, "image/png"))
                    doc.close()
                    if results:
                        _save_if_needed(results, output_dir)
                        return results
        except Exception as e:
            logger.warning(f"Google Slides 匯出 PDF 失敗，將轉由瀏覽器算繪: {e}")

    # -------------------------------------------------------------
    # 策略 2: 檢查是否為直接 PDF 或圖片 URL
    # -------------------------------------------------------------
    lower_url = url.lower()
    is_direct_pdf = lower_url.endswith(".pdf") or ".pdf?" in lower_url
    is_direct_img = any(lower_url.endswith(ext) or f"{ext}?" in lower_url for ext in [".png", ".jpg", ".jpeg", ".webp"])

    if is_direct_pdf or is_direct_img:
        try:
            with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=30.0) as client:
                head_or_get = client.get(url)
                if head_or_get.status_code == 200:
                    ctype = head_or_get.headers.get("content-type", "").lower()
                    if "application/pdf" in ctype or head_or_get.content[:4] == b"%PDF":
                        doc = fitz.open(stream=head_or_get.content, filetype="pdf")
                        pages_to_take = len(doc) if (limit is None or limit <= 0) else min(len(doc), limit)
                        for i in range(pages_to_take):
                            pix = doc[i].get_pixmap(dpi=150)
                            results.append((pix.tobytes("png"), "image/png"))
                        doc.close()
                        _save_if_needed(results, output_dir)
                        return results
                    elif any(t in ctype for t in ["image/png", "image/jpeg", "image/webp"]):
                        mime = "image/png" if "png" in ctype else ("image/jpeg" if "jpeg" in ctype or "jpg" in ctype else "image/webp")
                        results.append((head_or_get.content, mime))
                        _save_if_needed(results, output_dir)
                        return results
        except Exception as e:
            logger.warning(f"直接下載檔案失敗: {e}，切換為瀏覽器渲染模式")

    # -------------------------------------------------------------
    # 策略 3: 使用獨立無頭 Chromium 進行動態瀏覽與 16:9 投影片截圖
    # -------------------------------------------------------------
    from playwright.sync_api import sync_playwright

    logger.info(f"啟動獨立無頭瀏覽器截取網頁: {url}")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled"
            ]
        )
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            device_scale_factor=2,
            user_agent=HEADERS["User-Agent"]
        )

        page = context.new_page()
        page.set_viewport_size({"width": 1920, "height": 1080})

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(3000)  # 等待 JS 框架與渲染
        except Exception as e:
            logger.warning(f"加載頁面超時或警告: {e}")

        # 檢測頁面是否為簡報型容器（如 SpeakerDeck / SlideShare / Reveal / Gamma）
        next_button = page.locator("button[aria-label*='Next'], button[aria-label*='next'], .slide-next, button:has-text('下一頁'), [data-action='next']").first
        is_presentation = False
        try:
            if next_button.is_visible(timeout=1500):
                is_presentation = True
        except Exception:
            is_presentation = False

        if is_presentation:
            logger.info("偵測到線上簡報翻頁控制項，正在逐頁截取...")
            crawl_limit = 50 if (limit is None or limit <= 0) else limit
            for idx in range(crawl_limit):
                time.sleep(1)
                shot = page.screenshot(type="png")
                results.append((shot, "image/png"))
                try:
                    if not next_button.is_visible() or not next_button.is_enabled():
                        break
                    next_button.click(timeout=2000)
                    page.wait_for_timeout(1500)
                except Exception:
                    break
        else:
            # 策略：網頁視覺版面抓取（以 16:9 比例分屏截圖）
            logger.info("以 16:9 投影片視角截取網頁版面風格...")
            total_height = 1080
            try:
                total_height = page.evaluate("() => document.body.scrollHeight")
            except Exception:
                total_height = 1080
            viewport_height = 1080
            
            steps = min(limit, max(1, total_height // viewport_height + 1))
            step_scroll = max(600, total_height // steps)

            for idx in range(steps):
                current_scroll = idx * step_scroll
                try:
                    page.evaluate(f"window.scrollTo(0, {current_scroll});")
                    page.wait_for_timeout(1000)
                except Exception:
                    pass
                shot = page.screenshot(type="png")
                results.append((shot, "image/png"))
                if current_scroll + viewport_height >= total_height:
                    break

        try:
            page.close()
        except Exception:
            pass
        try:
            browser.close()
        except Exception:
            pass

    _save_if_needed(results, output_dir)
    return results


def _save_if_needed(results: List[Tuple[bytes, str]], output_dir: Optional[Path]) -> None:
    """若有指定 output_dir，將圖片儲存為 page_01.png, page_02.png ..."""
    if not output_dir:
        return
    output_dir.mkdir(parents=True, exist_ok=True)
    for idx, (img_bytes, mime) in enumerate(results, start=1):
        target_path = output_dir / f"page_{idx:02d}.png"
        with open(target_path, "wb") as f:
            f.write(img_bytes)
