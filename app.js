// 狀態管理
let selectedFiles = [];
let uploadedSlidePages = []; // [{ page: 1, image: "data:..." }, ...]
let currentComparisonPage = 0;
let currentComparisonMode = "split"; // "split", "reconstruct", "original"
let generatedReportMarkdown = "";
let generatedNblmPrompt = "";
let generatedPromptGlobal = "";
let generatedPromptSlide = "";
let currentPromptMode = "global"; // "global" | "slide"
let generatedSlideHtml = "";
let currentProvider = localStorage.getItem("active_provider") || "gemini";
let modalSelectedProvider = currentProvider;

// 系統逆向工程 Prompt (真確幾何骨架與視覺還原專用引擎 - 零幻覺標準)
const CLIENT_SYSTEM_INSTRUCTION = `你是一位世界頂級的簡報視覺逆向架構師（Presentation Layout Reverse-Engineer）與幾何排版專家。
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

### 模式 1：全域風格架構（推薦：不限頁數，提取整份色彩、字型、標誌裝飾與版型庫，任意筆記皆可直接套用）
\`\`\`markdown
【任務宣告】：
請嚴格依據我上傳的筆記來源（Sources），提取關鍵事實與洞察，為我規劃一份結構嚴謹、視覺平衡的專業簡報內容。
（總頁數由您根據筆記內容深度自行裁量，建議 3~10 頁均可，每頁皆須嚴格遵循下列風格規範）

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
\`\`\`

### 模式 2：逐頁 1:1 對比（適合想要 100% 像素級還原特定投影片的嚴格填寫）
\`\`\`markdown
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

  // 提示詞模式選擇（左側操作卡片）
  document.querySelectorAll("#prompt-mode-selector .prompt-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-prompt-mode");
      if (mode) switchPromptMode(mode);
    });
  });

  // 提示詞模式切換（右側結果頁子導航）
  on("btn-subtab-global", "click", () => switchPromptMode("global"));
  on("btn-subtab-slide", "click", () => switchPromptMode("slide"));

  // 開始分析按鈕
  on("btn-start-analyze", "click", handleStartAnalyze);

  // 複製按鈕（動態對應當前所選模式）
  on("btn-copy-nblm", "click", () => {
    const promptToCopy = currentPromptMode === "global" ? (generatedPromptGlobal || generatedNblmPrompt) : (generatedPromptSlide || generatedNblmPrompt);
    if (!promptToCopy) return;
    navigator.clipboard.writeText(promptToCopy).then(() => {
      const label = document.getElementById("copy-btn-label");
      if (label) {
        const originalText = label.textContent;
        label.textContent = "已複製！";
        setTimeout(() => label.textContent = originalText, 2000);
      }
      const modeName = currentPromptMode === "global" ? "【模式 1：全域風格架構】" : "【模式 2：逐頁 1:1 對比】";
      showToast(`已成功複製 ${modeName} 提示詞！可至 NotebookLM 貼上`, "success");
    });
  });

  // 直達工作流按鈕：複製並開啟 NotebookLM
  on("btn-copy-and-open-nblm", "click", () => {
    const promptToCopy = currentPromptMode === "global" ? (generatedPromptGlobal || generatedNblmPrompt) : (generatedPromptSlide || generatedNblmPrompt);
    if (!promptToCopy) {
      showToast("尚未產生提示詞，請先上傳簡報進行分析", "warning");
      return;
    }
    navigator.clipboard.writeText(promptToCopy).then(() => {
      const modeName = currentPromptMode === "global" ? "【模式 1：全域風格】" : "【模式 2：逐頁 1:1】";
      showToast(`已複製 ${modeName} 提示詞！正在為您開啟 NotebookLM...`, "success");
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
  // 建立高穩定性模型候選清單（最新 2.5 Flash 優先，具備 1M context 與極高多模態視覺精度）
  const candidateModels = [];
  if (selectedModel && selectedModel !== "auto") {
    candidateModels.push(selectedModel);
  }
  // 候選優先級：gemini-2.5-flash ➔ gemini-2.0-flash ➔ gemini-1.5-flash
  const defaultList = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  for (const m of defaultList) {
    if (!candidateModels.includes(m)) {
      candidateModels.push(m);
    }
  }

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

  let lastError = null;

  // 自動依序嘗試候選模型（遇到個別模型未開放或 404 自動切換）
  for (const modelName of candidateModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const resJson = await response.json();
      if (!response.ok) {
        const msg = resJson.error ? resJson.error.message : "Gemini API 請求失敗";
        // 若該模型在該 API key 或版本下不存在或不支援，無縫嘗試下一個備援模型
        if (response.status === 404 || msg.includes("not found") || msg.includes("is not supported") || msg.includes("Call ModelService.ListModels")) {
          console.warn(`模型 ${modelName} 暫不可用，正在自動平滑切換至下一個備援模型...`, msg);
          lastError = new Error(`Google Gemini API 錯誤: ${msg}`);
          continue;
        }
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
    } catch (err) {
      if (err.message && (err.message.includes("not found") || err.message.includes("is not supported") || err.message.includes("ListModels"))) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Google Gemini API 無法調用任何可用模型，請檢查 API Key 是否正確。");
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

// === 4.1 精密多階段管線進度條控制 (Precision Pipeline Progress Tracker) ===
let progressPipelineInterval = null;

function resetProgressPipeline() {
  if (progressPipelineInterval) {
    clearInterval(progressPipelineInterval);
    progressPipelineInterval = null;
  }
  updatePipelineUi(12, 1, "正在高解析光學採樣畫布與圖層幾何邊界...");
}

function startProgressPipeline() {
  resetProgressPipeline();
  let currentPercent = 14;
  const startTime = Date.now();

  progressPipelineInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;

    // 階段 1：0 ~ 1.8 秒，推進到 35%
    if (elapsed < 1800) {
      currentPercent = Math.min(35, 14 + Math.floor((elapsed / 1800) * 21));
      updatePipelineUi(currentPercent, 1, "正在光學採樣投影片畫布與解析留白比例...");
    } 
    // 階段 2：1.8 ~ 4.5 秒，推進到 65%
    else if (elapsed < 4500) {
      currentPercent = Math.min(65, 35 + Math.floor(((elapsed - 1800) / 2700) * 30));
      updatePipelineUi(currentPercent, 2, "正在逆向版面幾何骨架，分析左右分割與卡片結構...");
    } 
    // 階段 3：4.5 ~ 7.5 秒，推進到 85%
    else if (elapsed < 7500) {
      currentPercent = Math.min(85, 65 + Math.floor(((elapsed - 4500) / 3000) * 20));
      updatePipelineUi(currentPercent, 3, "正在提取精準設計系統與 4 色 Hex 色票代碼...");
    } 
    // 階段 4：7.5 秒以上，平緩推進到 94%
    else {
      currentPercent = Math.min(94, 85 + Math.floor(((elapsed - 7500) / 4500) * 9));
      updatePipelineUi(currentPercent, 4, "正在編譯 NotebookLM 簡報風格與排版提示詞...");
    }
  }, 120);
}

function completeProgressPipeline() {
  if (progressPipelineInterval) {
    clearInterval(progressPipelineInterval);
    progressPipelineInterval = null;
  }
  updatePipelineUi(100, 4, "逆向分析全部就緒！正在為您渲染成果...");
}

function stopProgressPipeline() {
  if (progressPipelineInterval) {
    clearInterval(progressPipelineInterval);
    progressPipelineInterval = null;
  }
}

function updatePipelineUi(percent, activeStep, taskDescription) {
  const percentEl = document.getElementById("loading-progress-percent");
  const barEl = document.getElementById("loading-progress-bar");
  const taskEl = document.getElementById("loading-active-task");
  const stepCounterEl = document.getElementById("loading-step-counter");

  if (percentEl) percentEl.textContent = `${percent}%`;
  if (barEl) barEl.style.width = `${percent}%`;
  if (taskEl) taskEl.textContent = taskDescription;
  if (stepCounterEl) stepCounterEl.textContent = `階段 ${activeStep}/4`;

  for (let i = 1; i <= 4; i++) {
    const card = document.getElementById(`step-pipe-${i}`);
    const badge = document.getElementById(`step-pipe-badge-${i}`);
    const icon = document.getElementById(`step-pipe-icon-${i}`);
    if (!card || !badge || !icon) continue;

    if (i < activeStep || percent === 100) {
      // 已完成
      card.className = "p-3 rounded-lg bg-[#0E1013] border border-emerald-500/25 flex items-start gap-3 transition-colors opacity-100";
      icon.className = "w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5";
      icon.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i>';
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      badge.textContent = "已就緒";
    } else if (i === activeStep) {
      // 進行中
      card.className = "p-3 rounded-lg bg-[#0E1013] border border-white/20 flex items-start gap-3 transition-colors opacity-100 shadow-sm";
      icon.className = "w-6 h-6 rounded-md bg-white/10 text-white flex items-center justify-center shrink-0 mt-0.5 animate-pulse";
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/10 text-white border border-white/20";
      badge.textContent = "處理中";
    } else {
      // 等待中
      card.className = "p-3 rounded-lg bg-[#0E1013] border border-white/[0.05] flex items-start gap-3 transition-colors opacity-50";
      icon.className = "w-6 h-6 rounded-md bg-white/[0.04] text-zinc-500 flex items-center justify-center shrink-0 mt-0.5";
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.03] text-zinc-500 border border-white/[0.05]";
      badge.textContent = "等待中";
    }
  }
  if (window.lucide) window.lucide.createIcons();
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

  // 切換 UI 至載入狀態並啟動多階段管線進度條
  document.getElementById("panel-idle").classList.add("hidden");
  document.getElementById("panel-result").classList.add("hidden");
  document.getElementById("panel-loading").classList.remove("hidden");
  startProgressPipeline();

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
        "1. 必須逐頁精確拆解投影片的真實骨架（如：深色照片遮罩底、標題左側垂直實心粗色塊標柱、右上角外擴亮橘同心圓弧環、超粗無襯線字體、N 欄線框卡片等真實視覺特徵），100% 忠於原稿！\n" +
        "2. 產出的第 3 節 NotebookLM 提示詞必須同時完整輸出兩種模式代碼區塊：\n" +
        "   - 【模式 1：全域風格架構（推薦）】：提取全域視覺手冊與版型語法庫，不限頁數，適合任意筆記靈活套用。\n" +
        "   - 【模式 2：逐頁 1:1 對比】：嚴格對應原投影片各頁，輸出包含視覺配置與文案內容區的逐頁精確結構。\n" +
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

    // 推進到 100% 並短暫停留以呈現完成回饋
    completeProgressPipeline();
    await new Promise(resolve => setTimeout(resolve, 350));

    renderAnalysisResult(data);
    showToast("風格逆向分析完成！已為您產生 1:1 幾何對比與雙模式提示詞", "success");

  } catch (err) {
    stopProgressPipeline();
    console.error(err);
    showToast(err.message, "error");
    document.getElementById("panel-idle").classList.remove("hidden");
  } finally {
    stopProgressPipeline();
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

  // 萃取各項產出 (模式 1 與 模式 2)
  const extracted = extractNblmPromptModes(generatedReportMarkdown);
  generatedPromptGlobal = extracted.globalPrompt;
  generatedPromptSlide = extracted.slidePrompt;
  generatedNblmPrompt = currentPromptMode === "global" ? generatedPromptGlobal : generatedPromptSlide;
  generatedSlideHtml = extractSlideHtml(generatedReportMarkdown);

  // 渲染當前模式提示詞
  switchPromptMode(currentPromptMode);

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

function switchPromptMode(mode) {
  currentPromptMode = mode;

  // 更新左側按鈕樣式
  document.querySelectorAll("#prompt-mode-selector .prompt-mode-btn").forEach(btn => {
    const m = btn.getAttribute("data-prompt-mode");
    if (m === mode) {
      btn.className = "prompt-mode-btn active p-2 rounded-lg border text-left transition-all cursor-pointer bg-white/10 text-white border-white/20";
    } else {
      btn.className = "prompt-mode-btn p-2 rounded-lg border text-left transition-all cursor-pointer bg-white/[0.03] text-zinc-400 border-white/[0.08] hover:bg-white/[0.06]";
    }
  });

  // 更新右側結果頁子頁籤樣式
  const btnGlobal = document.getElementById("btn-subtab-global");
  const btnSlide = document.getElementById("btn-subtab-slide");
  const descGlobal = document.getElementById("desc-mode-global");
  const descSlide = document.getElementById("desc-mode-slide");
  const codeEl = document.getElementById("nblm-prompt-code");

  if (btnGlobal && btnSlide) {
    if (mode === "global") {
      btnGlobal.className = "subtab-mode-btn flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 bg-white/10 text-white shadow-sm border border-white/10 cursor-pointer";
      btnSlide.className = "subtab-mode-btn flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent cursor-pointer";
      if (descGlobal) descGlobal.classList.remove("hidden");
      if (descSlide) descSlide.classList.add("hidden");
      if (codeEl) codeEl.textContent = generatedPromptGlobal || generatedNblmPrompt || "未擷取到全域風格提示詞，請查看完整報告。";
    } else {
      btnSlide.className = "subtab-mode-btn flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 bg-white/10 text-white shadow-sm border border-white/10 cursor-pointer";
      btnGlobal.className = "subtab-mode-btn flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent cursor-pointer";
      if (descSlide) descSlide.classList.remove("hidden");
      if (descGlobal) descGlobal.classList.add("hidden");
      if (codeEl) codeEl.textContent = generatedPromptSlide || generatedNblmPrompt || "未擷取到逐頁 1:1 提示詞，請查看完整報告。";
    }
  }
  if (window.lucide) window.lucide.createIcons();
}
window.switchPromptMode = switchPromptMode;

function extractNblmPromptModes(markdown) {
  let globalPrompt = "";
  let slidePrompt = "";

  if (markdown.includes("## 3. 📋") || markdown.includes("NotebookLM 專用") || markdown.includes("NotebookLM")) {
    const parts = markdown.split(/## 3\..*?NotebookLM.*?/i);
    if (parts.length > 1) {
      const section = parts[1].split(/## 4\./)[0];

      // 嘗試按標題切分模式 1 與模式 2
      if (section.includes("模式 1") || section.includes("全域風格")) {
        const m1Part = section.split(/### 模式 2|模式 2/i)[0];
        const m1Match = m1Part.match(/```(?:markdown)?([\s\S]*?)```/i);
        if (m1Match && m1Match[1]) {
          globalPrompt = m1Match[1].trim();
        }
      }

      if (section.includes("模式 2") || section.includes("逐頁 1:1")) {
        const m2Part = section.split(/### 模式 2|模式 2/i)[1] || "";
        const m2Match = m2Part.match(/```(?:markdown)?([\s\S]*?)```/i);
        if (m2Match && m2Match[1]) {
          slidePrompt = m2Match[1].trim();
        }
      }

      // 若未分段匹配到，提取 section 內所有的 code blocks
      if (!globalPrompt || !slidePrompt) {
        const blocks = [...section.matchAll(/```(?:markdown)?([\s\S]*?)```/gi)];
        if (blocks.length >= 2) {
          if (!globalPrompt) globalPrompt = blocks[0][1].trim();
          if (!slidePrompt) slidePrompt = blocks[1][1].trim();
        } else if (blocks.length === 1) {
          if (!globalPrompt) globalPrompt = blocks[0][1].trim();
          if (!slidePrompt) slidePrompt = blocks[0][1].trim();
        }
      }
    }
  }

  // 全文通用備援
  if (!globalPrompt) {
    const firstBlock = markdown.match(/```(?:markdown)?([\s\S]*?)```/i);
    globalPrompt = firstBlock ? firstBlock[1].trim() : markdown;
  }
  if (!slidePrompt) {
    slidePrompt = globalPrompt;
  }

  return { globalPrompt, slidePrompt };
}

function extractNblmPrompt(markdown) {
  const res = extractNblmPromptModes(markdown);
  return currentPromptMode === "global" ? res.globalPrompt : res.slidePrompt;
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
