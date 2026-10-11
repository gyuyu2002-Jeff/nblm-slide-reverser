// 狀態管理
let selectedFiles = [];
let uploadedSlidePages = []; // [{ page: 1, image: "data:..." }, ...]
let currentComparisonPage = 0;
let currentComparisonMode = "split"; // "split", "reconstruct", "original"
let generatedReportMarkdown = "";
let generatedNblmPrompt = "";
let generatedSlideHtml = "";
let currentProvider = localStorage.getItem("active_provider") || "gemini";
let modalSelectedProvider = currentProvider;

// 系統逆向工程 Prompt (真確幾何骨架與視覺還原專用引擎 - 零幻覺標準)
const CLIENT_SYSTEM_INSTRUCTION = `你是一位世界頂級的簡報視覺逆向架構師（Presentation Layout Reverse-Engineer）與幾何排版專家。
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

## 3. 📋 NotebookLM 專用幾何槽位合約提示詞 (NotebookLM Slot-Contract Prompt)
> 複製以下指令貼入 NotebookLM。本提示詞採用「嚴格筆記溯源 (Grounded RAG) + 幾何插槽合約 (Slot Contract) + 簡報字數防爆預算 (Text Budget)」，徹底剷除無效的角色扮演套話，強制 NotebookLM 將長篇筆記 100% 精準壓縮進原始簡報的幾何插槽中：

\`\`\`markdown
【任務宣告】：
請嚴格僅依據我上傳的筆記來源（Sources），提取關鍵事實與洞察，將筆記內容忠實填入下列【投影片幾何槽位合約】中。

【投影片版面約束與字數預算（Slide Layout Budget）】：
1. 嚴格溯源：所有內容必須 100% 源自來源筆記，嚴禁添加筆記未提及的外部推論。
2. 簡報文字密度防爆（維持投影片黃金呼吸感，嚴禁散文段落）：
   - 投影片主標題：限定 8~14 字（結論先行，動賓或主謂短語）。
   - 副標題/導言：限定 15~25 字。
   - 卡片/區塊標題：限定 4~8 字。
   - 條列/斑馬紋項目：每條限定 12~20 字（每欄/每卡片最多 2~3 點）。
3. 🚫 負向排除：
   - 除非來源筆記中具備明確統計數據，否則【絕對嚴禁】無中生有編造「巨型 KPI 統計大數字」（如 25%、100萬等）。
   - 嚴禁長篇敘事，所有文字必須高度提煉為「概念名 + 條理短語」。

【逐頁投影片槽位填空合約（請依此格式逐頁填寫輸出）】：
[在此根據上述「第 1 節實際辨識到的各頁真實幾何拓撲」，精確產生逐頁的槽位代碼，嚴格標註每個欄位的字數限制與結構對應關係！]
\`\`\`

## 4. 💻 1:1 還原之 HTML / Tailwind 投影片結構碼 (可直接複製使用)
\`\`\`html
<!-- 完整、乾淨、可以直接在瀏覽器獨立運行的 HTML 代碼，包含 Tailwind CSS CDN 與內聯樣式，100% 忠實重現上述投影片的真實幾何圖解與版面 -->
\`\`\`

---
最後，請附上下方的 JSON 區塊，提供前端色票與標籤展示：
\`\`\`json
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
\`\`\``;

// 服務商配置
const PROVIDER_CONFIG = {
  gemini: {
    name: "Google Gemini",
    defaultPlaceholder: "AIzaSy...",
    portalText: "前往 Google AI Studio 免費申請",
    portalUrl: "https://aistudio.google.com/app/apikey"
  },
  openai: {
    name: "OpenAI",
    defaultPlaceholder: "sk-proj-...",
    portalText: "前往 OpenAI Platform 建立 Key",
    portalUrl: "https://platform.openai.com/api-keys"
  },
  anthropic: {
    name: "Anthropic Claude",
    defaultPlaceholder: "sk-ant-...",
    portalText: "前往 Anthropic Console 建立 Key",
    portalUrl: "https://console.anthropic.com/settings/keys"
  }
};

// DOM 初始化
document.addEventListener("DOMContentLoaded", () => {
  initProvider();
  initApiKeyStatus();
  setupEventListeners();
  updateUiState();
  checkFirstTimeVisitor();
});

// === 1. API KEY 管理 ===
function getApiKey(provider = currentProvider) {
  return localStorage.getItem(`${provider}_api_key`) || "";
}

function setApiKey(provider, key) {
  if (key && key.trim()) {
    localStorage.setItem(`${provider}_api_key`, key.trim());
  } else {
    localStorage.removeItem(`${provider}_api_key`);
  }
  initApiKeyStatus();
}

function initApiKeyStatus() {
  const key = getApiKey(currentProvider);
  const dot = document.getElementById("status-indicator-dot");
  const text = document.getElementById("status-indicator-text");
  const badge = document.getElementById("active-engine-badge");
  const config = PROVIDER_CONFIG[currentProvider] || PROVIDER_CONFIG.gemini;
  
  if (key) {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
    if (text) {
      text.textContent = `${config.name} 就緒`;
      text.className = "text-emerald-400 font-semibold";
    }
    if (badge) {
      badge.textContent = `${config.name} · 智慧全自動適配`;
    }
  } else {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-amber-400";
    if (text) {
      text.textContent = `設定 ${config.name} Key`;
      text.className = "text-slate-200 font-semibold";
    }
    if (badge) {
      badge.textContent = `尚未設定金鑰 · 點此設定`;
    }
  }
}

// 迎賓導引彈窗開關控制
function openOnboardingModal() {
  const modal = document.getElementById("modal-onboarding");
  if (!modal) return;
  const input = document.getElementById("input-onboarding-key");
  if (input) {
    input.value = getApiKey("gemini");
  }
  modal.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
}

function closeOnboardingModal(rememberDismiss = false) {
  const modal = document.getElementById("modal-onboarding");
  if (modal) modal.classList.add("hidden");
  if (rememberDismiss) {
    localStorage.setItem("has_seen_onboarding", "true");
  }
}

// 首次造訪且尚未設定 API 金鑰時，自動彈出迎賓教學
function checkFirstTimeVisitor() {
  const hasAnyKey = getApiKey("gemini") || getApiKey("openai") || getApiKey("anthropic");
  const hasSeen = localStorage.getItem("has_seen_onboarding") === "true";
  if (!hasAnyKey && !hasSeen) {
    setTimeout(() => {
      openOnboardingModal();
    }, 350);
  }
}

// 切換服務商（僅在彈窗內切換，主畫面自動同步）
function switchProvider(newProvider) {
  currentProvider = newProvider;
  localStorage.setItem("active_provider", newProvider);
  initApiKeyStatus();
}

function initProvider() {
  switchProvider(currentProvider);
}

// === 2. 事件監聽設置 ===
function setupEventListeners() {
  const on = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    return el;
  };

  const modalApiKey = document.getElementById("modal-apikey");
  const modalTutorial = document.getElementById("modal-tutorial");
  const modalSecurity = document.getElementById("modal-security");

  // 頂部導航按鈕
  on("btn-apikey-modal", "click", () => {
    openApiKeyModal(currentProvider);
  });
  on("btn-close-apikey-modal", "click", () => {
    if (modalApiKey) modalApiKey.classList.add("hidden");
  });

  // 點擊「免費金鑰教學」開啟迎賓教學彈窗（直達三步驟與一鍵儲存）
  on("btn-tutorial", "click", () => {
    openOnboardingModal();
  });
  on("btn-close-tutorial", "click", () => {
    if (modalTutorial) modalTutorial.classList.add("hidden");
  });
  on("btn-tutorial-got-it", "click", () => {
    if (modalTutorial) modalTutorial.classList.add("hidden");
    if (!getApiKey(currentProvider)) {
      openApiKeyModal(currentProvider);
    }
  });

  // 迎賓導引彈窗互動監聽
  on("btn-close-onboarding", "click", () => {
    closeOnboardingModal(true);
  });
  on("btn-skip-onboarding", "click", () => {
    closeOnboardingModal(true);
    showToast("您可隨時點擊右上角「設定 API 金鑰」進行設定", "info");
  });
  on("btn-onboarding-switch-other", "click", () => {
    closeOnboardingModal(true);
    openApiKeyModal("openai");
  });
  on("btn-save-onboarding-key", "click", () => {
    const input = document.getElementById("input-onboarding-key");
    const key = input ? input.value.trim() : "";
    if (!key) {
      showToast("請先貼上有效的 Google Gemini API Key，或點擊跳過", "warning");
      return;
    }
    setApiKey("gemini", key);
    switchProvider("gemini");
    closeOnboardingModal(true);
    showToast("Google Gemini 金鑰已就緒！請拖入投影片開始分析", "success");
  });

  // 迎賓彈窗密碼顯隱切換
  const toggleOnboardingBtn = document.getElementById("btn-toggle-onboarding-key");
  const onboardingInput = document.getElementById("input-onboarding-key");
  if (toggleOnboardingBtn && onboardingInput) {
    toggleOnboardingBtn.addEventListener("click", () => {
      if (onboardingInput.type === "password") {
        onboardingInput.type = "text";
        toggleOnboardingBtn.innerHTML = '<i data-lucide="eye-off" class="w-3.5 h-3.5"></i>';
      } else {
        onboardingInput.type = "password";
        toggleOnboardingBtn.innerHTML = '<i data-lucide="eye" class="w-3.5 h-3.5"></i>';
      }
      lucide.createIcons();
    });
  }

  on("btn-security", "click", () => {
    if (modalSecurity) modalSecurity.classList.remove("hidden");
  });
  on("btn-close-security", "click", () => {
    if (modalSecurity) modalSecurity.classList.add("hidden");
  });
  on("btn-close-security-confirm", "click", () => {
    if (modalSecurity) modalSecurity.classList.add("hidden");
  });

  // 金鑰設定彈窗內供應商切換
  document.querySelectorAll("#modal-provider-selector .modal-provider-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-modal-provider");
      openApiKeyModal(p);
    });
  });

  // 儲存金鑰
  on("btn-save-key", "click", () => {
    const inputKey = document.getElementById("input-api-key");
    const key = inputKey ? inputKey.value.trim() : "";
    if (!key) {
      showToast("請輸入有效金鑰，或點擊清除", "warning");
      return;
    }
    setApiKey(modalSelectedProvider, key);
    if (modalApiKey) modalApiKey.classList.add("hidden");
    showToast(`${PROVIDER_CONFIG[modalSelectedProvider].name} 金鑰已安全保存！`, "success");
    if (modalSelectedProvider !== currentProvider) {
      switchProvider(modalSelectedProvider);
    }
  });

  // 清除金鑰
  on("btn-clear-key", "click", () => {
    setApiKey(modalSelectedProvider, "");
    const inputKey = document.getElementById("input-api-key");
    if (inputKey) inputKey.value = "";
    showToast(`已清除 ${PROVIDER_CONFIG[modalSelectedProvider].name} 本地金鑰`, "info");
  });

  // 密碼顯隱切換
  const toggleBtn = document.getElementById("btn-toggle-key-visibility");
  const keyInput = document.getElementById("input-api-key");
  if (toggleBtn && keyInput) {
    toggleBtn.addEventListener("click", () => {
      if (keyInput.type === "password") {
        keyInput.type = "text";
        toggleBtn.innerHTML = '<i data-lucide="eye-off" class="w-4 h-4"></i>';
      } else {
        keyInput.type = "password";
        toggleBtn.innerHTML = '<i data-lucide="eye" class="w-4 h-4"></i>';
      }
      lucide.createIcons();
    });
  }

  // 教學頁籤切換監聽
  document.querySelectorAll(".tut-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tut = btn.getAttribute("data-tut");
      switchTutTab(tut);
    });
  });

  // 快捷開啟金鑰設定
  on("btn-open-apikey-quick", "click", () => {
    openApiKeyModal(currentProvider);
  });

  // 拖曳上傳與檔案選擇
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");

  if (fileInput) {
    fileInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFilesAdded(Array.from(e.target.files));
      }
    });
  }

  if (dropZone && fileInput) {
    dropZone.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("border-sky-400", "bg-slate-800/80");
    });

    dropZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("border-sky-400", "bg-slate-800/80");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("border-sky-400", "bg-slate-800/80");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFilesAdded(Array.from(e.dataTransfer.files));
      }
    });
  }

  on("btn-clear-files", "click", () => {
    selectedFiles = [];
    uploadedSlidePages = [];
    currentComparisonPage = 0;
    const gallery = document.getElementById("thumbnail-gallery");
    const previewSec = document.getElementById("file-preview-section");
    if (gallery) gallery.innerHTML = "";
    if (previewSec) previewSec.classList.add("hidden");
    if (fileInput) fileInput.value = "";
    showToast("已清空選擇檔案", "info");
  });

  // 結果頁籤切換監聽
  document.querySelectorAll(".result-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-result-tab");
      switchResultTab(tab);
    });
  });

  // 投影片翻頁監聽
  on("btn-prev-slide", "click", () => {
    if (currentComparisonPage > 0) {
      currentComparisonPage--;
      updateComparisonView();
    }
  });
  on("btn-next-slide", "click", () => {
    if (currentComparisonPage < uploadedSlidePages.length - 1) {
      currentComparisonPage++;
      updateComparisonView();
    }
  });

  // 開始分析按鈕
  on("btn-start-analyze", "click", handleStartAnalyze);

  // 複製按鈕
  on("btn-copy-nblm", "click", () => {
    if (!generatedNblmPrompt) return;
    navigator.clipboard.writeText(generatedNblmPrompt).then(() => {
      const label = document.getElementById("copy-btn-label");
      if (label) {
        const originalText = label.textContent;
        label.textContent = "已複製！";
        setTimeout(() => label.textContent = originalText, 2000);
      }
      showToast("已複製 NotebookLM 專用提示詞！可至 NBLM 貼上", "success");
    });
  });

  // 直達工作流按鈕：複製並開啟 NotebookLM
  on("btn-copy-and-open-nblm", "click", () => {
    if (!generatedNblmPrompt) {
      showToast("尚未產生提示詞，請先上傳簡報進行分析", "warning");
      return;
    }
    navigator.clipboard.writeText(generatedNblmPrompt).then(() => {
      showToast("已複製提示詞！正在為您開啟 NotebookLM...", "success");
      window.open("https://notebooklm.google.com/", "_blank");
    });
  });

  on("btn-copy-html-code", "click", () => {
    if (!generatedSlideHtml) return;
    navigator.clipboard.writeText(generatedSlideHtml).then(() => {
      const label = document.getElementById("copy-html-label");
      if (label) {
        const originalText = label.textContent;
        label.textContent = "已複製！";
        setTimeout(() => label.textContent = originalText, 2000);
      }
      showToast("已複製 1:1 還原之 HTML / Tailwind 投影片代碼！", "success");
    });
  });

  on("btn-open-preview-window", "click", () => {
    if (!generatedSlideHtml) {
      showToast("尚未產生投影片代碼", "warning");
      return;
    }
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(buildFullSlideHtml(generatedSlideHtml));
      win.document.close();
    }
  });

  on("btn-copy-all-report", "click", () => {
    if (!generatedReportMarkdown) return;
    navigator.clipboard.writeText(generatedReportMarkdown).then(() => {
      showToast("已複製整份排版分析報告！", "success");
    });
  });

  on("btn-export-markdown", "click", () => {
    if (!generatedReportMarkdown) return;
    const blob = new Blob([generatedReportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `簡報風格逆向解析報告-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("已下載報告檔案！", "success");
  });
}

// 教學彈窗頁籤切換核心函數
function switchTutTab(tutName) {
  document.querySelectorAll(".tut-tab-btn").forEach(b => {
    const isTarget = b.getAttribute("data-tut") === tutName;
    if (isTarget) {
      b.className = "tut-tab-btn py-1.5 border-b-2 border-zinc-200 text-zinc-100 font-medium cursor-pointer";
    } else {
      b.className = "tut-tab-btn py-1.5 border-b-2 border-transparent text-zinc-400 hover:text-zinc-200 cursor-pointer";
    }
  });

  const allKeys = ["gemini", "openai", "anthropic"];
  allKeys.forEach(k => {
    const el = document.getElementById(`tut-content-${k}`);
    if (el) {
      if (k === tutName) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    }
  });
  if (window.lucide) window.lucide.createIcons();
}
window.switchTutTab = switchTutTab;

function openApiKeyModal(provider) {
  modalSelectedProvider = provider;
  const config = PROVIDER_CONFIG[provider];
  const modalApiKey = document.getElementById("modal-apikey");

  // 更新彈窗內的按鈕選中樣式
  document.querySelectorAll("#modal-provider-selector .modal-provider-btn").forEach(btn => {
    const p = btn.getAttribute("data-modal-provider");
    if (p === provider) {
      btn.className = "modal-provider-btn px-2 py-1.5 rounded-lg text-xs font-medium border transition-all text-center bg-zinc-100 text-zinc-950 border-zinc-100 cursor-pointer";
    } else {
      btn.className = "modal-provider-btn px-2 py-1.5 rounded-lg text-xs font-medium border transition-all text-center bg-white/[0.04] text-zinc-300 border-white/[0.08] hover:bg-white/[0.08] cursor-pointer";
    }
  });

  document.getElementById("modal-key-label").textContent = `${config.name} API Key：`;
  const keyInput = document.getElementById("input-api-key");
  keyInput.placeholder = config.defaultPlaceholder;
  keyInput.value = getApiKey(provider);

  const portalLink = document.getElementById("modal-portal-link");
  portalLink.href = config.portalUrl;
  document.getElementById("modal-portal-text").textContent = config.portalText;

  modalApiKey.classList.remove("hidden");
  lucide.createIcons();
}

// 純前端渲染 PDF 縮圖（支援 GitHub Pages 離線/無伺服器環境）
async function parsePdfClientSide(file) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("PDF 解析模組載入中，請稍候重試");
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  const pages = [];
  const maxPages = Math.min(totalPages, 6);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    pages.push({ page: i, image: dataUrl });
  }
  return { total_pages: totalPages, preview_pages: pages };
}

// === 3. 檔案處理與縮圖收集 ===
async function handleFilesAdded(files) {
  const validExtensions = [".pptx", ".pdf", ".png", ".jpg", ".jpeg", ".webp"];
  const newFiles = files.filter(f => {
    const ext = "." + f.name.split(".").pop().toLowerCase();
    return validExtensions.includes(ext);
  });

  if (newFiles.length === 0) {
    showToast("未檢測到支援的簡報檔案，請上傳 PDF、PPTX 或圖片", "warning");
    return;
  }

  selectedFiles.push(...newFiles);
  document.getElementById("file-preview-section").classList.remove("hidden");
  document.getElementById("file-count-label").textContent = `已選取 ${selectedFiles.length} 個檔案`;

  const gallery = document.getElementById("thumbnail-gallery");

  for (const file of newFiles) {
    const ext = "." + file.name.split(".").pop().toLowerCase();
    
    if (ext === ".pdf") {
      const previewCard = document.createElement("div");
      previewCard.className = "relative rounded-xl border border-slate-700 bg-slate-900/80 p-2 flex flex-col items-center justify-center text-center text-xs text-slate-300 shadow-sm";
      previewCard.innerHTML = `
        <div class="animate-pulse flex flex-col items-center py-3">
          <i data-lucide="file-text" class="w-6 h-6 text-sky-400 mb-1"></i>
          <span class="truncate max-w-[85px] font-mono text-[10px] text-slate-300">${file.name}</span>
          <span class="text-[9px] text-slate-500 mt-0.5">解析 PDF 頁面...</span>
        </div>
      `;
      gallery.appendChild(previewCard);
      lucide.createIcons();

      try {
        let pdfData = null;
        // 優先使用純前端快速解析
        if (typeof pdfjsLib !== "undefined") {
          try {
            pdfData = await parsePdfClientSide(file);
          } catch (e) {
            console.warn("前端 PDF 渲染異常，嘗試後端:", e);
          }
        }
        // 若純前端無法解析且為本地環境，嘗試調用後端
        if (!pdfData && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
          const formData = new FormData();
          formData.append("file", file);
          const resp = await fetch("/api/preview", { method: "POST", body: formData });
          if (resp.ok) {
            const data = await resp.json();
            if (data.status === "success") pdfData = data;
          }
        }

        if (pdfData && pdfData.preview_pages && pdfData.preview_pages.length > 0) {
          uploadedSlidePages.push(...pdfData.preview_pages);
          previewCard.innerHTML = `
            <div class="relative w-full h-20 overflow-hidden rounded-lg bg-slate-800 border border-slate-700">
              <img src="${pdfData.preview_pages[0].image}" class="w-full h-full object-cover">
              <span class="absolute bottom-1 right-1 bg-black/75 text-[9px] px-1 py-0.2 rounded text-white font-mono">
                ${pdfData.total_pages} 頁
              </span>
            </div>
            <span class="truncate max-w-[90px] text-[10px] text-slate-300 mt-1 font-medium">${file.name}</span>
          `;
        } else {
          previewCard.innerHTML = `
            <div class="flex flex-col items-center py-3 text-amber-400">
              <i data-lucide="alert-triangle" class="w-6 h-6 mb-1"></i>
              <span class="truncate max-w-[85px] text-[10px]">${file.name}</span>
              <span class="text-[9px] text-slate-400">請改傳圖片</span>
            </div>
          `;
          lucide.createIcons();
        }
      } catch (err) {
        console.warn("無法取得縮圖:", err);
      }

    } else if (ext === ".pptx") {
      const previewCard = document.createElement("div");
      previewCard.className = "relative rounded-xl border border-slate-700 bg-slate-900/80 p-2 flex flex-col items-center justify-center text-center text-xs text-slate-300 shadow-sm";
      previewCard.innerHTML = `
        <div class="animate-pulse flex flex-col items-center py-3">
          <i data-lucide="presentation" class="w-6 h-6 text-sky-400 mb-1"></i>
          <span class="truncate max-w-[85px] font-mono text-[10px] text-slate-300">${file.name}</span>
          <span class="text-[9px] text-slate-500 mt-0.5">解析 PPTX...</span>
        </div>
      `;
      gallery.appendChild(previewCard);
      lucide.createIcons();

      try {
        let pptxSuccess = false;
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
          const formData = new FormData();
          formData.append("file", file);
          const resp = await fetch("/api/preview", { method: "POST", body: formData });
          if (resp.ok) {
            const data = await resp.json();
            if (data.status === "success" && data.preview_pages && data.preview_pages.length > 0) {
              uploadedSlidePages.push(...data.preview_pages);
              pptxSuccess = true;
              previewCard.innerHTML = `
                <div class="relative w-full h-20 overflow-hidden rounded-lg bg-slate-800 border border-slate-700">
                  <img src="${data.preview_pages[0].image}" class="w-full h-full object-cover">
                  <span class="absolute bottom-1 right-1 bg-black/75 text-[9px] px-1 py-0.2 rounded text-white font-mono">
                    ${data.total_pages} 頁
                  </span>
                </div>
                <span class="truncate max-w-[90px] text-[10px] text-slate-300 mt-1 font-medium">${file.name}</span>
              `;
            }
          }
        }
        if (!pptxSuccess) {
          previewCard.innerHTML = `
            <div class="flex flex-col items-center py-3 text-sky-300">
              <i data-lucide="presentation" class="w-6 h-6 mb-1"></i>
              <span class="truncate max-w-[85px] text-[10px]">${file.name}</span>
              <span class="text-[9px] text-slate-400">已加入待分析</span>
            </div>
          `;
          lucide.createIcons();
          showToast("💡 提示：在線上版本，建議將 PPT 匯出為 PDF 或直接截圖上傳，效果最為即時精準！", "info");
        }
      } catch (err) {
        console.warn("無法取得 PPTX 縮圖:", err);
      }

    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadedSlidePages.push({
          page: uploadedSlidePages.length + 1,
          image: e.target.result
        });

        const card = document.createElement("div");
        card.className = "relative rounded-xl border border-slate-700 bg-slate-900/80 p-1 flex flex-col items-center shadow-sm";
        card.innerHTML = `
          <div class="w-full h-20 overflow-hidden rounded-lg bg-slate-800 border border-slate-700">
            <img src="${e.target.result}" class="w-full h-full object-cover">
          </div>
          <span class="truncate max-w-[90px] text-[10px] text-slate-300 mt-1 font-medium">${file.name}</span>
        `;
        gallery.appendChild(card);
      };
      reader.readAsDataURL(file);
    }
  }
}

// === 4. 純瀏覽器端 AI 直連呼叫引擎 (支援 GitHub Pages Serverless) ===
async function callGeminiDirectly(apiKey, selectedModel, slideImages, promptText) {
  let modelName = selectedModel || "auto";
  if (modelName === "auto") {
    modelName = slideImages.length >= 5 ? "gemini-1.5-pro" : "gemini-2.5-flash";
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const parts = [];
  // 取出最多 6 頁投影片縮圖
  for (const page of slideImages.slice(0, 6)) {
    if (page.image && page.image.startsWith("data:")) {
      const mimeMatch = page.image.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const b64 = page.image.replace(/^data:[^;]+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: mime,
          data: b64
        }
      });
    }
  }

  parts.push({ text: promptText });

  const payload = {
    contents: [
      {
        role: "user",
        parts: parts
      }
    ],
    systemInstruction: {
      parts: [
        { text: CLIENT_SYSTEM_INSTRUCTION }
      ]
    },
    generationConfig: {
      temperature: 0.4
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const resJson = await response.json();
  if (!response.ok) {
    const msg = resJson.error ? resJson.error.message : "Gemini API 請求失敗";
    throw new Error(`Google Gemini API 錯誤: ${msg}`);
  }

  const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini 未返回分析文字，請確認 API Key 是否有效。");
  }

  return {
    status: "success",
    provider: "Google Gemini",
    model_used: modelName,
    markdown_report: text,
    structured_meta: fallbackExtractMeta(text)
  };
}

async function callOpenAiDirectly(apiKey, selectedModel, slideImages, promptText) {
  let modelName = selectedModel || "auto";
  if (modelName === "auto") {
    modelName = "gpt-4o";
  }

  const endpoint = "https://api.openai.com/v1/chat/completions";
  const content = [{ type: "text", text: promptText }];

  for (const page of slideImages.slice(0, 6)) {
    if (page.image && page.image.startsWith("data:")) {
      content.push({
        type: "image_url",
        image_url: {
          url: page.image,
          detail: "high"
        }
      });
    }
  }

  const payload = {
    model: modelName,
    messages: [
      { role: "system", content: CLIENT_SYSTEM_INSTRUCTION },
      { role: "user", content: content }
    ],
    temperature: 0.4
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const resJson = await response.json();
  if (!response.ok) {
    const msg = resJson.error ? resJson.error.message : "OpenAI API 請求失敗";
    throw new Error(`OpenAI API 錯誤: ${msg}`);
  }

  const text = resJson.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI 未返回分析文字");
  }

  return {
    status: "success",
    provider: "OpenAI",
    model_used: modelName,
    markdown_report: text,
    structured_meta: fallbackExtractMeta(text)
  };
}

// === 5. 開始發起分析流程 ===
async function handleStartAnalyze() {
  if (selectedFiles.length === 0) {
    showToast("請先上傳簡報 PDF 或投影片圖片！", "warning");
    return;
  }

  const apiKey = getApiKey(currentProvider);
  if (!apiKey) {
    showToast(`請先輸入您的 ${PROVIDER_CONFIG[currentProvider].name} API Key`, "warning");
    openApiKeyModal(currentProvider);
    return;
  }

  // 切換 UI 至載入狀態
  document.getElementById("panel-idle").classList.add("hidden");
  document.getElementById("panel-result").classList.add("hidden");
  document.getElementById("panel-loading").classList.remove("hidden");

  const startBtn = document.getElementById("btn-start-analyze");
  startBtn.disabled = true;
  startBtn.classList.add("opacity-50");

  const model = "auto";
  const isGitHubPages = window.location.hostname.includes("github.io") || window.location.protocol === "file:";

  let data = null;

  try {
    // 1. 若非純靜態 GitHub Pages 且處於本地 localhost，先嘗試呼叫 Python 後端
    if (!isGitHubPages && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
      try {
        const formData = new FormData();
        selectedFiles.forEach(file => formData.append("files", file));
        formData.append("provider", currentProvider);
        formData.append("model", model);

        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "x-api-key": apiKey },
          body: formData
        });

        if (response.ok) {
          data = await response.json();
        }
      } catch (err) {
        console.warn("本地後端無法連線，切換為瀏覽器前端直連模式:", err);
      }
    }

    // 2. 若處於 GitHub Pages 或本地後端不可用，使用前端瀏覽器直連（Serverless 模式）
    if (!data) {
      if (uploadedSlidePages.length === 0) {
        throw new Error("未檢測到有效投影片影像，請確認上傳了清晰的 PDF 或投影片圖片。");
      }

      const promptText = "請詳細審視我上傳的簡報投影片，執行深度視覺與幾何拓撲逆向工程。\n" +
        "【核心使命】：\n" +
        "1. 必須逐頁精確拆解投影片的真實骨架（如左右分割、同心圓靶心、橫向進程軸、N 欄線框卡片、斑馬紋條列區塊），實事求是，嚴格禁止無中生有幻覺巨型 KPI 統計大數字！\n" +
        "2. 產出的 NotebookLM 提示詞必須採用「幾何槽位合約 (Slot-Contract)」架構，徹底剔除「頂級架構師」等無效人設空話，明確規定字數預算（主標題<14字、條列<20字）、欄位插槽與嚴格筆記溯源，讓使用者貼入 NotebookLM 後能將筆記內容精準壓縮填入對應的幾何槽位中。\n" +
        "3. 產出一份可直接獨立運行的 HTML/Tailwind 1:1 還原投影片結構代碼。\n" +
        "4. 請嚴格依照 SYSTEM INSTRUCTION 規定的章節與 JSON 格式輸出。";

      if (currentProvider === "gemini") {
        data = await callGeminiDirectly(apiKey, model, uploadedSlidePages, promptText);
      } else if (currentProvider === "openai") {
        data = await callOpenAiDirectly(apiKey, model, uploadedSlidePages, promptText);
      } else {
        throw new Error("Anthropic API 因官方安全跨域規範限制，純前端靜態站點請選擇 Google Gemini（推薦，免費且極速）或 OpenAI！");
      }
    }

    renderAnalysisResult(data);
    showToast("風格逆向分析完成！已為您產生 1:1 幾何對比與提示詞", "success");

  } catch (err) {
    console.error(err);
    showToast(err.message, "error");
    document.getElementById("panel-idle").classList.remove("hidden");
  } finally {
    document.getElementById("panel-loading").classList.add("hidden");
    startBtn.disabled = false;
    startBtn.classList.remove("opacity-50");
  }
}

// === 5. 結果渲染邏輯 (雙欄並排與多頁籤) ===
function renderAnalysisResult(data) {
  generatedReportMarkdown = data.markdown_report || "";
  
  document.getElementById("panel-idle").classList.add("hidden");
  document.getElementById("panel-loading").classList.add("hidden");
  document.getElementById("panel-result").classList.remove("hidden");

  // 萃取各項產出
  generatedNblmPrompt = extractNblmPrompt(generatedReportMarkdown);
  generatedSlideHtml = extractSlideHtml(generatedReportMarkdown);

  document.getElementById("nblm-prompt-code").textContent = generatedNblmPrompt || "未能擷取到特定提示詞區塊，請參閱下方全文報告。";

  // 更新投影片預覽視窗
  currentComparisonPage = 0;
  updateComparisonView();

  // 預設切換至 NotebookLM 提示詞頁籤
  switchResultTab("nblm");

  const meta = data.structured_meta || fallbackExtractMeta(generatedReportMarkdown);
  
  document.getElementById("result-style-name").textContent = meta.style_name || "簡報視覺風格解析報告";

  const autoBadge = document.getElementById("result-auto-badge");
  if (autoBadge) {
    if (data.auto_reason) {
      autoBadge.textContent = data.auto_reason;
      autoBadge.classList.remove("hidden");
    } else if (data.model_used) {
      autoBadge.textContent = `模型: ${data.model_used}`;
      autoBadge.classList.remove("hidden");
    } else {
      autoBadge.classList.add("hidden");
    }
  }

  const tagsContainer = document.getElementById("result-tags-container");
  tagsContainer.innerHTML = "";
  (meta.tags || ["麥肯錫架構", "純2D扁平", "三欄線框卡片", "同心圓模型"]).forEach(tag => {
    const span = document.createElement("span");
    span.className = "px-2 py-0.5 text-[11px] rounded bg-white/[0.04] text-zinc-300 border border-white/[0.08] font-mono";
    span.textContent = `# ${tag}`;
    tagsContainer.appendChild(span);
  });

  if (meta.white_space_ratio) {
    document.getElementById("white-space-metric").textContent = `留白指標: ${meta.white_space_ratio}`;
  }

  renderColorPalette(meta.palette || [
    {"role": "畫布背景", "hex": "#FFFFFF", "name": "Pure White"},
    {"role": "主標題與邊框", "hex": "#0E3B5D", "name": "Navy Blue"},
    {"role": "核心強調金", "hex": "#C59B27", "name": "Ochre Gold"},
    {"role": "斑馬條塊色", "hex": "#F3F4F6", "name": "Light Gray"}
  ]);

  const markdownContainer = document.getElementById("full-report-markdown");
  markdownContainer.innerHTML = marked.parse(generatedReportMarkdown);

  lucide.createIcons();
}

// 更新雙欄對比視窗 (原始投影片 vs 還原成果)
function updateComparisonView() {
  const originalImg = document.getElementById("img-original-slide");
  const originalPlaceholder = document.getElementById("original-placeholder");
  const pageNav = document.getElementById("slide-page-nav");
  const pageIndicator = document.getElementById("slide-page-indicator");
  const originalPageLabel = document.getElementById("original-page-label");
  const prevBtn = document.getElementById("btn-prev-slide");
  const nextBtn = document.getElementById("btn-next-slide");

  if (uploadedSlidePages && uploadedSlidePages.length > 0) {
    const pageData = uploadedSlidePages[currentComparisonPage] || uploadedSlidePages[0];
    originalImg.src = pageData.image;
    originalImg.classList.remove("hidden");
    if (originalPlaceholder) originalPlaceholder.classList.add("hidden");
    originalPageLabel.textContent = `Page ${currentComparisonPage + 1}`;
    
    if (uploadedSlidePages.length > 1) {
      pageNav.classList.remove("hidden");
      pageNav.classList.add("flex");
      pageIndicator.textContent = `第 ${currentComparisonPage + 1} / ${uploadedSlidePages.length} 頁`;
      prevBtn.disabled = (currentComparisonPage === 0);
      nextBtn.disabled = (currentComparisonPage === uploadedSlidePages.length - 1);
      prevBtn.classList.toggle("opacity-30", currentComparisonPage === 0);
      nextBtn.classList.toggle("opacity-30", currentComparisonPage === uploadedSlidePages.length - 1);
    } else {
      pageNav.classList.add("hidden");
    }
  } else {
    originalImg.classList.add("hidden");
    if (originalPlaceholder) originalPlaceholder.classList.remove("hidden");
    pageNav.classList.add("hidden");
  }
}

function switchResultTab(tabName) {
  document.querySelectorAll(".result-tab-btn").forEach(btn => {
    const t = btn.getAttribute("data-result-tab");
    if (t === tabName) {
      btn.className = "result-tab-btn active px-3.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors bg-white/10 text-white border border-white/10 cursor-pointer";
    } else {
      btn.className = "result-tab-btn px-3.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors text-zinc-400 hover:text-white hover:bg-white/[0.04] cursor-pointer";
    }
  });

  document.querySelectorAll(".result-tab-pane").forEach(pane => {
    pane.classList.add("hidden");
  });
  const targetPane = document.getElementById(`tab-pane-${tabName}`);
  if (targetPane) {
    targetPane.classList.remove("hidden");
  }
  lucide.createIcons();
}

function extractNblmPrompt(markdown) {
  if (markdown.includes("## 3. 📋 NotebookLM 專用") || markdown.includes("NotebookLM 專用")) {
    const parts = markdown.split(/## 3\..*?NotebookLM.*?/i);
    if (parts.length > 1) {
      const section = parts[1].split(/## 4\./)[0];
      const codeMatch = section.match(/```(?:markdown)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        return codeMatch[1].trim();
      }
      return section.trim();
    }
  }
  const firstBlock = markdown.match(/```(?:markdown)?([\s\S]*?)```/);
  return firstBlock ? firstBlock[1].trim() : markdown;
}

function extractSlideHtml(markdown) {
  if (markdown.includes("HTML / Tailwind") || markdown.includes("HTML 代碼") || markdown.includes("## 4. 💻") || markdown.includes("## 5. 💻")) {
    const parts = markdown.split(/## (?:4|5)\..*?HTML.*?/i);
    if (parts.length > 1) {
      const section = parts[1].split(/---/)[0];
      const codeMatch = section.match(/```(?:html)?([\s\S]*?)```/i);
      if (codeMatch && codeMatch[1]) {
        return codeMatch[1].trim();
      }
    }
  }
  const anyHtml = markdown.match(/```html([\s\S]*?)```/i);
  return anyHtml ? anyHtml[1].trim() : "";
}

function buildFullSlideHtml(rawHtml) {
  if (rawHtml.includes("<!DOCTYPE html") || rawHtml.includes("<html")) {
    return rawHtml;
  }
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>1:1 投影片視覺還原預覽</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Noto Sans TC', sans-serif; margin: 0; padding: 0; box-sizing: border-box; }
  </style>
</head>
<body class="bg-slate-950 min-h-screen flex items-center justify-center p-2 sm:p-4">
  <div class="w-full max-w-5xl shadow-2xl rounded-xl overflow-hidden aspect-video flex flex-col justify-center border border-slate-850">
    ${rawHtml}
  </div>
</body>
</html>`;
}

// 簡報精確色票卡片 (Precision Palette Tokens)
function renderColorPalette(palette) {
  const container = document.getElementById("color-palette-container");
  container.innerHTML = "";

  palette.forEach(color => {
    const card = document.createElement("div");
    card.className = "group bg-[#0E1013] hover:bg-white/[0.04] border border-white/[0.08] hover:border-white/20 rounded-lg p-2.5 flex flex-col justify-between transition-colors cursor-pointer shadow-sm";
    card.title = "點擊複製 Hex 色碼";
    
    card.innerHTML = `
      <div class="w-full h-8 rounded border border-white/10 mb-2 shadow-inner" style="background-color: ${color.hex}"></div>
      <div>
        <div class="text-[10px] font-medium text-zinc-400 truncate">${color.role || color.name}</div>
        <div class="text-[11px] font-mono font-medium text-zinc-200 flex items-center justify-between mt-0.5">
          <span>${color.hex}</span>
          <i data-lucide="copy" class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400"></i>
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      navigator.clipboard.writeText(color.hex);
      showToast(`已複製色碼: ${color.hex}`, "success");
    });

    container.appendChild(card);
  });
  lucide.createIcons();
}

function fallbackExtractMeta(markdown) {
  const hexMatches = markdown.match(/#[0-9a-fA-F]{6}/g) || ["#FFFFFF", "#0E3B5D", "#C59B27", "#F3F4F6"];
  const uniqueHex = Array.from(new Set(hexMatches)).slice(0, 4);
  return {
    style_name: "高階商業顧問排版",
    tags: ["版面骨架", "三欄卡片", "同心圓模型", "純2D扁平"],
    palette: uniqueHex.map((hex, idx) => ({
      role: idx === 0 ? "畫布底色" : idx === 1 ? "主標題與邊框" : idx === 2 ? "核心強調色" : "輔助色塊",
      hex: hex,
      name: "提取色"
    })),
    white_space_ratio: "70%"
  };
}

function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  const icon = document.getElementById("toast-icon");
  const text = document.getElementById("toast-text");

  text.textContent = message;

  if (type === "success") {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-xs shadow-xl text-white";
    icon.className = "w-4 h-4 text-emerald-400";
    icon.setAttribute("data-lucide", "check-circle");
  } else if (type === "warning" || type === "error") {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-rose-900 border border-rose-700 text-xs shadow-xl text-white";
    icon.className = "w-4 h-4 text-rose-300";
    icon.setAttribute("data-lucide", "alert-circle");
  } else {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-xs shadow-xl text-white";
    icon.className = "w-4 h-4 text-blue-400";
    icon.setAttribute("data-lucide", "info");
  }

  lucide.createIcons();

  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-20", "opacity-0");
  }, 3500);
}

function updateUiState() {
  lucide.createIcons();
}
