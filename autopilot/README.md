# 🤖 NBLM Auto-Pilot (全自動投影片逆向與生成閉環系統)

> **「你只負責丟簡報，後續解析 ➔ NotebookLM 生成 ➔ 截圖質檢 ➔ 自動反饋優化 全程由 AI 代理完成！」**

---

## 🌟 核心特色

1. **極致解放雙手**：只要把想復刻的簡報（PDF、PPTX 或多張截圖）放入 `autopilot/input/` 目錄。
2. **多模態深層逆向**：自動由 Google Gemini Vision 呼叫 `nblm-slide-reverser` 核心，提煉精準的 60-30-10 配色與 NotebookLM 結構化版型提示詞。
3. **Playwright 瀏覽器自動代理**：
   * 透過 Chrome 遠端除錯通道（Port 9222）接管瀏覽器。
   * 自動打開 NotebookLM、填入提示詞、觸發生成、監控算繪進度。
   * 生成完畢自動逐頁高解析度截圖儲存。
4. **AI 視覺質檢評估 (Ground Truth Calibration)**：
   * 拿「原始簡報」與「NotebookLM 截圖」逐頁成對評比。
   - 自動給出「版型結構分數」、「色彩準確度」、「文字節奏評分」。
   - 自動診斷樣式偏差，並產出下一輪的「約束規範（Guardrails）」。

---

## 📁 目錄結構

```text
nblm-slide-reverser/autopilot/
├── input/                  <-- [您只需要把簡報放這裡！]
│   └── 我的目標風格簡報.pdf
├── output/                 <-- [系統自動產生的成果]
│   ├── 01_extracted/       (從原簡報抽取出的高清頁面)
│   ├── 02_prompts/         (反推生成的 NotebookLM 專用提示詞)
│   ├── 03_nblm_slides/     (NotebookLM 實際生成的截圖)
│   └── 04_evaluations/     (AI 視覺質檢評分與優化診斷報告)
├── config.json             (設定檔：API Key、模型、端口)
├── 啟動測試專用Chrome.bat  (一鍵啟動獨立除錯 Chrome)
├── 一鍵自動閉環優化.bat    (雙擊執行全自動閉環測試)
└── nblm_pilot.py           (Python 自動化核心)
```

---

## 🚀 第一次使用：超簡單 3 步驟

### 步驟 1：啟動專用瀏覽器（只需登入一次）
* 雙擊執行 **`啟動測試專用Chrome.bat`**。
* 此時會開啟一個乾淨且獨立的 Chrome 視窗（不會影響您平常使用的 Chrome 與分頁）。
* 請在該視窗中**登入您的 Google 帳號一次**，登入後即可隨時放著，後續無須再次輸入密碼！

### 步驟 2：放入想復刻的簡報或提供網址
* **方式 A（本機檔案）**：把您想復刻的簡報檔案（支援 `.pdf`、`.pptx` 或 `.png`、`.jpg` 圖片），直接複製貼進 **`autopilot/input/`** 資料夾中。
* **方式 B（線上網址自動爬取）**：在 **`autopilot/input/`** 中放入 `urls.txt`（直接填入網址）或 Windows `.url` 捷徑；亦可在 `config.json` 中配置 `"source_url": "https://..."`。
  * 支援類型：Google Slides 連結、線上簡報平台（Speaker Deck、SlideShare、Gamma 等）、公開 PDF / 圖片 URL、或一般品牌 Landing Page（自動分屏截圖）。
* *(註：若 input 內為空，系統會自動使用內建的 5 張 Demo 簡報進行測試演示)*

### 步驟 3：一鍵啟動自動閉環
* 雙擊執行 **`一鍵自動閉環優化.bat`**。
* 系統將全自動進行：
  1. 抽取簡報前 6 頁高清圖。
  2. Gemini 多模態逆向提取風格與版型。
  3. 自動在 Chrome 中操作 NotebookLM 貼上提示詞並生成。
  4. 自動逐頁截圖。
  5. 自動由 AI 質檢官比對原圖與產出圖，輸出 Markdown 評分診斷！

---

## ⚙️ 進階設定 (`config.json`)

* `gemini_api_key`: Google Gemini API 金鑰（首次執行若未輸入，終端機亦會提示您貼上並自動儲存）。
* `gemini_model`: 預設使用 `gemini-2.5-flash`，具備秒級多模態分析效能。
* `slide_page_limit`: 每次提取分析的頁數上限（預設 6 頁，可自由調整為 10、15、20 等；設為 `0` 則代表辨識整份簡報全部頁數，不設上限）。
* `eval_max_pairs`: 步驟四成對品質質檢的最大比對組數（預設 10 組）。
* `prompt_mode`: `global` (模式 1：通篇風格統一) 或 `slide` (模式 2：逐頁 1:1 精確骨架)。
