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
  4. 自動將 NotebookLM 產出的投影片逐頁高解析截圖
  5. 由 AI 視覺質檢官進行「原圖 vs 生成圖」成對比對、打分、診斷走鐘並輸出優化建議
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
        "gemini_model": "gemini-2.5-flash",
        "notebooklm_url": "https://notebooklm.google.com/",
        "cdp_port": 9222,
        "cdp_url": "http://127.0.0.1:9222",
        "chrome_profile_dir": os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\AutomationProfile"),
        "slide_page_limit": 6,
        "prompt_mode": "global",
        "auto_evaluate": True
    }
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                user_conf = json.load(f)
                default_config.update(user_conf)
        except Exception as e:
            print(f"[警告] 讀取 config.json 失敗: {e}，使用預設值", flush=True)

    # 檢查環境變數
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
def extract_input_slides(limit: int = 6) -> List[Path]:
    print("\n" + "=" * 60, flush=True)
    print("📂 [步驟 1/5] 掃描輸入檔案並提取投影片影像...", flush=True)
    print("=" * 60, flush=True)

    # 清空先前的抽取目錄
    for f in DIR_EXTRACTED.glob("*.png"):
        try:
            f.unlink()
        except Exception:
            pass

    input_files = []
    for ext in ["*.pdf", "*.pptx", "*.png", "*.jpg", "*.jpeg", "*.webp"]:
        input_files.extend(list(DIR_INPUT.glob(ext)))

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
        from app import SYSTEM_INSTRUCTION
        system_instruction = SYSTEM_INSTRUCTION
        print("✅ 成功掛載 nblm-slide-reverser 官方設計師系統提示詞核心！", flush=True)
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

    candidate_models = [config.get("gemini_model", "gemini-2.5-flash"), "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
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


def ensure_chrome_running(config: dict) -> None:
    port = config.get("cdp_port", 9222)
    if is_port_in_use(port):
        print(f"🔌 檢測到 Chrome 遠端除錯連接埠 {port} 已就緒！", flush=True)
        return

    print(f"🚀 端口 {port} 尚未啟動，正在為您喚起自動化專用 Chrome...", flush=True)
    profile_dir = config.get("chrome_profile_dir", os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\AutomationProfile"))
    os.makedirs(profile_dir, exist_ok=True)

    chrome_candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "chrome.exe"
    ]
    chrome_bin = None
    for c in chrome_candidates:
        if os.path.exists(c):
            chrome_bin = c
            break

    if not chrome_bin:
        chrome_bin = "chrome.exe"

    cmd = [
        chrome_bin,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        config.get("notebooklm_url", "https://notebooklm.google.com/")
    ]
    try:
        subprocess.Popen(cmd)
        print("⏳ 等待 Chrome 端口回應中...", flush=True)
        for _ in range(15):
            time.sleep(1)
            if is_port_in_use(port):
                print(f"✅ Chrome 已成功啟動於端口 {port}！", flush=True)
                return
    except Exception as e:
        print(f"❌ 啟動 Chrome 失敗: {e}", flush=True)
        print("💡 請手動執行「啟動測試專用Chrome.bat」後再重新執行本腳本。", flush=True)
        sys.exit(1)


def drive_notebooklm_and_capture(prompt_text: str, config: dict) -> List[Path]:
    print("\n" + "=" * 60, flush=True)
    print("🌐 [步驟 3/5] Playwright 自動掛載 Chrome 操控 NotebookLM 生成簡報...", flush=True)
    print("=" * 60, flush=True)

    for f in DIR_NBLM_SLIDES.glob("*.png"):
        try:
            f.unlink()
        except Exception:
            pass

    ensure_chrome_running(config)
    cdp_url = config.get("cdp_url", "http://127.0.0.1:9222")

    captured_slides: List[Path] = []

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(cdp_url)
        except Exception as c_err:
            print(f"❌ 無法透過 CDP 連接 Chrome ({c_err})", flush=True)
            return captured_slides

        contexts = browser.contexts
        target_page = None

        for ctx in contexts:
            for pg in ctx.pages:
                if "notebook.google.com" in pg.url or "notebooklm.google.com" in pg.url:
                    target_page = pg
                    break
            if target_page:
                break

        if not target_page:
            target_page = contexts[0].new_page()
            target_page.goto("https://notebooklm.google.com/", wait_until="domcontentloaded")
            time.sleep(3)

        target_page.bring_to_front()
        print(f"👀 目標筆記本頁面: {target_page.url}", flush=True)

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

        # 3. 點擊右側工作室「簡報」按鈕（若已開過自訂對話框則略過）
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

        # 4. 尋找對話框中的「簡報投影片」選項並選取
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

        # 5. 填入提示詞至 textarea
        prompt_textarea = target_page.locator("textarea[placeholder*='大綱'], mat-dialog-container textarea").first
        if prompt_textarea.is_visible(timeout=5000):
            print("✍️ 正在將 AI 逆向提示詞填入 NotebookLM 自訂簡報輸入框...", flush=True)
            prompt_textarea.fill(prompt_text)
            time.sleep(1)

            # 點擊「產生」按鈕
            gen_btn = target_page.locator("mat-dialog-container button:has-text('產生')").first
            if gen_btn.is_visible(timeout=3000):
                gen_btn.click()
                print("🚀 已觸發 NotebookLM 簡報算繪！", flush=True)
            else:
                target_page.keyboard.press("Control+Enter")
                print("🚀 已送出生成請求！", flush=True)
        else:
            print("⚠️ 未檢測到自訂簡報輸入框，可能已在進行生成。", flush=True)

        # 6. 動態等待 NotebookLM 算繪完成 (通常需 35~60 秒)
        print("\n" + "─" * 60, flush=True)
        with ProgressTimer("NotebookLM 正在為您生成高美感投影片 (約需 40~60 秒)"):
            for _ in range(70):
                time.sleep(1)
                dialog_visible = target_page.evaluate('''() => {
                    return document.querySelector('mat-dialog-container') !== null;
                }''')
                if not dialog_visible and _ > 35:
                    break
        print("─" * 60, flush=True)

        time.sleep(4)

        # 7. 點擊生成出的簡報以進入全螢幕/檢視器
        print("🔍 尋找生成完畢的簡報卡片並打開檢視...", flush=True)
        target_page.evaluate('''() => {
            const artifacts = Array.from(document.querySelectorAll('.artifact-item, .studio-artifact-card, [role="listitem"]'));
            if (artifacts.length > 0) {
                artifacts[artifacts.length - 1].click();
            }
        }''')
        time.sleep(3)

        # 8. 逐頁截取投影片畫面
        print("📸 正在為您逐頁截取 NotebookLM 產出的投影片...", flush=True)
        for page_idx in range(1, 6):
            shot_path = DIR_NBLM_SLIDES / f"generated_slide_{page_idx:02d}.png"
            try:
                target_page.screenshot(path=str(shot_path), timeout=5000, animations="disabled")
                captured_slides.append(shot_path)
            except Exception:
                try:
                    target_page.screenshot(path=str(shot_path), timeout=5000)
                    captured_slides.append(shot_path)
                except Exception:
                    pass
            target_page.keyboard.press("ArrowRight")
            time.sleep(1.5)

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

## 2. 具體走鐘診斷 (Deviations & Hallucinations)
* 條列具體哪一頁、哪個組件失真或表現不理想。

## 3. 提示詞強化對策 (Prompt Hardening & Guardrails)
* 精準給出 2~4 條可立即補入下一次提示詞的「硬性約束咒語（Negative Prompts）」，防止 NotebookLM 再次走鐘！
"""

    eval_prompt = f"請逐頁比對上述 {compare_count} 組投影片（前一張為原始設計，後一張為 NotebookLM 生成成果），產出詳細評分與優化診斷。"
    parts.append(types.Part.from_text(text=eval_prompt))

    report_markdown = ""
    candidate_models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"]
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
    for line in lines[:25]:
        if any(k in line for k in ["還原度", "總分", "評分", "指標", "走鐘", "對策", "*", "#"]):
            print(line, flush=True)
    print("─" * 60, flush=True)

    return {"report_path": str(report_path), "report_markdown": report_markdown}


# =============================================================================
# 6. 主流程串接 (Master Loop)
# =============================================================================
def main():
    print("""
=============================================================================
   🚀 NBLM Auto-Pilot 投影片全自動閉環逆向優化器
   Version: 1.1.0 (Live Progress & Precision Selectors)
=============================================================================
    """, flush=True)

    config = load_config()
    extracted_slides = extract_input_slides(limit=config.get("slide_page_limit", 6))
    prompt_text, global_p, slide_p = reverse_engineer_prompt(extracted_slides, config)
    captured_slides = drive_notebooklm_and_capture(prompt_text, config)

    if config.get("auto_evaluate", True):
        evaluate_and_optimize(extracted_slides, captured_slides, config)

    print("\n" + "=" * 60, flush=True)
    print("🎉 全流程閉環自動化完成！", flush=True)
    print(f"📁 原始影像抽取區: {DIR_EXTRACTED}", flush=True)
    print(f"📁 逆向提示詞目錄: {DIR_PROMPTS}", flush=True)
    print(f"📁 NotebookLM 截圖區: {DIR_NBLM_SLIDES}", flush=True)
    print(f"📁 評估與優化報告: {DIR_EVALUATIONS}", flush=True)
    print("=" * 60 + "\n", flush=True)


if __name__ == "__main__":
    main()
