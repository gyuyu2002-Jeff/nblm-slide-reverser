<div align="center">

# 🎨 簡報風格逆向解析
### Presentation Style Reverse-Engineer to NotebookLM Prompts

<p align="center">
  <strong>看見喜歡的簡報風格？上傳 PDF 或投影片截圖，AI 深度逆向視覺語意與排版幾何，一鍵產出最適配 NotebookLM 的相同風格拓撲提示詞！</strong>
</p>

### 🌐 [點此直接在線上使用（GitHub Pages 官方免安裝版）](https://gyuyu2002-jeff.github.io/nblm-slide-reverser/)
> 免安裝任何 Python 環境，不需自架伺服器，直接在瀏覽器打開即可公開使用！

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-success.svg)](https://gyuyu2002-jeff.github.io/nblm-slide-reverser/)
[![Python Version](https://img.shields.io/badge/Python-3.10%2B-brightgreen.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/Framework-FastAPI-009688.svg)](https://fastapi.tiangolo.com)
[![Gemini Vision](https://img.shields.io/badge/AI-Gemini%202.5%20Flash%20%2F%201.5%20Pro-8E75C2.svg)](https://aistudio.google.com)
[![Security: Zero-Storage](https://img.shields.io/badge/Security-BYOK%20%26%20Zero--Storage-success.svg)](#-資安防護保證-zero-storage--byok)

</div>

---

## 🌟 核心理念與特色

許多人在製作簡報時，手邊有大量筆記想用 **NotebookLM** 整理，但往往缺乏好看的排版與視覺指示；或者在網路上看到極度欣賞的簡報風格（如麥肯錫企管顧問風、Bento Grid 模組化卡片風、極簡留白商務風），卻不知道該如何用文字精確向 AI 描述。

**本專案專為解決此痛點而生：**
* 🌐 **GitHub Pages 純前端秒開**：支援瀏覽器端使用 PDF.js 本地解析 PDF，直接與官方 AI API 進行安全直連，免伺服器維護！
* 📤 **全格式支援**：支援上傳多頁簡報 PDF，或多張投影片截圖（PNG / JPG / WEBP）。
* 📑 **投影片頁面即時預覽**：上傳 PDF 或圖片後自動生成高畫質縮圖供翻頁比對。
* 🔍 **設計師維度深度逆向**：
  * **色彩系統 (Palette)**：依來源頁區分背景、文字與強調色；影像取色標示為近似估計，點擊色票即可一鍵複製色碼！
  * **版面與格線 (Layout & Grid)**：解析留白比例、卡片邊界、水平對齊與幾何圖解形態。
  * **原稿證據優先**：逐頁盤點背景、字色與圖像材質，再建立有來源頁碼的風格規則；支援混合或未分類風格，避免把封面效果套到所有內頁。
* 🌙 **深色介面**：操作面板、設定與結果區採深色主題；原稿預覽與色票保留原色。
* ✅ **輸出前檢核**：檢查來源頁是否完整、版型是否互相對應、文字色與主底是否有對比，以及是否與明顯的像素證據衝突。不完整的規格會暫停複製；兩種提示詞由同一份規格產生，避免版型代號漂移。
* ✏️ **個案修正**：在結果區逐頁核對、調整背景範圍與版型，修正只保存在目前收藏，不寫入全域規則。舊收藏沒有逐頁規格時，可依留存縮圖手動補齊或重新分析；若早期收藏缺少縮圖，需重傳原稿才能完整對照。原有提示詞仍保留在備份資料中。
* 📋 **NotebookLM 風格與逐頁提示詞**：提供可獨立貼用的兩種模式，保留各頁型適用範圍與來源證據；依內容調整容量，允許相近頁型重複，不強制全篇固定字數或留白率。
  * 模型仍可能漏判版型、背景範圍或版型代號；請對照來源頁核對後再使用提示詞。像素取樣提供輔助證據，不代表已通過視覺還原驗收。
* 📑 **代表頁選取**：PDF / PPTX 單檔預覽上限 150 頁，單次分析最多 30 頁；超過時均勻取樣並保留首尾頁，多檔共用分析額度。
* 🛡️ **資安第一 (BYOK & Zero-Storage)**：
  * **分頁暫存金鑰**：API Key 暫存於目前分頁，重新整理不用重填，不再提供永久儲存選項。
  * **公開部署安心無虞**：部署在 GitHub Pages 上公開分享給朋友或大眾使用時，作者金鑰絕不外洩，訪客各自使用自己的免費 Key。

---

## 🔄 雙軌運作架構圖

```mermaid
flowchart TD
    subgraph 瀏覽器端純前端模式 (GitHub Pages 免伺服器)
        A1[使用者上傳 PDF / 圖片] --> B1[PDF.js 本地即時渲染縮圖]
        B1 --> C1[自備免費 API Key (sessionStorage)]
        C1 --> D1[瀏覽器直接調用 Google Gemini API]
    end

    subgraph 本地後端模式 (可選 Python FastAPI)
        A2[使用者上傳 PDF / PPTX] --> B2[PyMuPDF / python-pptx 本地解析]
        B2 --> C2[FastAPI 暫態記憶體處理]
        C2 --> D2[Gemini / OpenAI / Claude API]
    end

    D1 --> E[🎨 來源視覺結構與證據報告]
    D2 --> E
    E --> F[📋 NotebookLM 專用結構提示詞]
    E --> G[🎨 依頁型區分的近似色票]
    E --> H[💻 HTML 視覺重建草稿]
```

---

## 🚀 使用方式

### 方式一：線上直接使用（最推薦，免安裝）
直接打開 GitHub Pages 官方網站：
👉 **[https://gyuyu2002-jeff.github.io/nblm-slide-reverser/](https://gyuyu2002-jeff.github.io/nblm-slide-reverser/)**
1. 點擊右上角「免費 AI 帳號申請」取得免費 Google Gemini Key。
2. 拖入您的簡報 PDF 或投影片截圖。
3. 點擊「開始逆向分析」，等待模型完成後取得 NotebookLM 專屬提示詞！

---

### 方式二：Windows 本地一鍵雙擊啟動
1. 下載或 Clone 本專案至電腦。
2. 雙擊執行目錄下的 **`啟動簡報風格逆向器.bat`**。
3. 瀏覽器將自動開啟 `http://127.0.0.1:8000`。

---

### 方式三：指令列手動啟動
```bash
# 1. 安裝相依套件
pip install -r requirements.txt

# 2. 啟動伺服器
python app.py
```

---

## 🔑 免費申請 Google Gemini API (1 分鐘指引)

本工具核心使用 Google Gemini 官方多模態視覺模型，Google 提供每位開發者極為充裕的 **Free Tier（免費額度），完全無須綁定信用卡**：

1. **前往 Google AI Studio**：👉 [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. **登入 Google 帳號**。
3. 點擊 **「Create API key」** ➔ 選擇 **「Create API key in new project」**。
4. 複製 Google AI Studio 產生的完整金鑰；不要僅依字首判斷供應商。
5. 回到本網站，點擊右上角 **「設定 AI 帳號」** 貼上並儲存，即可開始使用！

---

## 🛡️ 資安防護保證 (Zero-Storage / BYOK)

* **BYOK 模式（自備金鑰）**：API Key 使用分頁暫存（sessionStorage），同一分頁重新整理不用重填。關閉分頁後通常清除，瀏覽器還原分頁時可能恢復；可按「清除金鑰」主動移除。
* **舊金鑰清理**：新版載入時只刪除舊版 LocalStorage 的 `gemini_api_key`、`openai_api_key`、`anthropic_api_key` 三個欄位，不讀取或搬移舊金鑰，並保留其他本機資料與目前分頁已暫存的金鑰。
* **純前端靜態運作**：部署在 GitHub Pages 時，所有請求直接由使用者瀏覽器發送至 Google 官方 API，中間無任何第三方轉發伺服器。
* **代碼 100% 開源**：所有前端與後端代碼完全開源透明，歡迎審閱。

---

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 授權。
