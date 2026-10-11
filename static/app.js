// 狀態管理
let selectedFiles = [];
let uploadedSlidePages = []; // [{ page: 1, image: "data:..." }, ...]
let currentComparisonPage = 0;
let currentComparisonMode = "split"; // "split", "reconstruct", "original"
let generatedReportMarkdown = "";
let generatedNblmPrompt = "";
let generatedGammaPrompt = "";
let generatedSlideHtml = "";
let currentProvider = localStorage.getItem("active_provider") || "gemini";
let modalSelectedProvider = currentProvider;

// 模型規格資料庫
const PROVIDER_CONFIG = {
  gemini: {
    name: "Google Gemini",
    defaultPlaceholder: "AIzaSy...",
    portalText: "前往 Google AI Studio 免費申請",
    portalUrl: "https://aistudio.google.com/app/apikey",
    models: [
      { id: "auto", name: "⚡ 智慧自動判定（依簡報長度自動適配）" },
      { id: "gemini-2.5-flash", name: "🚀 Gemini 2.5 Flash（3秒極速、額度最充裕）" },
      { id: "gemini-1.5-pro", name: "🧠 Gemini 1.5 Pro（深度解析、10+ 頁複雜簡報）" },
      { id: "gemini-2.0-flash", name: "⚡ Gemini 2.0 Flash（次世代極速推導）" }
    ],
    descriptions: {
      "auto": {
        title: "⚡ 智慧自動判定模式（免動腦首選）",
        text: "系統自動偵測投影片總頁數：少於 10 頁時以 3 秒極速模型快速推導；長篇大報告則自動切換至百萬上下文 Pro 模型進行深度推論。"
      },
      "gemini-2.5-flash": {
        title: "🚀 Gemini 2.5 Flash（日常極速首選）",
        text: "速度約 3~5 秒。色彩 Hex 與排版網格萃取精準，Google 免費額度最高、幾乎不觸發頻率限制。"
      },
      "gemini-1.5-pro": {
        title: "🧠 Gemini 1.5 Pro（深度推論與長篇首選）",
        text: "具備百萬 Token 超大上下文能力。專門應對超長簡報、麥肯錫諮詢風密集圖表、或微光影排印學情境。"
      },
      "gemini-2.0-flash": {
        title: "⚡ Gemini 2.0 Flash（次世代極速模型）",
        text: "反應敏捷（約 3 秒完成）。專注於結構標籤快速推導，適合快速連續測試。"
      }
    }
  },
  openai: {
    name: "OpenAI",
    defaultPlaceholder: "sk-proj-...",
    portalText: "前往 OpenAI Platform 建立 Key",
    portalUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "auto", name: "⚡ 智慧自動判定（推薦首選）" },
      { id: "gpt-4o", name: "🧠 GPT-4o（旗艦深度：高精準視覺理解）" },
      { id: "gpt-4o-mini", name: "🚀 GPT-4o mini（極速輕量：秒級分析）" }
    ],
    descriptions: {
      "auto": {
        title: "⚡ 智慧自動判定模式（OpenAI）",
        text: "系統將自動依據頁數與複雜度，在 GPT-4o 旗艦模型與 GPT-4o mini 極速模型之間切換。"
      },
      "gpt-4o": {
        title: "🧠 GPT-4o（OpenAI 旗艦多模態視覺）",
        text: "全球頂級多模態模型，對高複雜排版與色彩反差有極高敏銳度，適合精準逆向專業簡報。"
      },
      "gpt-4o-mini": {
        title: "🚀 GPT-4o mini（極速輕量）",
        text: "極低成本、回應極快，適合日常投影片快速擷取色票與大綱。"
      }
    }
  },
  anthropic: {
    name: "Anthropic Claude",
    defaultPlaceholder: "sk-ant-...",
    portalText: "前往 Anthropic Console 建立 Key",
    portalUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "auto", name: "⚡ 智慧自動判定（推薦首選）" },
      { id: "claude-3-5-sonnet-20241022", name: "🧠 Claude 3.5 Sonnet（美學旗艦：極致排版語感）" },
      { id: "claude-3-5-haiku-20241022", name: "🚀 Claude 3.5 Haiku（極速輕量：快速架構萃取）" }
    ],
    descriptions: {
      "auto": {
        title: "⚡ 智慧自動判定模式（Claude）",
        text: "系統預設使用被譽為設計審美最強的 Claude 3.5 Sonnet 模型為您進行風格逆向。"
      },
      "claude-3-5-sonnet-20241022": {
        title: "🧠 Claude 3.5 Sonnet（設計美學首選）",
        text: "業界公認文字品味、排版語言理解與 Markdown 規範遵循度最高的頂級視覺模型。"
      },
      "claude-3-5-haiku-20241022": {
        title: "🚀 Claude 3.5 Haiku（極速輕量）",
        text: "速度極快，兼顧優質文筆與架構提煉能力。"
      }
    }
  }
};

// DOM 初始化
document.addEventListener("DOMContentLoaded", () => {
  initProviderAndModels();
  initApiKeyStatus();
  setupEventListeners();
  updateUiState();
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
  const config = PROVIDER_CONFIG[currentProvider];
  
  if (key) {
    dot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
    text.textContent = `${config.name} 就緒`;
    text.className = "text-emerald-700 font-semibold";
  } else {
    dot.className = "w-2 h-2 rounded-full bg-amber-500";
    text.textContent = `設定 ${config.name} Key`;
    text.className = "text-slate-700 font-semibold";
  }
}

// 切換供應商與更新模型下拉清單
function switchProvider(newProvider) {
  currentProvider = newProvider;
  localStorage.setItem("active_provider", newProvider);

  // 更新主面板供應商標籤外觀 (護眼深色風格)
  document.querySelectorAll("#provider-selector .provider-tab").forEach(btn => {
    const p = btn.getAttribute("data-provider");
    if (p === newProvider) {
      btn.className = "provider-tab px-2 py-1.5 rounded-lg text-xs font-bold transition-all text-center bg-slate-800 text-sky-300 shadow-sm border border-slate-700 cursor-pointer";
    } else {
      btn.className = "provider-tab px-2 py-1.5 rounded-lg text-xs font-semibold transition-all text-center text-slate-400 hover:text-slate-200 cursor-pointer";
    }
  });

  // 更新模型選單
  const config = PROVIDER_CONFIG[newProvider];
  const modelSelect = document.getElementById("model-select");
  modelSelect.innerHTML = "";
  config.models.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    modelSelect.appendChild(opt);
  });

  updateModelDescription();
  initApiKeyStatus();
  lucide.createIcons();
}

function updateModelDescription() {
  const config = PROVIDER_CONFIG[currentProvider];
  const modelSelect = document.getElementById("model-select");
  const selectedModelId = modelSelect.value || "auto";
  const desc = config.descriptions[selectedModelId] || config.descriptions["auto"];

  document.getElementById("model-desc-title").textContent = desc.title;
  document.getElementById("model-desc-text").textContent = desc.text;
}

function initProviderAndModels() {
  switchProvider(currentProvider);
}

// === 2. 事件監聽設置 ===
function setupEventListeners() {
  const modalApiKey = document.getElementById("modal-apikey");
  const modalTutorial = document.getElementById("modal-tutorial");
  const modalSecurity = document.getElementById("modal-security");

  // 頂部導航按鈕
  document.getElementById("btn-apikey-modal").addEventListener("click", () => {
    openApiKeyModal(currentProvider);
  });
  document.getElementById("btn-close-apikey-modal").addEventListener("click", () => {
    modalApiKey.classList.add("hidden");
  });

  document.getElementById("btn-tutorial").addEventListener("click", () => {
    modalTutorial.classList.remove("hidden");
  });
  document.getElementById("btn-close-tutorial").addEventListener("click", () => {
    modalTutorial.classList.add("hidden");
  });
  document.getElementById("btn-tutorial-got-it").addEventListener("click", () => {
    modalTutorial.classList.add("hidden");
    if (!getApiKey(currentProvider)) {
      openApiKeyModal(currentProvider);
    }
  });

  document.getElementById("btn-security").addEventListener("click", () => {
    modalSecurity.classList.remove("hidden");
  });
  document.getElementById("btn-close-security").addEventListener("click", () => {
    modalSecurity.classList.add("hidden");
  });
  document.getElementById("btn-close-security-confirm").addEventListener("click", () => {
    modalSecurity.classList.add("hidden");
  });

  // 主面板供應商切換
  document.querySelectorAll("#provider-selector .provider-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-provider");
      switchProvider(p);
    });
  });

  // 模型切換
  document.getElementById("model-select").addEventListener("change", updateModelDescription);

  // 金鑰設定彈窗內供應商切換
  document.querySelectorAll("#modal-provider-selector .modal-provider-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-modal-provider");
      openApiKeyModal(p);
    });
  });

  // 儲存金鑰
  document.getElementById("btn-save-key").addEventListener("click", () => {
    const key = document.getElementById("input-api-key").value.trim();
    if (!key) {
      showToast("請輸入有效金鑰，或點擊清除", "warning");
      return;
    }
    setApiKey(modalSelectedProvider, key);
    modalApiKey.classList.add("hidden");
    showToast(`${PROVIDER_CONFIG[modalSelectedProvider].name} 金鑰已安全保存！`, "success");
    if (modalSelectedProvider !== currentProvider) {
      switchProvider(modalSelectedProvider);
    }
  });

  // 清除金鑰
  document.getElementById("btn-clear-key").addEventListener("click", () => {
    setApiKey(modalSelectedProvider, "");
    document.getElementById("input-api-key").value = "";
    showToast(`已清除 ${PROVIDER_CONFIG[modalSelectedProvider].name} 本地金鑰`, "info");
  });

  // 密碼顯隱切換
  const toggleBtn = document.getElementById("btn-toggle-key-visibility");
  const keyInput = document.getElementById("input-api-key");
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

  // 教學頁籤切換
  document.querySelectorAll(".tut-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tut = btn.getAttribute("data-tut");
      document.querySelectorAll(".tut-tab-btn").forEach(b => {
        b.className = "tut-tab-btn py-2 border-b-2 border-transparent text-slate-400 hover:text-slate-200 cursor-pointer";
      });
      btn.className = "tut-tab-btn py-2 border-b-2 border-sky-400 text-sky-400 font-bold cursor-pointer";

      document.getElementById("tut-content-gemini").classList.add("hidden");
      document.getElementById("tut-content-openai").classList.add("hidden");
      document.getElementById("tut-content-anthropic").classList.add("hidden");
      document.getElementById(`tut-content-${tut}`).classList.remove("hidden");
      lucide.createIcons();
    });
  });

  // 折疊/展開 AI 進階設定
  const toggleModelBtn = document.getElementById("btn-toggle-model-settings");
  const collapsibleSection = document.getElementById("collapsible-model-section");
  const labelToggle = document.getElementById("label-toggle-model");
  const iconToggle = document.getElementById("icon-toggle-model");
  if (toggleModelBtn && collapsibleSection) {
    toggleModelBtn.addEventListener("click", () => {
      const isHidden = collapsibleSection.classList.toggle("hidden");
      if (isHidden) {
        if (labelToggle) labelToggle.textContent = "展開進階選項";
        if (iconToggle) iconToggle.classList.remove("rotate-180");
      } else {
        if (labelToggle) labelToggle.textContent = "收起進階選項";
        if (iconToggle) iconToggle.classList.add("rotate-180");
      }
    });
  }

  // 拖曳上傳與檔案選擇
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");

  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-sky-400", "bg-slate-800/60");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-sky-400", "bg-slate-800/60");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-sky-400", "bg-slate-800/60");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesAdded(Array.from(e.target.files));
    }
  });

  document.getElementById("btn-clear-files").addEventListener("click", () => {
    selectedFiles = [];
    uploadedSlidePages = [];
    currentComparisonPage = 0;
    document.getElementById("thumbnail-gallery").innerHTML = "";
    document.getElementById("file-preview-section").classList.add("hidden");
    fileInput.value = "";
    showToast("已清空選擇檔案", "info");
  });

  // 結果頁籤切換監聽
  document.querySelectorAll(".result-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-result-tab");
      switchResultTab(tab);
    });
  });

  // 檢視模式切換 (並排 / 僅看還原 / 僅看原檔)
  document.getElementById("mode-btn-split").addEventListener("click", () => setComparisonMode("split"));
  document.getElementById("mode-btn-reconstruct").addEventListener("click", () => setComparisonMode("reconstruct"));
  document.getElementById("mode-btn-original").addEventListener("click", () => setComparisonMode("original"));

  // 投影片翻頁監聽
  document.getElementById("btn-prev-slide").addEventListener("click", () => {
    if (currentComparisonPage > 0) {
      currentComparisonPage--;
      updateComparisonView();
    }
  });
  document.getElementById("btn-next-slide").addEventListener("click", () => {
    if (currentComparisonPage < uploadedSlidePages.length - 1) {
      currentComparisonPage++;
      updateComparisonView();
    }
  });

  // 開始分析按鈕
  document.getElementById("btn-start-analyze").addEventListener("click", handleStartAnalyze);

  // 複製按鈕
  document.getElementById("btn-copy-nblm").addEventListener("click", () => {
    if (!generatedNblmPrompt) return;
    navigator.clipboard.writeText(generatedNblmPrompt).then(() => {
      const label = document.getElementById("copy-btn-label");
      const originalText = label.textContent;
      label.textContent = "已複製！";
      showToast("已複製 NotebookLM 專用提示詞！可至 NBLM 貼上", "success");
      setTimeout(() => label.textContent = originalText, 2000);
    });
  });

  const copyGammaBtn = document.getElementById("btn-copy-gamma");
  if (copyGammaBtn) {
    copyGammaBtn.addEventListener("click", () => {
      if (!generatedGammaPrompt) return;
      navigator.clipboard.writeText(generatedGammaPrompt).then(() => {
        const label = document.getElementById("copy-gamma-label");
        const originalText = label.textContent;
        label.textContent = "已複製！";
        showToast("已複製 Gamma AI 簡報風格指令！", "success");
        setTimeout(() => label.textContent = originalText, 2000);
      });
    });
  }

  // 直達工作流按鈕：複製並開啟 NotebookLM
  const copyAndOpenNblmBtn = document.getElementById("btn-copy-and-open-nblm");
  if (copyAndOpenNblmBtn) {
    copyAndOpenNblmBtn.addEventListener("click", () => {
      if (!generatedNblmPrompt) {
        showToast("尚未產生提示詞，請先上傳簡報進行分析", "warning");
        return;
      }
      navigator.clipboard.writeText(generatedNblmPrompt).then(() => {
        showToast("已複製提示詞！正在為您開啟 NotebookLM...", "success");
        window.open("https://notebooklm.google.com/", "_blank");
      });
    });
  }

  // 直達工作流按鈕：複製並開啟 Gamma
  const copyAndOpenGammaBtn = document.getElementById("btn-copy-and-open-gamma");
  if (copyAndOpenGammaBtn) {
    copyAndOpenGammaBtn.addEventListener("click", () => {
      if (!generatedGammaPrompt) {
        showToast("尚未產生 Gamma 指令，請先上傳簡報進行分析", "warning");
        return;
      }
      navigator.clipboard.writeText(generatedGammaPrompt).then(() => {
        showToast("已複製 Gamma 風格指令！正在為您開啟 Gamma...", "success");
        window.open("https://gamma.app/", "_blank");
      });
    });
  }

  const copyHtmlBtn = document.getElementById("btn-copy-html-code");
  if (copyHtmlBtn) {
    copyHtmlBtn.addEventListener("click", () => {
      if (!generatedSlideHtml) return;
      navigator.clipboard.writeText(generatedSlideHtml).then(() => {
        const label = document.getElementById("copy-html-label");
        const originalText = label.textContent;
        label.textContent = "已複製！";
        showToast("已複製 1:1 還原之 HTML / Tailwind 投影片代碼！", "success");
        setTimeout(() => label.textContent = originalText, 2000);
      });
    });
  }

  const openWindowBtn = document.getElementById("btn-open-preview-window");
  if (openWindowBtn) {
    openWindowBtn.addEventListener("click", () => {
      if (!generatedSlideHtml) {
        showToast("尚未產生投影片代碼", "warning");
        return;
      }
      const win = window.open("", "_blank");
      win.document.write(buildFullSlideHtml(generatedSlideHtml));
      win.document.close();
    });
  }

  document.getElementById("btn-copy-all-report").addEventListener("click", () => {
    if (!generatedReportMarkdown) return;
    navigator.clipboard.writeText(generatedReportMarkdown).then(() => {
      showToast("已複製整份風格逆向工程報告！", "success");
    });
  });

  document.getElementById("btn-export-markdown").addEventListener("click", () => {
    if (!generatedReportMarkdown) return;
    const blob = new Blob([generatedReportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NBLM-簡報風格逆向報告-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("已下載報告檔案！", "success");
  });
}

function openApiKeyModal(provider) {
  modalSelectedProvider = provider;
  const config = PROVIDER_CONFIG[provider];
  const modalApiKey = document.getElementById("modal-apikey");

  // 更新彈窗內的按鈕選中樣式
  document.querySelectorAll("#modal-provider-selector .modal-provider-btn").forEach(btn => {
    const p = btn.getAttribute("data-modal-provider");
    if (p === provider) {
      btn.className = "modal-provider-btn px-2 py-1.5 rounded-lg text-xs font-bold border transition-all text-center bg-sky-600 text-white border-sky-600 cursor-pointer";
    } else {
      btn.className = "modal-provider-btn px-2 py-1.5 rounded-lg text-xs font-bold border transition-all text-center bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750 cursor-pointer";
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

// === 3. 檔案處理與縮圖收集 ===
async function handleFilesAdded(files) {
  const validExtensions = [".pptx", ".pdf", ".png", ".jpg", ".jpeg", ".webp"];
  const newFiles = files.filter(f => {
    const ext = "." + f.name.split(".").pop().toLowerCase();
    return validExtensions.includes(ext);
  });

  if (newFiles.length === 0) {
    showToast("未檢測到支援的簡報檔案，請上傳 PPTX、PDF 或圖片", "warning");
    return;
  }

  selectedFiles.push(...newFiles);
  document.getElementById("file-preview-section").classList.remove("hidden");
  document.getElementById("file-count-label").textContent = `已選取 ${selectedFiles.length} 個檔案`;

  const gallery = document.getElementById("thumbnail-gallery");

  for (const file of newFiles) {
    const ext = "." + file.name.split(".").pop().toLowerCase();
    
    if (ext === ".pdf" || ext === ".pptx") {
      const previewCard = document.createElement("div");
      previewCard.className = "relative rounded-xl border border-slate-700 bg-slate-900/80 p-2 flex flex-col items-center justify-center text-center text-xs text-slate-300 shadow-sm";
      const fileIcon = ext === ".pptx" ? "presentation" : "file-text";
      previewCard.innerHTML = `
        <div class="animate-pulse flex flex-col items-center py-3">
          <i data-lucide="${fileIcon}" class="w-6 h-6 text-sky-400 mb-1"></i>
          <span class="truncate max-w-[85px] font-mono text-[10px] text-slate-300">${file.name}</span>
          <span class="text-[9px] text-slate-500 mt-0.5">解析投影片...</span>
        </div>
      `;
      gallery.appendChild(previewCard);
      lucide.createIcons();

      try {
        const formData = new FormData();
        formData.append("file", file);
        const resp = await fetch("/api/preview", {
          method: "POST",
          body: formData
        });
        const data = await resp.json();
        
        if (data.status === "success" && data.preview_pages && data.preview_pages.length > 0) {
          // 儲存頁面縮圖給雙欄對比視窗使用
          uploadedSlidePages.push(...data.preview_pages);
          
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
      } catch (err) {
        console.warn("無法取得縮圖:", err);
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

// === 4. 開始發起分析流程 ===
async function handleStartAnalyze() {
  if (selectedFiles.length === 0) {
    showToast("請先上傳簡報 PPTX、PDF 或投影片圖片！", "warning");
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

  const formData = new FormData();
  selectedFiles.forEach(file => {
    formData.append("files", file);
  });

  formData.append("provider", currentProvider);
  const model = document.getElementById("model-select").value || "auto";
  formData.append("model", model);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "x-api-key": apiKey
      },
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "分析失敗");
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
  generatedGammaPrompt = extractGammaPrompt(generatedReportMarkdown);
  generatedSlideHtml = extractSlideHtml(generatedReportMarkdown);

  document.getElementById("nblm-prompt-code").textContent = generatedNblmPrompt || "未能擷取到特定提示詞區塊，請參閱下方全文報告。";
  
  const gammaCodeEl = document.getElementById("gamma-prompt-code");
  if (gammaCodeEl) {
    gammaCodeEl.textContent = generatedGammaPrompt || "未能擷取到特定 Gamma 指令，請參閱完整規範報告。";
  }

  // 渲染右側 1:1 投影片 iframe
  if (generatedSlideHtml) {
    const iframe = document.getElementById("slide-preview-iframe");
    if (iframe) {
      iframe.srcdoc = buildFullSlideHtml(generatedSlideHtml);
    }
  }

  // 更新「左右並排對比」視窗
  currentComparisonPage = 0;
  updateComparisonView();
  setComparisonMode("split");

  // 預設切換至 NotebookLM 提示詞頁籤
  switchResultTab("nblm");

  const meta = data.structured_meta || fallbackExtractMeta(generatedReportMarkdown);
  
  document.getElementById("result-style-name").textContent = meta.style_name || "簡報視覺風格解析報告";

  const autoBadge = document.getElementById("result-auto-badge");
  if (data.auto_reason) {
    autoBadge.textContent = data.auto_reason;
    autoBadge.classList.remove("hidden");
  } else if (data.model_used) {
    autoBadge.textContent = `模型: ${data.model_used}`;
    autoBadge.classList.remove("hidden");
  } else {
    autoBadge.classList.add("hidden");
  }

  const tagsContainer = document.getElementById("result-tags-container");
  tagsContainer.innerHTML = "";
  (meta.tags || ["麥肯錫架構", "純2D扁平", "三欄線框卡片", "同心圓模型"]).forEach(tag => {
    const span = document.createElement("span");
    span.className = "px-2.5 py-1 text-xs rounded-lg bg-slate-800 text-slate-300 border border-slate-700 font-semibold";
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

// 檢視模式切換 (並排 / 僅看還原 / 僅看原檔)
function setComparisonMode(mode) {
  currentComparisonMode = mode;
  const grid = document.getElementById("comparison-grid");
  const paneOriginal = document.getElementById("pane-original-slide");
  const paneReconstruct = document.getElementById("pane-reconstructed-slide");
  
  const btnSplit = document.getElementById("mode-btn-split");
  const btnReconstruct = document.getElementById("mode-btn-reconstruct");
  const btnOriginal = document.getElementById("mode-btn-original");

  [btnSplit, btnReconstruct, btnOriginal].forEach(btn => {
    btn.className = "px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer transition-all flex items-center gap-1 text-xs font-semibold";
  });

  if (mode === "split") {
    btnSplit.className = "px-3 py-1.5 rounded-lg bg-slate-800 text-sky-300 shadow-sm border border-slate-700 cursor-pointer transition-all flex items-center gap-1 text-xs font-bold";
    grid.className = "grid grid-cols-1 md:grid-cols-2 gap-4 pt-1";
    paneOriginal.classList.remove("hidden");
    paneReconstruct.classList.remove("hidden");
  } else if (mode === "reconstruct") {
    btnReconstruct.className = "px-3 py-1.5 rounded-lg bg-slate-800 text-sky-300 shadow-sm border border-slate-700 cursor-pointer transition-all flex items-center gap-1 text-xs font-bold";
    grid.className = "grid grid-cols-1 gap-4 pt-1";
    paneOriginal.classList.add("hidden");
    paneReconstruct.classList.remove("hidden");
  } else if (mode === "original") {
    btnOriginal.className = "px-3 py-1.5 rounded-lg bg-slate-800 text-sky-300 shadow-sm border border-slate-700 cursor-pointer transition-all flex items-center gap-1 text-xs font-bold";
    grid.className = "grid grid-cols-1 gap-4 pt-1";
    paneOriginal.classList.remove("hidden");
    paneReconstruct.classList.add("hidden");
  }
  lucide.createIcons();
}

function switchResultTab(tabName) {
  document.querySelectorAll(".result-tab-btn").forEach(btn => {
    const t = btn.getAttribute("data-result-tab");
    if (t === tabName) {
      btn.className = "result-tab-btn active px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all bg-slate-800 text-sky-300 shadow-sm border border-slate-700 cursor-pointer";
    } else {
      btn.className = "result-tab-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer";
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

function extractGammaPrompt(markdown) {
  if (markdown.includes("## 4. 🚀 Gamma") || markdown.includes("Gamma AI")) {
    const parts = markdown.split(/## 4\..*?Gamma.*?/i);
    if (parts.length > 1) {
      const section = parts[1].split(/## 5\./)[0];
      const codeMatch = section.match(/```(?:markdown)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        return codeMatch[1].trim();
      }
      return section.trim();
    }
  }
  return "";
}

function extractSlideHtml(markdown) {
  if (markdown.includes("## 5. 💻") || markdown.includes("HTML / Tailwind") || markdown.includes("HTML 代碼")) {
    const parts = markdown.split(/## 5\..*?HTML.*?/i);
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

// Pantone / 設計系統風格色票卡片
function renderColorPalette(palette) {
  const container = document.getElementById("color-palette-container");
  container.innerHTML = "";

  palette.forEach(color => {
    const card = document.createElement("div");
    card.className = "group bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700 rounded-xl p-3 flex flex-col justify-between transition-all cursor-pointer shadow-sm hover:border-slate-600";
    card.title = "點擊複製 Hex 色碼";
    
    card.innerHTML = `
      <div class="w-full h-9 rounded-lg shadow-inner border border-black/30 mb-2.5" style="background-color: ${color.hex}"></div>
      <div>
        <div class="text-[11px] font-bold text-slate-200 truncate">${color.role || color.name}</div>
        <div class="text-[11px] font-mono font-semibold text-sky-400 flex items-center justify-between mt-0.5">
          <span>${color.hex}</span>
          <i data-lucide="copy" class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400"></i>
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
