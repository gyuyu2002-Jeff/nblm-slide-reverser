// 狀態管理
let selectedFiles = [];
let generatedReportMarkdown = "";
let generatedNblmPrompt = "";

// DOM 元素載入
document.addEventListener("DOMContentLoaded", () => {
  initApiKeyStatus();
  setupEventListeners();
  updateUiState();
});

// === 1. API KEY 管理 (完全用戶端本地儲存，保障資安) ===
function getApiKey() {
  return localStorage.getItem("gemini_api_key") || "";
}

function setApiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem("gemini_api_key", key.trim());
  } else {
    localStorage.removeItem("gemini_api_key");
  }
  initApiKeyStatus();
}

function initApiKeyStatus() {
  const key = getApiKey();
  const dot = document.getElementById("status-indicator-dot");
  const text = document.getElementById("status-indicator-text");
  const modalInput = document.getElementById("input-api-key");
  
  if (key) {
    dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
    text.textContent = "Gemini Key 已就緒";
    text.className = "text-emerald-300 font-medium";
    modalInput.value = key;
  } else {
    dot.className = "w-2 h-2 rounded-full bg-amber-400";
    text.textContent = "設定 Gemini Key";
    text.className = "text-amber-300 font-medium";
    modalInput.value = "";
  }
}

// === 2. 事件監聽設置 ===
function setupEventListeners() {
  // 模態視窗開關
  const modalApiKey = document.getElementById("modal-apikey");
  const modalTutorial = document.getElementById("modal-tutorial");
  const modalSecurity = document.getElementById("modal-security");

  document.getElementById("btn-apikey-modal").addEventListener("click", () => {
    modalApiKey.classList.remove("hidden");
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
    if (!getApiKey()) {
      modalApiKey.classList.remove("hidden");
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

  // API Key 儲存 / 清除 / 顯隱
  document.getElementById("btn-save-key").addEventListener("click", () => {
    const key = document.getElementById("input-api-key").value.trim();
    if (!key) {
      showToast("請輸入有效金鑰，或點擊清除", "warning");
      return;
    }
    setApiKey(key);
    modalApiKey.classList.add("hidden");
    showToast("API Key 已安全儲存於您本地瀏覽器！", "success");
  });

  document.getElementById("btn-clear-key").addEventListener("click", () => {
    setApiKey("");
    modalApiKey.classList.add("hidden");
    showToast("已清除本地保存之 API Key", "info");
  });

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

  // 拖曳上傳與檔案選擇
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");

  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-indigo-500", "bg-indigo-950/20");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-indigo-500", "bg-indigo-950/20");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-indigo-500", "bg-indigo-950/20");
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
    document.getElementById("thumbnail-gallery").innerHTML = "";
    document.getElementById("file-preview-section").classList.add("hidden");
    fileInput.value = "";
    showToast("已清空選擇檔案", "info");
  });

  // 模型切換白話文說明
  const modelSelect = document.getElementById("model-select");
  const modelDescTitle = document.getElementById("model-desc-title");
  const modelDescText = document.getElementById("model-desc-text");

  const modelDescriptions = {
    "auto": {
      title: "⚡ 智慧自動判定模式（免動腦首選）",
      text: "系統自動偵測投影片總頁數與元素密度：少於 10 頁時以 3 秒極速模型快速推導；長篇大報告則自動切換至百萬上下文 Pro 模型進行深度推論。"
    },
    "gemini-2.5-flash": {
      title: "🚀 Gemini 2.5 Flash（日常極速首選）",
      text: "速度約 3~5 秒。適合 1~10 頁精選截圖或一般投影片。色彩 Hex 與排版網格萃取精準，Google 免費額度最高、幾乎不觸發頻率限制。"
    },
    "gemini-1.5-pro": {
      title: "🧠 Gemini 1.5 Pro（深度推論與長篇首選）",
      text: "耗時約 12~20 秒。具備百萬 Token 超大上下文能力。專門應對 30+ 頁超長簡報、麥肯錫諮詢風密集圖表、或極度講求微光影與字距排印學的情境。"
    },
    "gemini-2.0-flash": {
      title: "⚡ Gemini 2.0 Flash（次世代極速模型）",
      text: "反應敏捷（約 3 秒完成）。專注於結構標籤快速推導，適合快速連續測試不同投影片風格。"
    }
  };

  modelSelect.addEventListener("change", (e) => {
    const desc = modelDescriptions[e.target.value] || modelDescriptions["auto"];
    modelDescTitle.textContent = desc.title;
    modelDescText.textContent = desc.text;
  });

  // 開始分析按鈕
  document.getElementById("btn-start-analyze").addEventListener("click", handleStartAnalyze);

  // 複製按鈕們
  document.getElementById("btn-copy-nblm").addEventListener("click", () => {
    if (!generatedNblmPrompt) return;
    navigator.clipboard.writeText(generatedNblmPrompt).then(() => {
      const label = document.getElementById("copy-btn-label");
      const originalText = label.textContent;
      label.textContent = "已複製！";
      showToast("已複製 NotebookLM 專用提示詞！可直接至 NBLM 貼上", "success");
      setTimeout(() => label.textContent = originalText, 2000);
    });
  });

  document.getElementById("btn-copy-all-report").addEventListener("click", () => {
    if (!generatedReportMarkdown) return;
    navigator.clipboard.writeText(generatedReportMarkdown).then(() => {
      showToast("已複製整份風格逆向工程報告！", "success");
    });
  });

  // 匯出 Markdown 按鈕
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

// === 3. 檔案處理與縮圖預覽 ===
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
      // 呼叫後端提取 PDF / PPTX 縮圖
      const previewCard = document.createElement("div");
      previewCard.className = "relative rounded-lg border border-slate-700 bg-surface-800 p-2 flex flex-col items-center justify-center text-center text-xs text-slate-300";
      const fileIcon = ext === ".pptx" ? "presentation" : "file-text";
      previewCard.innerHTML = `
        <div class="animate-pulse flex flex-col items-center py-4">
          <i data-lucide="${fileIcon}" class="w-6 h-6 text-indigo-400 mb-1"></i>
          <span class="truncate max-w-[90px] font-mono text-[10px]">${file.name}</span>
          <span class="text-[9px] text-slate-500 mt-0.5">解析投影片中...</span>
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
          previewCard.innerHTML = `
            <div class="relative w-full h-24 overflow-hidden rounded bg-black/40">
              <img src="${data.preview_pages[0].image}" class="w-full h-full object-cover">
              <span class="absolute bottom-1 right-1 bg-black/70 text-[9px] px-1 py-0.2 rounded text-slate-200">
                ${ext.toUpperCase().replace('.', '')} · 共 ${data.total_pages} 頁
              </span>
            </div>
            <span class="truncate max-w-[95px] text-[10px] text-slate-300 mt-1">${file.name}</span>
          `;
        }
      } catch (err) {
        console.warn("無法取得縮圖:", err);
      }

    } else {
      // 圖片格式直接前端預覽
      const reader = new FileReader();
      reader.onload = (e) => {
        const card = document.createElement("div");
        card.className = "relative rounded-lg border border-slate-700 bg-surface-800 p-1 flex flex-col items-center";
        card.innerHTML = `
          <div class="w-full h-24 overflow-hidden rounded bg-black/40">
            <img src="${e.target.result}" class="w-full h-full object-cover">
          </div>
          <span class="truncate max-w-[95px] text-[10px] text-slate-300 mt-1">${file.name}</span>
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
    showToast("請先上傳簡報 PDF 或投影片圖片！", "warning");
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    showToast("請先輸入您的 Google Gemini API Key（免費）", "warning");
    document.getElementById("modal-apikey").classList.remove("hidden");
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

  const model = document.getElementById("model-select").value;
  formData.append("model", model);
  
  const customFocus = document.getElementById("custom-focus").value;
  if (customFocus) {
    formData.append("custom_focus", customFocus);
  }

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "x-gemini-api-key": apiKey
      },
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "分析失敗");
    }

    // 成功渲染結果
    renderAnalysisResult(data);
    showToast("風格逆向分析完成！已為您產生 NBLM 提示詞", "success");

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

// === 5. 結果渲染邏輯 ===
function renderAnalysisResult(data) {
  generatedReportMarkdown = data.markdown_report || "";
  
  // 切換面板
  document.getElementById("panel-idle").classList.add("hidden");
  document.getElementById("panel-loading").classList.add("hidden");
  document.getElementById("panel-result").classList.remove("hidden");

  // 1. 提取 NotebookLM 專用提示詞
  generatedNblmPrompt = extractNblmPrompt(generatedReportMarkdown);
  document.getElementById("nblm-prompt-code").textContent = generatedNblmPrompt || "未能擷取到特定提示詞區塊，請參閱下方全文報告。";

  // 2. 結構化色票與標籤
  const meta = data.structured_meta || fallbackExtractMeta(generatedReportMarkdown);
  
  // 風格名稱與自動判定標籤
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

  // 風格標籤
  const tagsContainer = document.getElementById("result-tags-container");
  tagsContainer.innerHTML = "";
  (meta.tags || ["簡報逆向", "視覺規範", "NBLM 適配"]).forEach(tag => {
    const span = document.createElement("span");
    span.className = "px-2.5 py-1 text-xs rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-medium";
    span.textContent = `# ${tag}`;
    tagsContainer.appendChild(span);
  });

  // 留白比例
  if (meta.white_space_ratio) {
    document.getElementById("white-space-metric").textContent = `留白指標: ${meta.white_space_ratio}`;
  }

  // 色票調色盤渲染
  renderColorPalette(meta.palette || [
    { role: "主背景色", hex: "#0F172A", name: "Deep Navy" },
    { role: "主要標題", hex: "#FFFFFF", name: "Pure White" },
    { role: "科技主色", hex: "#6366F1", name: "Indigo Primary" },
    { role: "視覺強調", hex: "#10B981", name: "Emerald Highlight" }
  ]);

  // 3. 完整 Markdown 報告渲染
  const markdownContainer = document.getElementById("full-report-markdown");
  markdownContainer.innerHTML = marked.parse(generatedReportMarkdown);

  lucide.createIcons();
}

// 提取 NBLM 提示詞區塊
function extractNblmPrompt(markdown) {
  if (markdown.includes("## 3. 📋 NotebookLM 專用簡報引導提示詞") || markdown.includes("NotebookLM 專用")) {
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
  // Fallback: 尋找第一個有 markdown 代碼區塊
  const firstBlock = markdown.match(/```(?:markdown)?([\s\S]*?)```/);
  return firstBlock ? firstBlock[1].trim() : markdown;
}

// 渲染色票卡片
function renderColorPalette(palette) {
  const container = document.getElementById("color-palette-container");
  container.innerHTML = "";

  palette.forEach(color => {
    const card = document.createElement("div");
    card.className = "group relative bg-surface-850 border border-slate-800 rounded-xl p-2.5 flex items-center gap-3 cursor-pointer hover:border-indigo-500 transition-all";
    card.title = "點擊複製 Hex 色碼";
    
    card.innerHTML = `
      <div class="w-8 h-8 rounded-lg shadow-inner border border-white/10 shrink-0" style="background-color: ${color.hex}"></div>
      <div class="min-w-0">
        <div class="text-[11px] font-medium text-slate-200 truncate">${color.role || color.name}</div>
        <div class="text-[10px] font-mono text-indigo-400 group-hover:text-indigo-300 flex items-center gap-1">
          <span>${color.hex}</span>
          <i data-lucide="copy" class="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity"></i>
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      navigator.clipboard.writeText(color.hex);
      showToast(`已複製色碼: ${color.hex}`, "success");
    });

    container.appendChild(card);
  });
}

// Fallback: 從文字中抓取 Hex 碼
function fallbackExtractMeta(markdown) {
  const hexMatches = markdown.match(/#[0-9a-fA-F]{6}/g) || ["#0F172A", "#FFFFFF", "#6366F1", "#10B981"];
  const uniqueHex = Array.from(new Set(hexMatches)).slice(0, 4);
  return {
    style_name: "簡報逆向分析報告",
    tags: ["視覺規範", "簡報架構", "色彩推導"],
    palette: uniqueHex.map((hex, idx) => ({
      role: idx === 0 ? "背景色" : idx === 1 ? "主文字" : idx === 2 ? "品牌色" : "強調色",
      hex: hex,
      name: "推導色"
    })),
    white_space_ratio: "約 70%"
  };
}

// === 6. Toast 提示通知 ===
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  const icon = document.getElementById("toast-icon");
  const text = document.getElementById("toast-text");

  text.textContent = message;

  if (type === "success") {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-950 border border-emerald-700 text-xs shadow-2xl text-emerald-200";
    icon.className = "w-4 h-4 text-emerald-400";
    icon.setAttribute("data-lucide", "check-circle");
  } else if (type === "warning" || type === "error") {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-red-950 border border-red-700 text-xs shadow-2xl text-red-200";
    icon.className = "w-4 h-4 text-red-400";
    icon.setAttribute("data-lucide", "alert-circle");
  } else {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-xs shadow-2xl text-white";
    icon.className = "w-4 h-4 text-indigo-400";
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
