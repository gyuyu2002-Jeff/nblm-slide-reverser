#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
🤖 NBLM Auto-Pilot (全自動投影片逆向與生成閉環測試系統)
=============================================================================
使命：
  1. 自動讀取您放入 input/ 的簡報檔案（PDF、PPTX 或多張截圖）
  2. 透過 Gemini 多模態視覺模型深度逆向提取 NotebookLM 專用結構化提示詞
  3. 透過 Playwright 自動操控 Chrome 瀏覽器，貼入 NotebookLM 自動生成簡報
  4. 實時動態監控算繪進度（完整守護 90~180 秒生成期，絕不提早中斷）
  5. 自動精準導向專屬簡報檢視器，提取 16:9 像素級超高清投影片
  6. 由 AI 視覺質檢官進行「原圖 vs 生成圖」成對比對、打分、診斷走鐘並輸出優化建議
=============================================================================
"""

import os
import sys
import time
import json
import re
import glob
import shutil
import socket
import base64
import logging
import threading
import subprocess
from pathlib import Path
from typing import List, Dict, Tuple, Optional

# 屏蔽第三方與 Google SDK 冗餘日誌，保持主控台清爽
logging.getLogger("google").setLevel(logging.ERROR)
logging.getLogger("google.genai").setLevel(logging.ERROR)
logging.getLogger("httpx").setLevel(logging.ERROR)
logging.getLogger("httpcore").setLevel(logging.ERROR)

# 解決 Windows 主控台 (CP950/Big5) emoji 編碼報錯
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# 導入視覺與文件處理套件
import fitz  # PyMuPDF
from PIL import Image

# 導入 Google Gemini 官方新版 SDK
from google import genai
from google.genai import types

# 導入 Playwright
from playwright.sync_api import sync_playwright

# 設定工作路徑
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent.resolve()

DIR_INPUT = SCRIPT_DIR / "input"
DIR_OUTPUT = SCRIPT_DIR / "output"
DIR_EXTRACTED = DIR_OUTPUT / "01_extracted"
DIR_PROMPTS = DIR_OUTPUT / "02_prompts"
DIR_NBLM_SLIDES = DIR_OUTPUT / "03_nblm_slides"
DIR_EVALUATIONS = DIR_OUTPUT / "04_evaluations"
CONFIG_FILE = SCRIPT_DIR / "config.json"
DEMO_DIR = PROJECT_ROOT / "demo"

# 確保所有目錄存在
for d in [DIR_INPUT, DIR_EXTRACTED, DIR_PROMPTS, DIR_NBLM_SLIDES, DIR_EVALUATIONS]:
    d.mkdir(parents=True, exist_ok=True)


# =============================================================================
# 工具：動態終端機計時轉輪 (Progress Spinner)
# =============================================================================
class ProgressTimer:
    def __init__(self, message: str):
        self.message = message
        self.stop_event = threading.Event()
        self.thread = None
        self.start_time = 0

    def __enter__(self):
        self.start_time = time.time()
        self.thread = threading.Thread(target=self._spin, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=1.0)
        elapsed = int(time.time() - self.start_time)
        print(f"\r✅ {self.message} 完成！(耗時 {elapsed} 秒)                                       ", flush=True)

    def _spin(self):
        frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        idx = 0
        while not self.stop_event.is_set():
            elapsed = int(time.time() - self.start_time)
            frame = frames[idx % len(frames)]
            print(f"\r⏳ {self.message} [已耗時 {elapsed} 秒] {frame}  ", end="", flush=True)
            time.sleep(0.5)
            idx += 1


# =============================================================================
# 1. 設定檔管理與 API 金鑰載入
# =============================================================================
def load_config() -> dict:
    default_config = {
        "gemini_api_key": "",
        "gemini_model": "gemini-3.5-flash",
        "notebooklm_url": "https://notebooklm.google.com/",
        "cdp_port": 9222,
        "cdp_url": "http://127.0.0.1:9222",
        "chrome_profile_dir": os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\AutomationProfile"),
        "slide_page_limit": 6,
        "prompt_mode": "global",
        "auto_evaluate": True,
        "generation_timeout_seconds": 600,
        "notebook_url": ""
    }
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                user_conf = json.load(f)
                default_config.update(user_conf)
        except Exception as e:
            print(f"[警告] 讀取 config.json 失敗: {e}，使用預設值", flush=True)

    # 確保 chrome_profile_dir 中的環境變數被正確展開
    raw_profile = default_config.get("chrome_profile_dir", "")
    default_config["chrome_profile_dir"] = os.path.expandvars(raw_profile)

    # 檢查環境變數中的 GEMINI_API_KEY
    env_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if env_key and not default_config["gemini_api_key"]:
        default_config["gemini_api_key"] = env_key

    # 若仍無 API Key，互動式提示輸入並儲存
    if not default_config["gemini_api_key"]:
        print("\n" + "=" * 60, flush=True)
        print("🔑 尚未設定 Google Gemini API Key！", flush=True)
        print("  本工具依賴 Gemini Vision 進行精準投影片逆向與品質比對。", flush=True)
        print("  您可以至 https://aistudio.google.com/app/apikey 免費申請。", flush=True)
        print("=" * 60, flush=True)
        try:
            input_key = input("請貼上您的 Gemini API Key (AIzaSy...): ").strip()
            if input_key:
                default_config["gemini_api_key"] = input_key
                with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                    json.dump(default_config, f, ensure_ascii=False, indent=2)
                print("✅ API Key 已安全存入 autopilot/config.json，下次啟動將自動讀取！\n", flush=True)
            else:
                print("❌ 未輸入 API Key，程式將無法繼續執行。", flush=True)
                sys.exit(1)
        except (KeyboardInterrupt, EOFError):
            print("\n已取消。", flush=True)
            sys.exit(1)

    return default_config


# =============================================================================
# 2. 步驟一：簡報輸入與影像抽取 (PDF / PPTX / 圖片)
# =============================================================================
def extract_input_slides(limit: int = 6, config: Optional[dict] = None) -> List[Path]:
    print("\n" + "=" * 60, flush=True)
    print("📂 [步驟 1/5] 掃描輸入來源 (支援網址爬取與本機檔案) 並提取投影片影像...", flush=True)
    print("=" * 60, flush=True)

    # 清空先前的抽取目錄
    for f in DIR_EXTRACTED.glob("*.png"):
        try:
            f.unlink()
        except Exception:
            pass

    sys.path.append(str(PROJECT_ROOT))
    from url_crawler import crawl_url_to_images, is_valid_url

    # 1. 優先檢查 input/ 是否已有本機實體檔案 (圖片、PDF、PPTX)
    input_files = []
    for ext in ["*.pdf", "*.pptx", "*.png", "*.jpg", "*.jpeg", "*.webp"]:
        input_files.extend(list(DIR_INPUT.glob(ext)))

    # 2. 若 input/ 中無檔案，自動檢測 Windows 系統剪貼簿是否有剛剛截取的圖片 (如 Win+Shift+S)
    if not input_files:
        try:
            from PIL import ImageGrab
            clip_img = ImageGrab.grabclipboard()
            if clip_img and isinstance(clip_img, Image.Image):
                clip_path = DIR_INPUT / "clipboard_slide.png"
                clip_img.convert("RGB").save(clip_path, "PNG")
                print(f"📋 偵測到剪貼簿中有截圖，已自動擷取並保存至 input/{clip_path.name} 作為分析素材！", flush=True)
                input_files = [clip_path]
        except Exception:
            pass

    # 3. 若無實體檔案與剪貼簿截圖，再檢測是否指定了網址來源 (config.json 或 input/ 目錄下的 txt/url 檔案)
    target_url = None
    if not input_files:
        if config and config.get("source_url") and is_valid_url(config["source_url"]):
            target_url = config["source_url"].strip()

        if not target_url:
            url_files = list(DIR_INPUT.glob("*.txt")) + list(DIR_INPUT.glob("*.url"))
            for uf in url_files:
                try:
                    content_txt = uf.read_text(encoding="utf-8").strip()
                    for line in content_txt.splitlines():
                        line = line.strip()
                        if line.lower().startswith("url="):
                            line = line.split("=", 1)[1].strip()
                        if is_valid_url(line):
                            target_url = line
                            print(f"🔗 從 {uf.name} 偵測到目標網址: {target_url}", flush=True)
                            break
                    if target_url:
                        break
                except Exception:
                    pass

        if target_url:
            print(f"🌐 啟動網址爬蟲自動抓取簡報/網頁視覺素材: {target_url}", flush=True)
            try:
                crawl_url_to_images(target_url, output_dir=DIR_EXTRACTED, limit=limit)
                extracted_images = sorted(list(DIR_EXTRACTED.glob("page_*.png")))
                if extracted_images:
                    print(f"🎉 成功從網址爬取並提取 {len(extracted_images)} 頁投影片影像，已存入 output/01_extracted/", flush=True)
                    return extracted_images
                else:
                    print("⚠️ 網址爬取未產生有效影像，切換為後續備援流程...", flush=True)
            except Exception as u_err:
                print(f"⚠️ 網址爬取失敗: {u_err}，切換為後續備援流程...", flush=True)

    extracted_images: List[Path] = []

    if not input_files:
        print(f"⚠️ 在 {DIR_INPUT} 中未找到任何簡報檔案 (PDF/PPTX/圖片)。", flush=True)
        print(f"💡 自動使用系統內建的 demo 簡報圖片作為測試樣本！", flush=True)
        demo_images = sorted(list(DEMO_DIR.glob("slide_*.jpg")))
        if demo_images:
            for idx, img_path in enumerate(demo_images[:limit], start=1):
                target_path = DIR_EXTRACTED / f"page_{idx:02d}.png"
                img = Image.open(img_path).convert("RGB")
                img.save(target_path, "PNG")
                extracted_images.append(target_path)
            print(f"✅ 成功載入 {len(extracted_images)} 張 Demo 投影片至抽樣區！", flush=True)
            return extracted_images
        else:
            print(f"❌ 請將您想復刻的簡報檔案放入資料夾：\n  {DIR_INPUT}", flush=True)
            sys.exit(1)

    pdf_files = [f for f in input_files if f.suffix.lower() == ".pdf"]
    pptx_files = [f for f in input_files if f.suffix.lower() == ".pptx"]
    img_files = [f for f in input_files if f.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]]

    if pdf_files:
        target_pdf = pdf_files[0]
        print(f"📄 正在解析 PDF: {target_pdf.name} ...", flush=True)
        doc = fitz.open(str(target_pdf))
        total_pages = len(doc)
        pages_to_extract = min(total_pages, limit)
        print(f"   總頁數: {total_pages} 頁，本次提取前 {pages_to_extract} 頁（150 DPI 高清算繪）", flush=True)
        
        for i in range(pages_to_extract):
            page = doc[i]
            pix = page.get_pixmap(dpi=150)
            out_path = DIR_EXTRACTED / f"page_{i+1:02d}.png"
            pix.save(str(out_path))
            extracted_images.append(out_path)
        doc.close()

    elif pptx_files:
        target_pptx = pptx_files[0]
        print(f"📊 檢測到 PPTX: {target_pptx.name}，正在提取投影片視覺內容...", flush=True)
        try:
            sys.path.append(str(PROJECT_ROOT))
            import pptx_handler
            temp_images = pptx_handler.extract_pptx_slides(str(target_pptx), limit=limit)
            for idx, (img_bytes, mime) in enumerate(temp_images, start=1):
                out_path = DIR_EXTRACTED / f"page_{idx:02d}.png"
                with open(out_path, "wb") as f:
                    f.write(img_bytes)
                extracted_images.append(out_path)
        except Exception as p_err:
            print(f"⚠️ PPTX 轉圖失敗: {p_err}，建議將簡報先匯出為 PDF 放入 input/。", flush=True)
            sys.exit(1)

    elif img_files:
        print(f"🖼️ 檢測到 {len(img_files)} 張獨立圖片，正在排序整合...", flush=True)
        img_files.sort(key=lambda x: x.name)
        for idx, img_path in enumerate(img_files[:limit], start=1):
            out_path = DIR_EXTRACTED / f"page_{idx:02d}.png"
            img = Image.open(img_path).convert("RGB")
            img.save(out_path, "PNG")
            extracted_images.append(out_path)

    print(f"🎉 成功提取 {len(extracted_images)} 頁簡報影像，已存入 output/01_extracted/", flush=True)
    return extracted_images


# =============================================================================
# 3. 步驟二：呼叫 Gemini Vision 進行風格逆向 (具備動態計時反饋)
# =============================================================================
def reverse_engineer_prompt(images: List[Path], config: dict) -> Tuple[str, str, str]:
    print("\n" + "=" * 60, flush=True)
    print("🧠 [步驟 2/5] 啟動 Gemini 視覺多模態引擎逆向解析簡報風格...", flush=True)
    print("=" * 60, flush=True)

    system_instruction = ""
    try:
        sys.path.append(str(PROJECT_ROOT))
        import app
        if hasattr(app, "get_system_instruction"):
            system_instruction = app.get_system_instruction()
        else:
            system_instruction = app.SYSTEM_INSTRUCTION
        print("✅ 成功掛載 nblm-slide-reverser 官方設計師系統提示詞核心（含動態約束庫）！", flush=True)
    except Exception:
        system_instruction = (
            "你是一位頂級簡報視覺逆向工程師。請深度剖析上傳的簡報圖片，"
            "提取畫布背景底色、主色調、強調色、60-30-10 配比、排版拓撲、卡片邊框、"
            "字級節奏，並輸出專門提供給 Google NotebookLM「自訂簡報」輸入框使用的極致結構化提示詞。"
        )

    client = genai.Client(api_key=config["gemini_api_key"])
    
    parts = []
    for img_path in images:
        with open(img_path, "rb") as f:
            img_bytes = f.read()
        parts.append(types.Part.from_bytes(data=img_bytes, mime_type="image/png"))

    user_prompt = """
請對上述投影片進行深度視覺幾何骨架逆向剖析：
1. 【畫布與色彩系統】：精準提取 HEX 色碼（背景色、主視覺色、強調色），規範 60-30-10 比例與負面色彩禁令。
2. 【排版拓撲與卡片】：識別是否為橫向步驟流、痛點對照、三維立體卡片或數據看板，給出容器規格。
3. 【NotebookLM 專用結構化提示詞】：
   - 請分別輸出：
     【模式 1：通篇風格統一提示詞 (Global Style Prompt)】
     【模式 2：逐頁 1:1 骨架精確提示詞 (Slide-by-Slide Structural Prompt)】
"""
    parts.append(types.Part.from_text(text=user_prompt))

    # 候選模型清單（按新版相容性順序）
    configured_model = config.get("gemini_model", "gemini-3.5-flash")
    candidate_models = [configured_model, "gemini-3.5-flash", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.1-pro-preview"]
    # 去重保留順序
    seen = set()
    candidate_models = [m for m in candidate_models if not (m in seen or seen.add(m))]

    analysis_text = ""
    used_model = ""

    for model_name in candidate_models:
        try:
            with ProgressTimer(f"正在傳送 {len(images)} 張圖片由 {model_name} 進行多模態逆向分析 (約需 20~35 秒)"):
                response = client.models.generate_content(
                    model=model_name,
                    contents=parts,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.3
                    )
                )
                analysis_text = response.text or ""
                used_model = model_name
            break
        except Exception as err:
            err_str = str(err)
            print(f"\n⚠️ 調用 {model_name} 失敗: {err_str}，切換備援模型...", flush=True)
            time.sleep(1)

    if not analysis_text:
        print("❌ 所有 Gemini 候選模型皆無法回應，請檢查 API Key 或網路連線。", flush=True)
        sys.exit(1)

    # 儲存報告
    report_file = DIR_PROMPTS / "full_analysis_report.md"
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(analysis_text)

    # 提取模式 1 (Global) 與模式 2 (Slide)
    global_prompt = ""
    slide_prompt = ""

    if "模式 1" in analysis_text:
        m1_parts = analysis_text.split("模式 1")[-1]
        if "模式 2" in m1_parts:
            global_prompt = m1_parts.split("模式 2")[0].strip()
        else:
            global_prompt = m1_parts.strip()
    
    if "模式 2" in analysis_text:
        slide_prompt = analysis_text.split("模式 2")[-1].strip()

    if not global_prompt:
        global_prompt = analysis_text[:1200]
    if not slide_prompt:
        slide_prompt = analysis_text

    global_prompt_clean = re.sub(r"^#+.*", "", global_prompt, flags=re.MULTILINE).strip()
    slide_prompt_clean = re.sub(r"^#+.*", "", slide_prompt, flags=re.MULTILINE).strip()

    with open(DIR_PROMPTS / "nblm_prompt_global.txt", "w", encoding="utf-8") as f:
        f.write(global_prompt_clean)
    with open(DIR_PROMPTS / "nblm_prompt_slide.txt", "w", encoding="utf-8") as f:
        f.write(slide_prompt_clean)

    chosen_mode = config.get("prompt_mode", "global")
    chosen_prompt = global_prompt_clean if chosen_mode == "global" else slide_prompt_clean

    print(f"📝 成功產出 NotebookLM 專用提示詞（已存入 output/02_prompts/）", flush=True)
    return chosen_prompt, global_prompt_clean, slide_prompt_clean


# =============================================================================
# 4. 步驟三：Playwright 操控 Chrome 自動生成與截圖 (NotebookLM Automation)
# =============================================================================
def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def get_browser_session(p, config: dict):
    """
    自適應獲取 Chrome 瀏覽器 Session：
    1. 若已有 Chrome 在 9222 遠端埠監聽，直接透過 CDP 連接。
    2. 若無，直接透過 launch_persistent_context 喚醒使用者登入設定檔（原汁原味零延遲）。
    """
    port = config.get("cdp_port", 9222)
    profile_dir = os.path.expandvars(config.get("chrome_profile_dir", r"%LOCALAPPDATA%\Google\Chrome\AutomationProfile"))
    os.makedirs(profile_dir, exist_ok=True)

    if is_port_in_use(port):
        print(f"🔌 檢測到已在運行的 Chrome (端口 {port})，透過 CDP 快速掛載...", flush=True)
        try:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            context = browser.contexts[0]
            return browser, context, False
        except Exception as e:
            print(f"⚠️ CDP 掛載失敗: {e}，切換為原生持久化環境啟動...", flush=True)

    print(f"🚀 啟動專用 Chrome 瀏覽器環境 (目錄: {profile_dir})...", flush=True)
    context = p.chromium.launch_persistent_context(
        user_data_dir=profile_dir,
        channel="chrome",
        headless=False,
        args=[
            f"--remote-debugging-port={port}",
            "--no-first-run",
            "--no-default-browser-check"
        ]
    )
    return None, context, True


def drive_notebooklm_and_capture(prompt_text: str, config: dict) -> List[Path]:
    print("\n" + "=" * 60, flush=True)
    print("🌐 [步驟 3/5] Playwright 操控 NotebookLM 自動生成與截圖...", flush=True)
    print("=" * 60, flush=True)

    # 清空上次生成的截圖
    for f in DIR_NBLM_SLIDES.glob("*.png"):
        try:
            f.unlink()
        except Exception:
            pass

    captured_slides: List[Path] = []

    with sync_playwright() as p:
        browser, context, is_persistent = get_browser_session(p, config)

        # 關閉任何遺留的 /artifact/ 獨立分頁
        for pg in list(context.pages):
            if "/artifact/" in pg.url:
                try:
                    pg.close()
                except Exception:
                    pass

        # 獲取或開啟筆記本頁面
        target_page = None
        for pg in context.pages:
            if "/notebook/" in pg.url and "/artifact/" not in pg.url:
                target_page = pg
                break

        if not target_page:
            for pg in context.pages:
                if "notebook.google.com" in pg.url or "notebooklm.google.com" in pg.url:
                    target_page = pg
                    break

        if not target_page:
            target_page = context.pages[0] if context.pages else context.new_page()

        # 導向目標筆記本
        target_notebook = config.get("notebook_url")
        if target_notebook and ("/notebook/" not in target_page.url or target_page.url.rstrip("/").endswith("notebook.google.com")):
            print(f"📖 正在導向您的專屬筆記本: {target_notebook}", flush=True)
            target_page.goto(target_notebook, wait_until="domcontentloaded")
            time.sleep(3)
        elif "/notebook/" not in target_page.url:
            print("📑 檢測到目前位於 NotebookLM 首頁，正在開啟第一本筆記本...", flush=True)
            card = target_page.locator("a[href*='/notebook/'], .project-card, [role='button']:has-text('筆記本')").first
            if card.is_visible(timeout=4000):
                card.click()
                time.sleep(3)

        target_page.bring_to_front()
        print(f"👀 目標筆記本頁面: {target_page.url}", flush=True)

        # 等待筆記本核心組件加載
        try:
            target_page.wait_for_selector(".studio-panel, artifact-library-item, button:has-text('簡報')", timeout=10000)
        except Exception:
            pass

        # 1. 確保不在記事編輯狀態（若在編輯狀態，點擊工作室回到首頁）
        target_page.evaluate('''() => {
            const all = Array.from(document.querySelectorAll('*'));
            for (const el of all) {
                if (el.textContent.trim() === '工作室' && el.children.length === 0) {
                    el.click();
                    break;
                }
            }
        }''')
        time.sleep(1)

        # 2. 檢查來源數量是否為 0；若為 0，自動新增一則記事來源
        sources_count_text = target_page.evaluate('''() => {
            const el = document.querySelector('.selected-num');
            return el ? el.textContent.trim() : '0';
        }''')

        if "0" in sources_count_text or not sources_count_text:
            print("📝 檢測到筆記本中尚無來源，正在自動建立基礎內容記事...", flush=True)
            note_btn = target_page.locator("button:has-text('記事'), [role='button']:has-text('記事')").first
            if note_btn.is_visible(timeout=3000):
                note_btn.click()
                time.sleep(1.5)
                target_page.keyboard.type("主題：企業商業策略與年度展望簡報。\n本簡報旨在呈現最新業務成長數據、市場定位與核心產品競爭優勢。包含痛點分析、雙軸矩陣、步驟流程與成果指標。")
                time.sleep(1)
                target_page.keyboard.press("Escape")
                time.sleep(1.5)
                target_page.evaluate('''() => {
                    const all = Array.from(document.querySelectorAll('*'));
                    for (const el of all) {
                        if (el.textContent.trim() === '工作室' && el.children.length === 0) {
                            el.click();
                            break;
                        }
                    }
                }''')
                time.sleep(1)
                print("✅ 基礎來源記事已就緒！", flush=True)

        # 記錄生成前的產物數量
        initial_artifact_count = target_page.locator("artifact-library-item").count()
        print(f"📦 生成前已存在的產物數量: {initial_artifact_count}")

        # 3. 點擊工作室頂部「簡報」按鈕
        dialog_already_open = target_page.evaluate('''() => {
            return document.querySelector('mat-dialog-container') !== null;
        }''')

        if not dialog_already_open:
            print("🎯 正在點擊「簡報」卡片喚起自訂對話框...", flush=True)
            target_page.evaluate('''() => {
                const all = Array.from(document.querySelectorAll('*'));
                for (const el of all) {
                    if (el.textContent.trim() === '簡報' && el.children.length === 0) {
                        const target = el.closest('button') || el.closest('[role="button"]') || el.parentElement || el;
                        target.click();
                        return true;
                    }
                }
                return false;
            }''')
            time.sleep(2)

        # 4. 選取「簡報投影片」選項
        target_page.evaluate('''() => {
            const all = Array.from(document.querySelectorAll('*'));
            for (const el of all) {
                if (el.textContent.includes('簡報投影片') && el.children.length === 0) {
                    const target = el.closest('[role="button"]') || el.closest('div') || el;
                    target.click();
                    break;
                }
            }
        }''')
        time.sleep(1)

        # 5. 填入提示詞至 textarea 並點擊「立即生成」
        prompt_textarea = target_page.locator("textarea[placeholder*='大綱'], mat-dialog-container textarea").first
        if prompt_textarea.is_visible(timeout=5000):
            print("✍️ 正在將 AI 逆向提示詞填入 NotebookLM 自訂簡報輸入框...", flush=True)
            prompt_textarea.fill(prompt_text)
            time.sleep(1)

            # 點擊「立即生成」按鈕
            gen_btn = target_page.locator("mat-dialog-container button:has-text('立即生成'), button:has-text('立即生成')").first
            if gen_btn.is_visible(timeout=3000):
                gen_btn.click()
                print("🚀 已成功點擊【立即生成】按鈕，觸發 NotebookLM 算繪！", flush=True)
            else:
                target_page.evaluate('''() => {
                    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
                    const btn = btns.find(b => b.textContent.includes('立即生成'));
                    if (btn) { btn.click(); return true; }
                    return false;
                }''')
                print("🚀 已透過 JS 點擊【立即生成】按鈕！", flush=True)
        else:
            print("⚠️ 未檢測到自訂簡報輸入框，可能已在進行生成。", flush=True)

        # 給予 3 秒讓前端初始化算繪狀態
        time.sleep(3)

        # 6. 動態輪詢等待 NotebookLM 算繪完成（全時守護，絕不早退）
        print("\n" + "─" * 60, flush=True)
        max_wait_seconds = config.get("generation_timeout_seconds", 600)  # 充裕守護 600 秒 (10 分鐘)
        start_wait_time = time.time()
        last_reload_time = 0

        with ProgressTimer(f"NotebookLM 正在為您繪製簡報與視覺細節 (最多守護 {max_wait_seconds} 秒，算繪完成即刻自動推進)"):
            while True:
                time.sleep(3)
                elapsed = int(time.time() - start_wait_time)

                # 實時偵測算繪狀態
                items = target_page.locator("artifact-library-item")
                current_count = items.count()
                first_text = items.first.inner_text() if current_count > 0 else ""

                is_shimmering = target_page.locator(".shimmer-yellow, [class*='shimmer'], [class*='loading']").count() > 0
                has_gen_text = any(k in first_text for k in ["正在生成", "正在完成", "progress_activity", "準備程序", "生成中"])
                is_generating = is_shimmering or has_gen_text

                # 只要「生成中/準備程序」文字完全消失，且第一個項目已是就緒的簡報（具備 tablet 圖標或非 loading 標題）
                if elapsed >= 45:
                    if not is_generating and ("tablet" in first_text or current_count > initial_artifact_count):
                        # 算繪成功完成，立即跳出！
                        break

                # 每隔 150 秒進行一次溫和重新整理，確保 Google 雲端 WebSocket 同步
                if elapsed >= 150 and (elapsed - last_reload_time >= 150) and is_generating:
                    target_page.reload(wait_until="domcontentloaded")
                    time.sleep(5)
                    last_reload_time = elapsed

                # 若超過設定的守護上限
                if elapsed > max_wait_seconds:
                    if not is_generating:
                        break
                    # 若仍在生成，多給 60 秒極限緩衝
                    if elapsed > max_wait_seconds + 60:
                        print(f"\n⚠️ 雲端算繪已達守護上限 ({elapsed} 秒)，嘗試繼續後續流程...", flush=True)
                        break
                    if elapsed % 30 == 0:
                        target_page.reload(wait_until="domcontentloaded")
                        time.sleep(5)

        print("─" * 60, flush=True)
        print("✅ NotebookLM 簡報算繪完成！", flush=True)
        time.sleep(2)

        # 7. 點擊最新產出的簡報，並獲取專屬檢視器
        print("🔍 正在定位最新生成的投影片並開啟 16:9 純淨檢視器...", flush=True)
        try:
            target_page.wait_for_selector("artifact-library-item", timeout=10000)
        except Exception:
            pass

        newest_item = target_page.locator("artifact-library-item").first
        newest_title = newest_item.inner_text().replace("\n", " | ")
        print(f"🎯 目標簡報: {newest_title}", flush=True)

        # 點擊項目以展開
        newest_btn = newest_item.locator("button.artifact-stretched-button, .artifact-item-button").first
        newest_btn.click(force=True)
        time.sleep(2)

        # 尋找 open_in_new 按鈕並提取 artifact_id
        target_notebook_id = ""
        target_artifact_id = ""

        # 嘗試從 open_in_new 按鈕的 jslog base64 提取精確的 artifact ID
        open_btn = target_page.locator("button:has(mat-icon:has-text('open_in_new'))").first
        if open_btn.is_visible(timeout=4000):
            jslog_str = open_btn.get_attribute("jslog") or ""
            # jslog 格式: 359929;track:...;0:<BASE64>
            match = re.search(r"0:([A-Za-z0-9+/=]+)", jslog_str)
            if match:
                try:
                    decoded = base64.b64decode(match.group(1)).decode("latin1", errors="ignore")
                    ids = re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", decoded)
                    if len(ids) >= 2:
                        target_notebook_id = ids[0]
                        target_artifact_id = ids[1]
                except Exception:
                    pass

        # 若成功提取到 ID，直接導向專屬 16:9 檢視頁面（100% 免疫彈窗攔截與分頁競態）
        art_page = None
        if target_notebook_id and target_artifact_id:
            artifact_url = f"https://notebook.google.com/notebook/{target_notebook_id}/artifact/{target_artifact_id}"
            print(f"🚀 直達純淨簡報檢視器: {artifact_url}", flush=True)
            art_page = context.new_page()
            art_page.goto(artifact_url, wait_until="domcontentloaded")
        else:
            # 備援：透過點擊 open_in_new 開啟新分頁
            if open_btn.is_visible():
                try:
                    with context.expect_page(timeout=8000) as p_info:
                        open_btn.click()
                    art_page = p_info.value
                    art_page.wait_for_url("**/artifact/**", timeout=12000)
                except Exception:
                    pass

        if not art_page:
            # 最後備援：使用目前分頁
            art_page = target_page

        art_page.bring_to_front()

        # 等待縮圖導航器加載
        try:
            art_page.wait_for_selector(".thumbnail-container", timeout=15000)
        except Exception:
            pass

        thumbs = art_page.locator(".thumbnail-container")
        thumb_count = thumbs.count()
        print(f"📑 檢測到投影片頁數: {thumb_count} 頁，開始逐頁 16:9 高清截圖...", flush=True)

        # 8. 逐頁截取純淨 16:9 投影片畫面
        slide_limit = min(thumb_count, config.get("slide_page_limit", 6))
        if thumb_count > 0:
            for idx in range(slide_limit):
                thumbs.nth(idx).click()
                time.sleep(2.0)  # 確保 Google 高清 SVG/WebP 算繪就緒

                shot_path = DIR_NBLM_SLIDES / f"generated_slide_{idx+1:02d}.png"
                img_el = art_page.locator("image-viewer img, .image-viewer-container img").first
                
                if img_el.is_visible():
                    # 像素級裁切投影片核心畫面（去除任何按鈕邊框）
                    img_el.screenshot(path=str(shot_path))
                else:
                    # 全頁截圖備援
                    art_page.screenshot(path=str(shot_path))

                captured_slides.append(shot_path)
                print(f"   📸 已截取第 {idx+1}/{slide_limit} 頁 -> generated_slide_{idx+1:02d}.png", flush=True)
        else:
            print("⚠️ 未偵測到投影片縮圖列，嘗試使用全域畫面截圖...", flush=True)
            for idx in range(1, 4):
                shot_path = DIR_NBLM_SLIDES / f"generated_slide_{idx:02d}.png"
                art_page.screenshot(path=str(shot_path))
                captured_slides.append(shot_path)
                art_page.keyboard.press("ArrowRight")
                time.sleep(1.5)

        # 若開啟了獨立的 artifact 分頁，關閉它以保持整潔
        if art_page != target_page and "/artifact/" in art_page.url:
            try:
                art_page.close()
            except Exception:
                pass

        if is_persistent:
            context.close()

    print(f"🎉 成功截取 {len(captured_slides)} 張生成畫面，已儲存至 output/03_nblm_slides/", flush=True)
    return captured_slides


# =============================================================================
# 5. 步驟四：AI 視覺質檢與自動優化診斷 (原圖 vs 生成圖 成對評分)
# =============================================================================
def evaluate_and_optimize(original_images: List[Path], generated_images: List[Path], config: dict) -> dict:
    print("\n" + "=" * 60, flush=True)
    print("⚖️ [步驟 4/5] 啟動 AI 視覺質檢官進行『原圖 vs 生成圖』成對比對與診斷...", flush=True)
    print("=" * 60, flush=True)

    if not generated_images:
        print("⚠️ 未檢測到生成的投影片截圖，跳過視覺評估。", flush=True)
        return {}

    client = genai.Client(api_key=config["gemini_api_key"])

    parts = []
    compare_count = min(len(original_images), len(generated_images), 3)
    for i in range(compare_count):
        with open(original_images[i], "rb") as f:
            parts.append(types.Part.from_bytes(data=f.read(), mime_type="image/png"))
        with open(generated_images[i], "rb") as f:
            parts.append(types.Part.from_bytes(data=f.read(), mime_type="image/png"))

    eval_instruction = """
你是一位頂級簡報美學質檢官與 NotebookLM 提示詞優化專家。
你手上有【使用者期望復刻的原始簡報】與【NotebookLM 依據提示詞實際生成的投影片截圖】。

請以嚴格客觀的角度進行深度品質審查，並輸出繁體中文 Markdown 報告：
# 📊 NotebookLM 生成成效視覺評估報告

## 1. 核心評分指標 (0-100 分)
* **版型幾何結構還原度 (Layout Fidelity)**: [分數] - 說明：是否還原卡片、步驟流、雙軸矩陣？有無退化成條列式文字？
* **色彩系統與配比還原度 (Palette Match)**: [分數] - 說明：底色對比是否足夠？主色與強調色比例是否符合 60-30-10？
* **視覺密度與節奏感 (Typography & Rhythm)**: [分數] - 說明：標題字級、內文長度是否得宜？文字有無爆框擠壓？
* **綜合還原總分 (Overall Alignment Score)**: [加權總分]

## 2. 具體視覺偏差診斷 (Deviations & Inconsistencies)
* 條列具體哪一頁、哪個組件失真或表現不理想。

## 3. 提示詞強化對策 (Prompt Hardening & Guardrails)
* 精準給出 2~4 條可立即補入下一次提示詞的「硬性約束規範（Negative Prompts & Strict Constraints）」，防止 NotebookLM 再次產生樣式偏差。
"""

    eval_prompt = f"請逐頁比對上述 {compare_count} 組投影片（前一張為原始設計，後一張為 NotebookLM 生成成果），產出詳細評分與優化診斷。"
    parts.append(types.Part.from_text(text=eval_prompt))

    report_markdown = ""
    configured_model = config.get("gemini_model", "gemini-3.5-flash")
    candidate_models = [configured_model, "gemini-3.5-flash", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.1-pro-preview"]
    seen = set()
    candidate_models = [m for m in candidate_models if not (m in seen or seen.add(m))]

    for m in candidate_models:
        try:
            with ProgressTimer(f"質檢模型 {m} 正在比對視覺差異並打分"):
                resp = client.models.generate_content(
                    model=m,
                    contents=parts,
                    config=types.GenerateContentConfig(
                        system_instruction=eval_instruction,
                        temperature=0.2
                    )
                )
                report_markdown = resp.text or ""
            break
        except Exception as e:
            print(f"\n⚠️ {m} 評估略過: {e}", flush=True)

    report_path = DIR_EVALUATIONS / "evaluation_report.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_markdown)

    print(f"📝 視覺質檢報告已產出！儲存於: {report_path}", flush=True)

    # 提煉控制台摘要
    print("\n" + "─" * 60, flush=True)
    print("🏆 【AI 視覺質檢核心摘要】", flush=True)
    print("─" * 60, flush=True)
    lines = report_markdown.split("\n")
    for line in lines[:35]:
        if any(k in line for k in ["還原度", "總分", "評分", "指標", "偏差", "對策", "*", "#", "分數", "建議"]):
            try:
                print(line, flush=True)
            except Exception:
                print(line.encode("ascii", errors="ignore").decode("ascii"), flush=True)
    print("─" * 60, flush=True)

    return {"report_path": str(report_path), "report_markdown": report_markdown}


#

def extract_rules_from_report(report_markdown: str) -> List[Dict[str, str]]:
    """從 AI 質檢報告的第 3 節提取約束規則"""
    rules = []
    if "## 3. 提示詞強化對策" not in report_markdown:
        return rules
    
    sec3 = report_markdown.split("## 3. 提示詞強化對策", 1)[1]
    sec3 = re.split(r"\n##\s+", sec3)[0]

    lines = sec3.splitlines()
    curr_title = None
    curr_rule_lines = []

    for line in lines:
        stripped = line.strip()
        m = re.match(r"^(?:\d+\.|\*|-)\s+\*\*\[?([^\]\*]+)\]?\*\*(?:\s*[:：])?\s*(.*)$", stripped)
        if m:
            if curr_title and curr_rule_lines:
                rule_text = " ".join(curr_rule_lines).strip("` ")
                if rule_text:
                    rules.append({"title": curr_title, "rule": rule_text})
                curr_rule_lines = []
            curr_title = m.group(1).strip()
            rest = m.group(2).strip()
            if rest:
                curr_rule_lines.append(rest)
        elif curr_title and stripped and not stripped.startswith("##"):
            curr_rule_lines.append(stripped)

    if curr_title and curr_rule_lines:
        rule_text = " ".join(curr_rule_lines).strip("` ")
        if rule_text:
            rules.append({"title": curr_title, "rule": rule_text})

    return rules


# =============================================================================
# 6. 步驟五：自動閉環反饋與網站同步 (Auto-Sync & Git Push)
# =============================================================================
def auto_harden_and_sync_website(eval_result: dict, config: dict) -> None:
    print("\n" + "=" * 60, flush=True)
    print("🔄 [步驟 5/5] 自動閉環反饋：將本次質檢診斷同步至網站提示詞引擎...", flush=True)
    print("=" * 60, flush=True)

    report_markdown = eval_result.get("report_markdown", "")
    if not report_markdown:
        print("⚠️ 無質檢報告可供反饋。", flush=True)
        return

    # 1. 自動從質檢報告中提煉約束規則
    extracted_rules = extract_rules_from_report(report_markdown)
    
    # 2. 自動合併至 guardrails.json
    guardrails_file = PROJECT_ROOT / "guardrails.json"
    guardrails_data = {"version": "1.0.0", "updated_at": "", "rules": []}
    
    if guardrails_file.exists():
        try:
            with open(guardrails_file, "r", encoding="utf-8") as f:
                guardrails_data = json.load(f)
        except Exception as e:
            print(f"⚠️ 讀取現有 guardrails.json 失敗: {e}，將建立新檔", flush=True)

    existing_rules = guardrails_data.get("rules", [])
    existing_texts = {r.get("rule", "").strip().lower() for r in existing_rules if "rule" in r}
    new_added_count = 0

    for r in extracted_rules:
        rt = r.get("rule", "").strip()
        if rt and rt.lower() not in existing_texts:
            slug = re.sub(r"[^a-zA-Z0-9_]+", "_", r.get("title", "rule")).strip("_") or "rule"
            existing_rules.append({
                "id": f"{slug}_{int(time.time())}",
                "title": r.get("title", "視覺約束規範"),
                "rule": rt
            })
            existing_texts.add(rt.lower())
            new_added_count += 1
            print(f"   ➕ 自動納入新規範: 【{r.get('title')}】", flush=True)

    guardrails_data["rules"] = existing_rules
    guardrails_data["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")

    with open(guardrails_file, "w", encoding="utf-8") as f:
        json.dump(guardrails_data, f, ensure_ascii=False, indent=2)

    # 3. 儲存本次執行紀錄
    active_guardrails_file = DIR_EVALUATIONS / "active_guardrails.json"
    with open(active_guardrails_file, "w", encoding="utf-8") as f:
        json.dump({
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source_report": str(eval_result.get("report_path", "")),
            "new_rules_added": new_added_count,
            "total_rules": len(existing_rules),
            "status": "synchronized"
        }, f, ensure_ascii=False, indent=2)

    print(f"📝 規則庫已更新 (新增 {new_added_count} 條，累計 {len(existing_rules)} 條約束)", flush=True)

    # 4. 自動執行 Git 提交與推播至遠端 GitHub
    try:
        subprocess.run(
            ["git", "-C", str(PROJECT_ROOT), "add", "guardrails.json", "app.py"],
            check=True
        )
        cmd_status = subprocess.run(
            ["git", "-C", str(PROJECT_ROOT), "status", "--porcelain"],
            capture_output=True, text=True
        )
        if cmd_status.stdout.strip():
            print("📦 正在將最新約束規範提交至 GitHub 儲存庫...", flush=True)
            commit_msg = f"feat(guardrails): auto-sync learned constraints ({time.strftime('%Y-%m-%d %H:%M')})"
            subprocess.run(
                ["git", "-C", str(PROJECT_ROOT), "commit", "-m", commit_msg],
                check=True
            )
            subprocess.run(
                ["git", "-C", str(PROJECT_ROOT), "push", "origin", "main"],
                check=True
            )
            print("🚀 ✅ 網站提示詞引擎已全自動升級並推播至 GitHub 遠端儲存庫！", flush=True)
        else:
            print("✅ 提示詞約束規則庫已是最新狀態，無需重複推播。", flush=True)
    except Exception as g_err:
        print(f"⚠️ 自動 Git 推播略過: {g_err}（本機規則庫已成功更新）", flush=True)


# =============================================================================
# 7. 主流程串接 (Master Loop)
# =============================================================================
def main():
    print("""
=============================================================================
   🚀 NBLM Auto-Pilot 投影片全自動閉環逆向優化器
   Version: 2.1.0 (Closed-Loop Self-Evolution & Web Sync)
=============================================================================
    """, flush=True)

    config = load_config()
    extracted_slides = extract_input_slides(limit=config.get("slide_page_limit", 6), config=config)
    prompt_text, global_p, slide_p = reverse_engineer_prompt(extracted_slides, config)
    captured_slides = drive_notebooklm_and_capture(prompt_text, config)

    if config.get("auto_evaluate", True):
        eval_result = evaluate_and_optimize(extracted_slides, captured_slides, config)
        auto_harden_and_sync_website(eval_result, config)

    print("\n" + "=" * 60, flush=True)
    print("全流程閉環自動化執行完畢。", flush=True)
    print(f"📁 原始影像抽取區: {DIR_EXTRACTED}", flush=True)
    print(f"📁 逆向提示詞目錄: {DIR_PROMPTS}", flush=True)
    print(f"📁 NotebookLM 截圖區: {DIR_NBLM_SLIDES}", flush=True)
    print(f"📁 評估與優化報告: {DIR_EVALUATIONS}", flush=True)
    print("=" * 60 + "\n", flush=True)


if __name__ == "__main__":
    main()
