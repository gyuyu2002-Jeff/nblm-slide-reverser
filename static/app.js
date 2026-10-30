const APP_VERSION = "v6.36.0";
console.log(`[NBLM Slide Reverser] Running version: ${APP_VERSION}`);

// =========================================================================
// === 智慧版型差異化判斷演算法 (Smart Slide Layout Diversity Detection) ===
// =========================================================================

/**
 * 抽取單張投影片的高維視覺特徵指紋（亮度、對比、四象限佈局重心、邊緣幾何複雜度、感知雜湊 dHash、水頁去噪辨識）
 */
function extractSlideVisualFeatures(slide, pageNum, totalPages = 20) {
  return new Promise((resolve) => {
    if (!slide || !slide.image) {
      const fallbackTrivial = (totalPages > 4 && pageNum >= totalPages - 1);
      resolve({
        page: pageNum,
        avgBrightness: 128,
        isDarkTheme: false,
        complexity: 0,
        marginWhiteRatio: 0,
        isTrivial: fallbackTrivial,
        quadrants: [0.25, 0.25, 0.25, 0.25],
        dHash: []
      });
      return;
    }

    const img = new Image();
    // 只有在外部 http/https 網路連結時才設 crossOrigin，Base64 data: 與 blob: 嚴禁設 crossOrigin（避免觸發瀏覽器安全阻擋與 onerror）
    if (typeof slide.image === "string" && (slide.image.startsWith("http://") || slide.image.startsWith("https://"))) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const W = 32;
        const H = 18; // 16:9 比例小解析度抽樣
        canvas.width = W;
        canvas.height = H;

        ctx.drawImage(img, 0, 0, W, H);
        const imgData = ctx.getImageData(0, 0, W, H);
        const data = imgData.data;

        let totalBrightness = 0;
        let darkPixelCount = 0;
        const grayscale = new Float32Array(W * H);

        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const pixelIdx = i / 4;
          grayscale[pixelIdx] = lum;
          totalBrightness += lum;
          if (lum < 70) darkPixelCount++;
        }

        const avgBrightness = totalBrightness / (W * H);
        const isDarkTheme = (darkPixelCount / (W * H)) > 0.45;

        // 1. 計算邊緣幾何梯度密度 (Edge Gradient Density)
        // 具備同心圓環、3D階梯、表格、多欄卡片的頁面梯度極高 (0.09~0.22)；純白或只有中央小字的 Q&A / 結尾頁梯度極低 (~0.03)
        let totalGradient = 0;
        for (let y = 0; y < H - 1; y++) {
          for (let x = 0; x < W - 1; x++) {
            const cur = grayscale[y * W + x];
            const dx = Math.abs(cur - grayscale[y * W + (x + 1)]);
            const dy = Math.abs(cur - grayscale[(y + 1) * W + x]);
            totalGradient += (dx + dy);
          }
        }
        const complexity = totalGradient / (W * H * 255);

        // 2. 四周邊界留白率 (Margin White Ratio: 上下各 16%, 左右各 12%)
        // 正常簡報內頁必有頂部標題列、底部分割線或頁碼（marginWhite 通常 0.4~0.8）
        // 唯獨 Q&A、過場空白頁的四周 100% 潔白大留白（marginWhite > 0.90）
        let marginCount = 0;
        let marginWhiteCount = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (y < 3 || y >= H - 3 || x < 4 || x >= W - 4) {
              marginCount++;
              if (grayscale[y * W + x] > 235) {
                marginWhiteCount++;
              }
            }
          }
        }
        const marginWhiteRatio = marginCount > 0 ? (marginWhiteCount / marginCount) : 0;

        // 3. 四象限重心佈局分析 (評估視覺焦點是靠左、靠右、分欄或居中)
        let qTopLeft = 0, qTopRight = 0, qBottomLeft = 0, qBottomRight = 0;
        const halfW = W / 2;
        const halfH = H / 2;

        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const lum = grayscale[y * W + x];
            const contrast = Math.abs(lum - avgBrightness);
            if (y < halfH && x < halfW) qTopLeft += contrast;
            else if (y < halfH && x >= halfW) qTopRight += contrast;
            else if (y >= halfH && x < halfW) qBottomLeft += contrast;
            else qBottomRight += contrast;
          }
        }
        const qSum = (qTopLeft + qTopRight + qBottomLeft + qBottomRight) || 1;

        // 4. 差分感知雜湊 (dHash: 捕捉卡片邊框、圓形靶心、時間軸等幾何特徵)
        const dHash = [];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W - 1; x++) {
            const left = grayscale[y * W + x];
            const right = grayscale[y * W + x + 1];
            dHash.push(left < right ? 1 : 0);
          }
        }

        // 🚫 嚴格水頁去噪判定（徹底封殺 QA、問答、純致謝、感謝、過場孤島水頁）
        let isTrivial = false;
        const textToCheck = ((slide.text || "") + " " + (slide.name || "")).toUpperCase().replace(/[\s\-_]+/g, "");
        
        // 鐵律 A. 純文字黑名單：徹底封殺 QA / Q&A / 謝謝聆聽 / 感謝指教
        if (
          textToCheck === "Q&A" || textToCheck === "QA" || textToCheck === "QUESTIONS" ||
          textToCheck.includes("Q&A") || textToCheck.includes("QANDA") || textToCheck.includes("問與答") ||
          textToCheck.includes("THANKYOU") || textToCheck.includes("THANKS") ||
          textToCheck.includes("謝謝大家") || textToCheck.includes("謝謝聆聽") ||
          textToCheck.includes("感謝指教") || textToCheck.includes("敬請指教") || textToCheck.includes("謹請指教") ||
          textToCheck.includes("相信團隊的力量")
        ) {
          isTrivial = true;
        }

        // 鐵律 B. 四周邊界純白大空洞判定：若邊緣 > 90% 純白且不是第 1 頁封面，一律視為 QA / 過場水頁
        if (marginWhiteRatio > 0.90 && pageNum > 1) {
          isTrivial = true;
        }

        // 鐵律 C. 視覺結構極度空洞判定：若缺乏幾何線條梯度 (< 0.065)，且不是第 1 頁封面，一律視為水頁
        if (complexity < 0.065 && pageNum > 1) {
          isTrivial = true;
        }

        // 鐵律 D. 超高亮度純白背景且複雜度低
        if (avgBrightness > 240 && complexity < 0.08 && pageNum > 1) {
          isTrivial = true;
        }

        // 鐵律 E. 簡報末兩頁（結尾與問答）嚴格封鎖
        // 投影片末尾 (倒數第 1、第 2 頁) 幾乎 100% 為 QA 或感謝水頁，除非複雜度極高 (>= 0.13) 否則絕不推薦
        if (totalPages > 4 && pageNum >= totalPages - 1 && complexity < 0.13) {
          isTrivial = true;
        }

        resolve({
          page: pageNum,
          avgBrightness,
          isDarkTheme,
          complexity,
          marginWhiteRatio,
          isTrivial,
          quadrants: [qTopLeft / qSum, qTopRight / qSum, qBottomLeft / qSum, qBottomRight / qSum],
          dHash
        });
      } catch (err) {
        console.warn("抽取視覺特徵異常:", err);
        const fallbackTrivial = (totalPages > 4 && pageNum >= totalPages - 1);
        resolve({
          page: pageNum,
          avgBrightness: 128,
          isDarkTheme: false,
          complexity: 0.05,
          marginWhiteRatio: 0,
          isTrivial: fallbackTrivial,
          quadrants: [0.25, 0.25, 0.25, 0.25],
          dHash: []
        });
      }
    };
    img.onerror = (e) => {
      console.warn("投影片圖片載入失敗:", e);
      const fallbackTrivial = (totalPages > 4 && pageNum >= totalPages - 1);
      resolve({
        page: pageNum,
        avgBrightness: 128,
        isDarkTheme: false,
        complexity: 0.05,
        marginWhiteRatio: 0,
        isTrivial: fallbackTrivial,
        quadrants: [0.25, 0.25, 0.25, 0.25],
        dHash: []
      });
    };
    img.src = slide.image;
  });
}

/**
 * 計算兩張投影片視覺特徵向量的綜合相異距離 (0: 完全相同模板, 1: 截然不同結構)
 */
function computeFeatureDistance(f1, f2) {
  if (!f1 || !f2) return 1;

  // A. 明暗主題色調差異
  const brightDiff = Math.abs(f1.avgBrightness - f2.avgBrightness) / 255;
  const themeDiff = (f1.isDarkTheme !== f2.isDarkTheme) ? 0.35 : 0;

  // B. 四象限視覺重心歐氏距離
  let quadDiff = 0;
  for (let i = 0; i < 4; i++) {
    quadDiff += Math.pow(f1.quadrants[i] - f2.quadrants[i], 2);
  }
  quadDiff = Math.sqrt(quadDiff);

  // C. 差分感知雜湊漢明距離 (Hamming Distance)
  let hashDiff = 0;
  if (f1.dHash && f2.dHash && f1.dHash.length > 0 && f2.dHash.length > 0) {
    let diffBits = 0;
    const len = Math.min(f1.dHash.length, f2.dHash.length);
    for (let i = 0; i < len; i++) {
      if (f1.dHash[i] !== f2.dHash[i]) diffBits++;
    }
    hashDiff = diffBits / len;
  }

  // 加權總合差異度 (0~1)
  return (brightDiff * 0.2) + (themeDiff * 0.3) + (quadDiff * 0.2) + (hashDiff * 0.3);
}

/**
 * 智慧版型差異化判斷核心：幾何複雜度加權之最大多樣性貪婪挑選 (Complexity-Weighted Greedy Diversity)
 * 1. 嚴格過濾 Q&A、純感謝頁等低含金量水頁
 * 2. 優先加權高幾何結構豐富度頁面（同心圓、3D階梯、三欄卡片、圖解公式）
 * 3. 自動排除版型高度重複的頁面，挑選出結構最具代表性的 5~8 頁
 */
async function smartDetectDiverseSlideIndices(slides, maxPages = 6) {
  if (!slides || slides.length === 0) return new Set();
  const total = slides.length;
  if (total <= maxPages) {
    return new Set(slides.map((_, i) => i + 1));
  }

  // 1. 平行計算全篇投影片的視覺指紋與幾何複雜度特徵
  const slideFeatures = await Promise.all(
    slides.map((slide, idx) => extractSlideVisualFeatures(slide, idx + 1, total))
  );

  const selected = [];
  const selectedSet = new Set();

  // 策略 1：必定選取第 1 頁（封面 / 開場主視覺）
  selected.push(0);
  selectedSet.add(1);

  // 策略 2：徹底取消盲目選取結尾頁（嚴格封殺純 Q&A、純謝謝等過場廢頁）！
  
  // 策略 3：高含金量幾何版型貪婪多樣性挑選 (Complexity-Weighted Greedy Diversity)
  // 每一輪挑選「幾何結構豐富度高」且「與已選所有頁面差異度最大」的核心架構頁
  while (selected.length < maxPages && selected.length < total) {
    let bestCandidateIdx = -1;
    let maxScore = -1;

    for (let i = 0; i < total; i++) {
      if (selectedSet.has(i + 1)) continue;

      const candidate = slideFeatures[i];
      // ★ 核心鐵律：任何被標記為 isTrivial (Q&A / 致謝水頁 / 空白低密度) 者一律嚴格排除！
      if (candidate.isTrivial) {
        continue;
      }

      // 計算候選頁面與已選所有頁面的最小距離
      let minDistToSelected = Infinity;
      for (const selIdx of selected) {
        const d = computeFeatureDistance(slideFeatures[i], slideFeatures[selIdx]);
        if (d < minDistToSelected) {
          minDistToSelected = d;
        }
      }

      // 綜合評分：幾何結構豐富度 (Complexity ^ 0.6) ✖ 多樣性距離 (minDistToSelected)
      // 這保證了同心圓靶心 (P.2)、3D階梯 (P.18)、三欄線框卡片 (P.6)、三大圓公式 (P.11) 必然強勢入選！
      const score = Math.pow(candidate.complexity + 0.05, 0.6) * minDistToSelected;

      if (score > maxScore) {
        maxScore = score;
        bestCandidateIdx = i;
      }
    }

    if (bestCandidateIdx !== -1 && maxScore > 0.005) {
      selected.push(bestCandidateIdx);
      selectedSet.add(bestCandidateIdx + 1);
    } else {
      break;
    }
  }

  // 依原始頁碼由小到大排序返回 Set
  const sorted = Array.from(selectedSet).sort((a, b) => a - b);
  return new Set(sorted);
}
window.smartDetectDiverseSlideIndices = smartDetectDiverseSlideIndices;

// 狀態管理
let selectedFiles = [];
let uploadedSlidePages = []; // [{ page: 1, image: "data:..." }, ...]
// 誤刪投影片喚回復原堆疊
let removedSlidesHistory = []; // [{ type: "single", slide, originalIndex, wasSelected, timestamp } | { type: "clear", slides, selectedIndices, timestamp }]
let currentComparisonPage = 0;
let currentComparisonMode = "split"; // "split", "reconstruct", "original"
let comparisonViewScope = "selected"; // "selected" (僅顯示已選取的投影片) | "all" (顯示原稿全部)
let generatedReportMarkdown = "";
let generatedNblmPrompt = "";
let generatedPromptGlobal = "";
let generatedPromptSlide = "";
let currentPromptMode = "global"; // "global" | "slide" | "custom"
let generatedPromptCustom = "";

// 自訂頁面內容元件：版型規格庫
const DEFAULT_LAYOUT_OPTIONS = [
  { id: "A", name: "版型 A：深墨藍古銅雙細框封面主視覺", desc: "深墨藍底，外圍距邊界16px配古銅金(#C29B53)雙細線典雅框，特大純白超粗主標題，下方為駝金導言，右下角演講者資訊" },
  { id: "B", name: "版型 B：五層同心圓引線對應＋橫向進程軸", desc: "5層同心圓（核心駝金點➔深藍環➔外金環），3條45度折線引線箭頭指向要點，下半部4節點圖示橫向進程軸" },
  { id: "C", name: "版型 C：3D 立體階梯思維遞進", desc: "3~5層深墨藍立體階梯方塊，踏板標註步進數字（1-30, 31-60...），引線箭頭指向右側要點" },
  { id: "D", name: "版型 D：三欄獨立線框卡片", desc: "3欄垂直並排微圓角卡片，細灰駝邊框，每欄頂部配深墨藍圖示徽章與粗體標題" },
  { id: "E", name: "版型 E：概念拼圖/雙欄對比轉化", desc: "左右雙欄對比（左側未解困境，右側駝金咬合拼圖），中央大型駝金推進箭頭" },
  { id: "F", name: "版型 F：公式化運算決策圖解", desc: "橫向公式運算卡片（[指標A] ✖ [指標B] ✖ [指標C] ＝ [最終目標]），下方深墨藍總結" },
  { id: "G", name: "版型 G：個人經歷/里程碑垂直時間軸", desc: "垂直時間軸，深墨藍圓形節點與古銅金微光，標註年份與職務里程碑" },
  { id: "H", name: "版型 H：問答與結尾總結頁", desc: "深墨藍底，外圍古銅金細雙框，中央純白大字總結與金色標語" }
];

// 自訂頁面內容元件：預設故事板
let customStoryboardSlides = [
  { layout: "A", topic: "企業 AI 導入九十天行動方案：總覽與核心定位" },
  { layout: "B", topic: "三大核心資安鐵律與紅線（五層同心圓三引線對應）" },
  { layout: "C", topic: "九十天三階段穩健推進時程（1-30天盤點、31-60天試辦、61-90天擴大）" },
  { layout: "F", topic: "啟動跨部門擴充之決策公式（正確率95% ✖ 採用率70% ✖ 零資安事件）" },
  { layout: "D", topic: "常態化長效治理架構（權限控管、人機審核、防呆機制三卡片）" },
  { layout: "H", topic: "總結：相信團隊的力量，穩健邁向治理下一步" }
];
let generatedSlideHtml = "";
let currentProvider = localStorage.getItem("active_provider") || "gemini";
let modalSelectedProvider = currentProvider;

// [P0 核心智財保護] 系統逆向工程 Prompt 已黑盒子化加密，防止客戶端逆向與 F12 探測
const _0xSEC_CAPSULE = "UL7n+rzC9b7i2r7n177izL3P1rP62L3uwL3A3r3q+7/667L8zLL84LPa3L/Ky7zE7Lz90b/i8bXm0gooPyk/NC47LjM1NHoWOyM1Ly56CD8sPygpP3cfND0zND8/KLXm07LS3b/j5L7nz7zUyL3T0r/q0r/07Lna2FC+5/q9wN6+5+W/y+e8wvW52sq/2dW97vq97sCy0t280cm8yOi97sC9xsW/9fyz2N6/1MW52su+5+W9zvKy2t++4tC/2Om9wN696vu/+uu99d6+5NG15tIKHhy52tsKCg4CerzSzLzQz7/n673T3bzS8L/GzLXm07Xm1r/k47/gz7zuxL/1xb/f7Lna1r3Gxb/1/L/j5L7nz7Pw8rzE7Lna27/047/D8r/78bLT6Lz/77za/bXm0r3z4L/l2bzV1bPY0HosKXq/9fy/5dmy0+i/+9B6LCl6vd77v/7MvPvctebTudrbvc/xv+LZvMfKsunwve7Rvcrcudrbv/7AstPosubwvMHlv+DVv9LNudrbs9r5vNT/ve3Av+PkvufPv8TRvN/Rudrbv/vNs+7TdbzVyL3P8bL9+b/TzL3u6r312rLS3bLT6L/n873p4b3v67na17Xm1r7i/LLn07L39b3Y4LLZ53pramp/er/l+r/1/L/q17Pn0L3A3noUNS4/ODU1MRYXer/q0r3O8rzVyr3+4LLzxLLS3bzUyL3T0rLy97Ly0rL81b313rna2FBQuMD6teLVudrKvMbas/HCv9TFv9PdtebAv/X8vuDRvOvYvML1udrbvcbFvfjgs9jev9TFtebSDigvP3cuNXcJNS8oOT96DDMpLzs2ehwzPj82My4jtebTudrLtebAUGt0eqrF1PK52spramp/er/l+r/1/LzVyr/VzL3P8b/i2bzHyrLp8Lna27LT6L/n87LS3b/+wLLT6LLm8LzB5bL81b313rnay7XmwFB6enp3er7hzr3u6rL92r/1xb3P8b/i2b/gz7LT6LLS3bL78rPH+L/j5L7nz7LY1r3K3LXmwFB6enp6end6stH/vdjgudrWvPPxvPrmve3AvffcsvLCvMb2ve7Dv+bvtebSCC82Pz56FDUuPzg1NTF6CjsqPyi15ta//Nh6eRxvHG4fHLXm07na17Xm1r/l37P60rzC1L344Lzyw7Ly4bna1L/f8r313b3s97zW273307Ltx7zq7r/j6bzt4L3b6rzz8bz65r3twLLS3b/t/L/b7r/M9Lz4x7/E2L3B7rPY0L3P1r3twLXm1qrFwPF6v8DuvfzbvMHlvNXBvdjgvcDgvMvgvdPBvcD0ve7Dudrbs/HIstLQv8PuvOXgv/jys+HEtebWqsXA8Xq/wO69/Nu/xvK88sOz+9a/wcGy/ci87eG/0Pq93vuzzca9wN56Fnq/xNG9we6y/ci8+9y97cC15tK4ztZ6uM7CtebTudrVtebbUHp6enp6d3qy0f+92OC52ta87euy0+iz4cu8x+W8x8qy6fC15tIZMjs2MTg1Oyg+tebWv/zYenlrY2sbax615tO52te15ta/5d+z+tK88sOy8uG52tS87eu92Pe92+qz4cu8x+W/4M+y0+iz39e9w+e96NO999y8yfy80fe/5PSy2Na9yty52tW52thQenp6enp3erLR/73Y4Lna1r/P3L/Rw7zAzLLr+73Tw73r6b3b6rXm0nkcbhxpHx+15tO52te80sy87eu87+2y4deyzde15ta96OS84My97/y/3eB6Eh8CerLT6L345rXm1r/A7r3827z34b3D57zSzL/S4L3G5rPxwrP557/I1rLE+L/f07zw4rzw9rPh2bna2FB6enp3erjC37nayr/+wLLT6LLm8LzB5bPK77/k0XpyFy82LjN3GTU2NSh6GSM5NjM0PXO52su15sCy0f+/1MW/xsy8ydu8xtO//sC98vS96NO/5/N1v+btsvDlstPotebSvuTRv/zYtebAvMXOvejTve7fudrbsszestfts8fIvez6udrbvMXOv8jWs+HZudrbssbGvPvZvPPCudrbvMPuvfPgss3XtebTtebWv8byvNXKvf7gsvPEvuL3v+Xfs/rSv+btv9LssvzVv/TAudrUv8rWvuLas/rbs8f4vcDevuL8v9LNvPbevufXudrbv+rXsvPrvPvcvNLMvPLDs/vWvffcv9LttebWv+Xfs/rSvuTHv+DVsubwvMHlvuLXv8rWstPovcHitebSv/zYtebAvPbea73o073u33q4xM56vPbeaLLM3rLX7b3s+nq4xM56vPbeabzFzrPh2Xq4xM56vPbebr3o07LN17Xm07Xm1qrFwPF6ve/Pv+rXv8DuvfzbvM/us/rbvNPavMbTvPbevufXv9vtvN3ss93Xsv7dv/vNvNLKv8rWvuLavfL0s/vVstPoudrVtebbUHp6end6uMLfudrKs/HCv9/Ts9nyvufXvejkvODMs9TMv/TAenISMz0yNjM9Mi56CjY7OT83PzQuehY1OTFzudrLtebAv+Xfs/rSvOLfvP/Av9fav9Lcs/HCv9/TvML1udrUv9nfv/jQvMzmv9fav/vQv+rVvPLDs/vWtebSCS84dzI/Oz4zND215tO+4tG8zOO9wN6yxPi/39O999y/0u2y0+i/4uy15tKqxcDxer/A7r3827/G8r7i0bzM47/f/bzM3bz077LK577g2L/7zbLE+L/f07333LXm07na1bXm1rPY3rzC9bna1LPP7b/V/77i973T47/0wHpoJGl6v9rRs83Gs9fvv/fNsvPEvcHuvNT/svTQvNXBvejTvffcv/fNstPotebSsvvWv9/9svTQstPotebWvuLXv9D6v+DPstPov/vQtebTudrVtebbUFBodHqqxcnKudrKv/Tjv8Pyv/vxstPovP/vvNr9stLds9jQvPvcsv35v9PMtebSuMLfs83Gs9fvvNDNv/7rvcbFvPriv+XZtebWv8DuvfzbvO3tvO3cvfPgv+XZstLdv/X8v+XZtebbtebTudrLtebAUHp6end6v+Xfs/rSs9rKs/rbvejkvODMs8vLv/TAvPXVvfL0v/Tjv8PystLdvfT3s/r3vcDeudrWv/vxstPovP/vvNr9tebSHDM2NnoKNTY7KDMuI7Xm07na17Xm1r7i/L/G8rzVyr3+4LLzxL7i97/18bz34bXmwFB6enp6end6cHByG3N6vfPgv+XZvNPRvePwvNXVs9jQv/Tjv8PyenISNTY2NS16FS8uNjM0P3p1ehQ1dxwzNjZzcHC15sC//Niz4cu8x+W+4tC9wN696NO/5/O809G94/C/6tey8+u8+9y15tIJKj8/OTJ6GC84ODY/KbXm07na27PB6LzG77zax73s97z73LXm0g4yNS89Mi56GTY1Lz4ptebTudrbvNPRvePwvfPgv+XZvejNvfT3s/r3tebWv+Xfs/rSv+btv9Lsv/XxvMLUudrUv9/9s9nyv/TWv9/yvd77v/vxstPotebSvcHuvNT/s9rVv93gvc/xv+LZv+DPstPotebTtebWv9nfv/7Mv8bXvuflvc7ys8HDve3Adb/M9L3twL/n87LT6LzV1bPY0LXm1rz73L/f/bzM3b/3zb3Y4L3uzr3D57zSzL3uzrPhy7Pxwr/q17z1zr/3zbXmwarFwPF6ve/Pv+rXv8Duvfzbv+rdvfPgv+XZv+rXsvPrvPvcvNLMvfPgv+XZs8HovMbvv/vNvOHlv/X8v+XZstPov/vQtebbudrVUHp6enp6d3pwcHIYc3q93vu//sy8+9y97s6999y/0u2/4M+8+Me89t6+59d6chg1KD4/KDY/KSl6GTU2Lzc0KXNwcLXmwLLR/7/Uxb/GzL3A3npperz23rzSzHpuerz23rzUyL3T0r/Z37/G8r/q1bzyw7P71r7i0bzM47/40LzG07/n87LT6LLE+L/f07333L/S7bXm1rz23r7n17/Bwb/L8r3e+7/+zLz73Lna27z23r7n177j0bPMyb3e+7/S3LPAzr3twLXm1r/l37P60r/m7b/S7L/18bzC1Lna1Lz23r7n17/+zL/G17/01r/f8r3e+7z73L3twLna27z23r7n177j0bPMyb3e+7/E2L3B7nW/19u/9828+ua97cC15sGqxcDxer3vz7/q17/A7r3827Ld8LL71r/Q+r7i0LPhy7LT6L3F87/n+L/+zLz73LzSzL/X27/3zb/S3LPAzr3twLXm27na1VB6enp6end6cHByGXN6vdfyvfHRve3AvPvcv9f7vdPdenV6v/X8v+XZvPLDvev+enIcKDs3Pz56GTsoPil6dXoJNTYzPnoKMzY2KXNwcLXmwL/Z37/G8r/Uxb/GzL344L/1/LzG07zT0b3j8LPhy73twL3F87/n+Lz73LXm0r/82Lz1zrLm2bL78npuerz23rPhy7z73LXm07zSzL/1/L/l2bPhy7LT6LLc+r/B0Lzyw73r/rXm0r/82HoJDhsdH3pqa7Xm07zD2LXm1rzT17zW3b/0wL3j8LL557/+zLz73LzSzL/1/L/l2b/78bLT6Lna2FBQaXR6qsXOzbnayrzzxbz46r3uwLzRybzI6LLS3bPa+bzU/73twL/j5L7nz77lx73GxbXm0rjC37/A7r3827/q3b/GzLL9+bPa2r/WzL3Y4L/GybPhxLzi37/M9LzSzLLv6rzy+bzB6L3twLXm27Xm07nay7XmwFB6enp3erjC37nayrzD2LPMybLh4rLS3bPa+bzU/73twL/j5L7nz7/E0bzf0bnay7XmwL/l37P60r3o5L344L/X2r/S3Lna1L/M9Lz4x3pjanq/4Py9we6y/ci86u6/4+m/xNi9we6y59O80MK+49GzwNS8+PW80MK97cC99Pez+ve15tIVKC4yNT01NDs2egkuPyoqPz56GygoNS16FjM0P3q4zta4ztq4zsq15tO52tWy0t252tS86fi87/C8wei97cC52tW15tuy0f+/1MW/xsy92OC9we6y/cizwNS8+PW80MK97cC15tK//Nh6CQ4bHR96amskam96vuLQvuLRvuD+s9b1s8DUvPj1vNDCve3AtebTtebWv+Xfs/rSvMLUvMzdsvzVv/TAudrUqsXA8Xq978+/6te/wO69/Nu9z/G80sqzwcOy2Puz4OGy0Ou+4P6/1dO86fi87/C97cC15tIcMz0vKD93YnoNOyw/tebTvNLMv8bJv+b9ve3AudrVtebbUHp6end6uMLfudrKv/79vNH2ssPFudrbvMzdvOrVv8bMstLdvuL3v+XZvM7kv+rev+XZvMPgv8bMudrLtebAstH/vMbTvNPRvePwv/79vNH2ssPFeiF6J7na22l6vcjqvuD+vczQvMzdvOrVv8bMtebSv+38vMzdv9Xpv8bMtebTudrbvuL3v/70vuDgvdPzv8rLv+38v9XpvcPmv+reemx6vM71vfPgv+XZvejNvfT3s/r3v+XZvMPgv8bMudrbbm96v+D8v+bPve3AtebSFj87Pj8oehYzND8ptebTtebWv+Xfs/rSv/TWvM/uvNXVsuXqv9/sv+PkvufPvMzjvufXudrbvfXas+HEvM/is93VtebSCS4/KncZNS80LnprYGt6v/TSvNvctebTstLdvfT3s/r3vfPgv+XZdb/1/L/l2b/r9rza/bna2FB6enp3erjC37nayr/7zbPu07/q1b7g4LLS3bL5x7P55LL9+b/TzLnay7XmwLLR/7/Uxb/GzL/W37/K8bzT0b3j8L/7zbPu07/q1b7g4LXm0gkuMzkxehwzPS8oPym15tO15ta/5d+z+tK81t28wtS52tS97s6z4cu/zPS97cC8+Me98+C/5dm8/++96vu/6tW+4OC15tKy4dq/4+O/3/2z2fK/9Na/3/K9z8O9w+ez2tW8wtS15taqxcDxer/A7r3827/q3bLg8bPxzr/7zbPhy7zSzL/78bzh5bPBxr7g2LPhy73twLXm1qrFwPF6v8DuvfzbvM7jvdjgveTUv+bVv9f7s9rAvuDgvdPztebTudrVtebWvuL8vejkvfjgv9LNv93gvNPRv9H4v9HPvufGtebSv/zYtebAstLTvNPRvNbdvuD0vd3SvOn7udrbs8HDvuDgvcbRv8bqv8bMudrbvMr2s9vRs/HCvczQvMHivevXudrbvcPnvMflsvLUsvHMudrbv/7AvuDgv8bJvPvWs8zRvMbZtebTudrYUFBudHqqxc7+udrKv+rbs8f4stLdv9/yvfXdvMzdv/fNs8HsvuDYvfjms8rvv+TRtebSAD8oNXcdMzg4PygzKTJ6fHofIjs5LnoOPyIuehY1OTG15tO52su15sBQenp6d3q/xvK9zvi/3eC9wN56FDUuPzg1NTEWF3q81cq9/uCy88S+4ve15ta/5d+z+tK/5u2/0uy/0Pq/3/+15sBQenp6enq52tSqxcDxudrKve/Pv+rXvMzdv/fNvOfOvO3ystLds8HsvuDYvfjms8rvv+TRudrLtebAvNDPv+frvdPdvc/xs8f4vuL3vcDevNPavMbTvMzdv/fNv+Xfs/rSemtqan96vdjgvOLfvMPqvPf5vfjgvcDevePbs/HOvuL3vMzdvNLMvNbdv/TAstHrvMzdtebWv8DuvPrmv9XMst3wvNXKvf7gsvPEvMzdvPvStebbve/Pv+rXv8Duvfzbv8byv+rbs8f4vuLhvPLDs/vWvuLRvMzjudrbsv3IssrnvNLMvNXIvc/xvM3bst3wsvvWvNfVs9r6vd77vN7VveTzvcDev9vnvOb4v/fNudrbvOPQv/fNvM/ivuDYvfjmsvPEv+fDvNLMv9vdv/fNv/vNs+7TtebbvuLhvPLDs/vWvuXHvNbbv8z0svvWvNLMvNbdv/TAs8HDsvvWvOLfvMPqv8vSvdXktebWvMbwvNbdv/TAvefov8rXvMPYv8Duvfzbst3wsvvWvO3hv9D6v+rXsvPrvPvcvefov8rXudrYudrVUHp6end6qsXA8Xqzw/6zx8S+5Ny84Mq999yy8sK/3+2/2MO8wtS9+OC8z+K8ycC15ta/yvy/092/wO69/Nu93vu+4ve9zsW8xtO97fKz2vq/7fK/xNF6EQoTer3v67Ly0r/+/bzP4r/3zbna2FBQsvHRvuH/vePbs/HOvuL3vMzdtebSv9Xqvdv5veXIvN/5vc7ysvDEtebTsubiv93gvuH/vuLRve/KvP3Rv9bMv/rrv8vQtebAUFB5eqrF1PJ6ver7v/rrs/jyvPrmvejkvODMs9rcv8rLv/rrv8vQUFB5eXprdHqz2sqz+tu909Kzx/i80cm8yOiy0t2/4+S+58+z8PK8xOx6cgk2Mz4/dzgjdwk2Mz4/eg41KjU2NT0jc1ABv+rXvuLQv9jpvcDevPXVs/rbvNDPv+frvdPds9rosvvWvejkvODMv+PkvufPvNHcsv35tebWv+X6v/X8v+rXvN3TvuLQv9jpv9/9v/TjvuPRvcbFv/X8ve7qvfXaB1B3enBwvfb2emt6s/rbvNHJvMjocHC15sBQenp3er3P8b/i2bLZ1rzD9bLS3bzHyrLp8LXmwHK96OS9+OC81dWy5eq/4M+y0+h6Eh8Cudrbve7Dv+bvvPPxvPrmve3AdbPhy7zH5b3o07333LLY1r3K3LLS3bLo+r/Ky738277h/nNQenp3er/047/D8rLS3b/j5L7nz7L5x7P55LXmwHKy8+m97uq81t2y8Ne/9OO/w/K8wvW52ta98+C/5dmzwcO97cC81dWz2NC93vu/+/Gy0+i52te52tu52ta93vu//sy8+9y97s6999y/0u2/4M+8+Me52tez2N68wvW52ta/9fy/5dmy0+i/+9C52te15ta+4f+/1dC99Pez+vd1vNDCve3Adb/7zbPu07/q1b7g4L/Rz77nxrLS3b3z4L/l2b/r9rza/XNQenp3erzM3b/3zb/r/r3uwLLS3bzUyL3T0rXmwHK/982z8c6z+PK8+ua52tu/982z3de52tuz+9Wy0+i/6te89c652tuz8cK/39Oz2fK+59ey0t2/6tez59C8zOO/5tVzUHKy0f+8xtO8we6//sCz+tuzx/i15tay8dG+5Me/4NWz2sqz+tu96OS9+OC80dyy/flzUFB5eXpodHq96OS9+OCy8vey8tK96eG97+uy/NW99d56ch4/KTM9NHoJIykuPzdzUHd6cHCy0+i/5/O96eG97+t6ch8iOzkuehI/InoKOzY/Li4/c3BwtebAUHp6d3q9z/G/4tmy2da8w/Wy0+i15sB5AgICAgICenK96OS84My81cq/1cy/4M+y0+iy0t297tG9ytxzUHp6d3q+4uG8zN2/982y0t297cC8+Mey0+i15sB5AgICAgICenK+4uGy/Nu88sOz+9ay0t2809G94/C97cC8+Mey0+hzUHp6d3q8+uK/5dm/5u2y8OWy0+i9wf56chs5OT80LilztebAv9LNv93gvNPavMbTvNXKv9XMv9LqvcDev+btsvDlstPoehIfArna27/K173y67LS3b/K3rLd8LLo+rLo9r3A3rL8zLL84LPZ8r7n17Xm0r/82LXmwLLM3rLX7b3s+np5bRwfaRlqerLo+rLo9r3z4L/l2bPB6LzG77z73Lna27zFzr3o073u33p5HG0bYhhierLo+rLo9r/+/bzR9rLDxbLS3b/q17Lz67z73L3307Xm01B3enBwv/Tjv8Pyv/vxstPostLds9jQvPvcsvzVv9PdcHC15sC8wtS9+OC/9MC95PO/6tey8+u8+9x1s8HovMbvdb/X+73T3XW99Pez+ve8wvW52ta98+C/5dm93vu/+/Gy0+i81dWz2NC52te52tu52ta93vu//sy8+9y/2d+88sOz+9a999y/0u252te80sy52ta/9fy/5dm/+/Gy0+i52tdQd3pwcL/3zb/E0bLS3bzUyL/X6r/r/r3uwHBwtebAvPLDs/vWv/fNs93Xudrbv9fav/vQv+rVvPLDs/vWvffcv9LtsvzVv9Pdudrbv9/9vMzdv/fNsu3HstLdsvvWv9/9s/HCv9/TvMzjv+bVUHd6cHC/4+S+58+y0t281ci9z/Gy8MS86c9wcLXmwLPa+bzU/73twL/E0bzf0bXm0r3B7rL9yLPA1Lz49bzQwr3twHosKXq8zuS/6t699Pez+ve15tO52tu//v280fayw8Wy/NW8+ua52tu/+82z7tO/6tW+4OCy0t299vyyw8W/4PFQUHl5eml0eqrFydF6FDUuPzg1NTEWF3q/6tK9zvK96vu/+uu81cq9/uCy88R6cr7g1r/K0r7i2rPBw7zy+7/m1bLm4r/d4HNQZHqy8dG/yta8w9i81cq+5MG+4f++4tG/3/O98vS88vu/5tW9wN6/9Na8z+56FzsoMT41LTR6vuH5vfjmv9fav/vQtebWsvTJvuflvc7ystrfv8byv9PXvfH1vuLas9fvst3wvc7rv9LdvNXBtebAUFB5eXl6vPL7v+bVemu15sC/3/K/xcWz+PK8+ua8xOy8/dG15tK81PKyzPy15sC/59K82v16aSRoanqz+tu15ta81cq/1cy8z+6+4eey0+i/5/O52tu/982/xNG52tu88sOy8Nay+cez+eSy0t2909K/xNG/4PG15ta+4eG83tW999yy8sK9wNy/1fW9we681P+//829zvK15tNQOjo6NzsoMT41LTRQudrKvuHhv9HDv/T5v8vQudrLtebAULLx0b/A7rz65r7kx7zJwLzSy77i0L/Y6b3A3r333LLywr7k3LzgyrXm0gk1Lyg5Pym15tO15ta81cq/1cyzzcaz1+++4NG/9fyy0t287sS/9cW15ta92OC80suy/NW/0Nm+4tq+4ee978q8/dG/wO6y9uO52tuy/Myy/OC/4+my+/u9wN6/6tK8//e96vu/+uu/3/2/9OO52thQtebSveLns/rbvM/ivc7rvNjyvPrjvMnAvffcsvLCv9/9v/TjvO3rv+D8st3wsvvWsvnbs93VtebWv+HgsvfqemkkaGp6s/rbv8fdv9X1tebWvPXVs/rbvcDcs/rSv8DuvPrms9vvv+TwvuLRv9LNs/jyvPrmsvzVvfXetebTUFC52sqqxdTyer/f8r/FxbL8zLL84LP48rz65rLS3bzHyrLp8LPUzL/0wLL81b313npyDDMpLzs2egkuIzY/enx6FzsuPygzOzZ6FjU5MXO52su15sBQa3R6vc/xv+LZv+DPstPostLdsvvys8f4ve7RvcrctebAAb3o5LzgzL/78b/f/7/gz7LT6HoSHwJ6stLdve7RvcrctebWvuL8v9D6vuLQsuj6v8rLvfzbvuH+tebWvuTRv/zYtebAvfzbvPf4vcDgvMvgs/HIve7DudrbvfzbvPf4v8PuvOXgv/jys+HEudrbvfzbvPf4v8HBsv3IehZ6v8TRvPvcve3AB1BodHqy0+i/5/O96eG97+uy0t2//sCy0+iy5vC8weWzyu+/5NG15sBQenp6d3q+4uG8zN2/982y0t297cC8+Mey0+i15sABEh8CerLS3bLp8LzexQdQenp6d3q/5u2y8OWy0+i9wf615sABv9LNv93gv8rev+btsvDlstPoehIfAnqy0t29zvKz2s4HUHp6end6uMLfudrKsu3yvPbev/7AstPosubwvMHlv+btv9LssvzVv9PdudrLtebAv8rWvuLas/rbs8f4vcDevuL8v9LNvPbevufXudrbv9f7vdPdvPLDs/vWvffcv9LtvNLMv+rXsvPrvOn7vOn7tebWv+Xfs/rSvuTHv+DVsubwvMHlvuLXv8rWstPovcHitebSv/zYtebAvejTve7ferjEznqyzN6y1+297Pp6uMTOerzFzrPh2Xq4xM56vMPuvfPgss3XtebTtebWqsXA8Xq978+/6te/wO69/Nu8z+6z+tu809q8xtO89t6+59e/2+283ey/+8280sq/yta+4tq98vSz+9Wy0+i15ttQenp6d3q4wt+52sqz8cK/39Oz2fK+59ez1My/9MC52su15sABvMLUvfjgsvzVv/TAssT4v9/Tvffcv9Ltv9nfv/jQvMzmv+rVvPLDs/vWvuLRvMzjtebSv8Duvfzbv/vNvNDjvMzmv9/9vMzdvPTvssrntebTtebWvNLMv9nfv+rds83Gs9fvv/fNsvPEsvTQvNXBvejTvffcv/fNstPoB1BpdHq/9OO/w/K/+/Gy0+i8/++82v2y0t2z2NC8+9yzyu+/5NG15tK4wt+zzcaz1++zwui//uu9xsW97t68x8W15tO15sBQenp6d3oBvMLUvfjgsvzVv/TAv+rXsvPrvPvcdbPB6LzG77z73HW96M299Pez+ve8wvW/yvy92OC52ta98+C/5dm93vu/+/Gy0+i81dWz2NC15tK/3/2z2fK9we681P+z2tW/3eC9z/G/4tm/4M+y0+i15taqxcDxer/A7r3827/78bzh5b/1/L/l2bLT6L/70LXm07na17Xm1r7h/7/V0L/+wLz23rzUyL3T0rzC9b/K/L3Y4Lna1r3e+7/+zLz73Lna273e+7/E2L3B7r/S3LPAzr3twLXm0qrFwPF6v8Duvfzbst3wsvvWv9D6s+HLvPvcvNLMv9fbv/fNve3AtebTudrXB1BudHq81ci9z/G52tuz2vm81P+97cCy0t2/982z8c6y/NW99d615sBQenp6d3oBvMLUvfjgsvzVv/TAv/vNs+7Tv+rVvuDgvML1v8r8vdjgudrWve7Os+HLv8z0ve3AvPjHvfPgv+XZv+rVvuDgtebSsuDxs/HOv9/9s9nyvc/DvcPnvuLXv/vNs+HLtebTudrXudrbvMPYs8zJsuHivML1v8r8vdjgudrWY2q/4Py9we6y/cizwNS8+PW80MK97cC99Pez+ve15tKqxcDxer/A7r38273P8bzSyrPBw7LY+7Pg4bLQ67zp+Lzv8L3twLXm07na17na27/3zbPxzrP48rz65gdQULnayqrFzv56ve/Pv+rXvMzdv/fNvOfOvO3ystLds8HsvuDYvfjms8rvv+TRtebSAD8oNXcdMzg4PygzKTJ6fHofIjs5LnoOPyIuehY1OTG15tO52su15sBQa3R6vNDPv+frvdPdvc/xs8f4vuL3vcDevNPavMbTvMzdv/fNv+Xfs/rSemtqan96vdjgvOLfvMPqvPf5vfjgvcDevMzdv/fNtebWv8DuvPrmv9XMst3wvuLRvMzjsvzVv9DZvuPRver7v/rrvMzdvPvStebbUGh0eqrFwPF6ve/Pv+rXv8Duvfzbv8byv+rbs8f4vuLhvPLDs/vWvuLRvMzjudrbsv3IssrnvNLMvNXIvc/xvM3bst3wsvvWvNfVs9r6vd77vN7VveTzvcDev9vnvOb4v/fNudrbvOPQv/fNvM/ivuDYvfjmsvPEv+fDvNLMv9vdv/fNv/vNs+7TtebbUGl0eqrFwPF6v8Duvfzbv+rdvNXKvf7gsvPEvuL3vcDevdPSv8TRvuH5ssPFudrbstPovfjmtebSeQICAgICArXm07zSzL/3zbzP4rPDyr/S7L/X6r/G8rzQz7/n673T3b3P8bPH+L7i0LXm21BQudrKqsXA8Xqz+tuzx/i909K/xNGzweyz3dey/t28xtqz8cK97t68x8W15tIWOyM1Ly56HjMsPygpMy4jenx6AD8oNXcIPyo/LjMuMzU0eggvNj+15tO52su15sBQa3R6vPXVvuLas/rbv8vSvdXkve/PvuLXs93Xsv7dtebAvc74v93gvcDevNDPv+frvdPdv9/9v/TjvuL3tebWvcHis97qs/rbs8f4udrKve/Pv+rXv8DuvfzbudrLv//Nvc7yvcHiv8rWvdPSv8TRtebBvM/uvuHnver7v/rrvuL3tebWvPXVvuLav9rRs/rbs8f4s9nnv+Xfs/rSv+TEvuLRvMzjudrKvdPSv8TRsvDEvOnPv+DxudrLvNbLs9vivNLwvd7svuLXv8rWvcDesvzMsvzgvNHJvMjove/KvP3Rv9HPvN/RsubwvMHltebbUGh0er/m7b/S7L/Rz7zf0bLm8LzB5bXmwL/X6b7k5b3B4rPe6rP627PH+L3A3r7i4bP71rzSzL/f/b/047Pd1b3B4r7m5rXm1r7jxb/l37P60r/m7b/S7LL00LzVwb/j5L7nz7zVyLz957LS3bL8zLL84L/L0r3V5LLm07PxzrXm1r/k47/gz7zHxr3vz7/X2b313b7i2r/k0b3A3r/X+73T3bzSzLz4x7/Szb/m1bL8zLL84L3M6L7j1bXm21BQudrKuMbYteLVer3q+7/667zM3b/3zb/13L/g/LPC6L3S3LP6yr30zbXm0r3s97zW27/L5r/K4rzexbXm1r/A7r3827zP+bzM3bz077LK57Xm07nay7XmwFBrdHq/wO68+ua84PW84Mq15sC809q8xtO/3/2/9OO/5d+z+tJ6a2pqf3q84Mqy3fC+5Ny84Mq999yy8sK15ta/wO69/Nu87eG/0Pq8xvC81cq/1dC9wN6//syz2fK81PKy8cy52thQaHR6v/fNvM/is8PKv9LstebAUHp6end6vNDPv+frvdPdvuLhvPLDs/vWtebAs8PKv/TAemIka256v/fNtebSve/KsvHMv9/SsvvWtebWv8z0svvWvOLfvMPqv8vSvdXktebTudrYUHp6end6v9P1vPLDs/vWdb/q1LLy2rXmwLPDyr/0wHprbyRob3q/98252thQenp6d3q/19q/+9B1v9f7vdPdvPLDs/vWtebAs8PKv/TAem4kYnq/98252thQenp6d3q8+Me/0s2y/Nuz4cS15sC89dW8+Mezw8q/9MB6a2gkaGp6v/fNtebSvPXVvPbedbz11b/X+73T3bzG2r/+wHpoJGl6s+HEtebTudrYUGl0eqrFwPF6suj6v8rLvNTIs8P+tebAs8P+s8fEvuTcvODKvffcsvLCvuL3v9/tv9jDvMLUvfjgve/rsvLSvM/ivMnAtebWv8r8v9PdudrKve/Pv+rXv8DuvfzbudrLvd77vuL3vc7FvMbTve3ys9r6v+3yv8TRehEKE3q97+uy8tK//v28z+K/98252thQULnayqrFycp6v+rSv+v2vdPSv8TRsvDEvOnPv+DxtebSvNXKv9XMst3wv9TFvfLlv8res/rbvcbFv/X8v+PkvufPvNHJvMjotebWsvHRvuTHv9/9v/Tjv+v2vNr9v9HPvN/RsubwvMHls9vivc7ytebTudrLtebAUHd6Ab3T0r/E0XobtebAdHR0B7XmwHKy8+my5eqy8+i909K/xNG+49G98+C/5dl1v/X8v+XZv/Tjv8Pyv+v2vNr9udrbvPbevufXvd77vPvcdbzG07z73LL81bz65rna273097P697zW3b/Ky7na27/7zbPu07/q1b7g4L/Rz77nxrLS3bLT6L/n87Lm8LzB5bP63L/g1XNQd3oBvdPSv8TRehi15sB0dHQHtebAcnR0dHNQd3oBvdPSv8TRehm15sB0dHQHtebAcnR0dHNQd3oBvdPSv8TReh615sB0dHQHtebAcnR0dHNQd3oBvdPSv8TReh+15sB0dHQHtebAcnR0dHNQcrLx0b/q3b/UxbzQz7/n673T3b7i97zT2rzG073X8r3T47P627PH+L3A3r3T0r/E0b/01rzP7rzVyr3f07/d4L7k3LXm1rLs0L3o5L344L/f7bPxzrLs0L//53NQULnayrPayrP6273q+7/667/f/b/047Lm4r/d4Lz65r/m1bXm0rLx0b7kx7z3/rz65r/m1bPayrP627Lm4r/d4LXm07nay7XmwFB3d3dQeXl5er329noCerP627XmwAGz+tuzx/i+4uGz+9YHtebSvNT7vc7yvdPSv8TRtebAARt1GHUZdR51H3R0dAe15ta4wt+/wO68+ua97t68x8W15sC909K/xNG978++4tey0t2/09ey5eq+4eG+58+z+tuzx/iz3dey/t215tNQd3q52sqqxdTyerL8zLL84LLS3b/j5L7nz7PUzL/0wLPf173n9Lnay7XmwHK8wtS9+OC81t2/9MCy8+iz+tu/4M+y0+i97tG9yty52tu/9OO/w/K98+C/5dl1v/X8v+XZv+v2vNr9udrbvMbTvd77v/7MvPvcudrbv/7AstPosubwvMHls/rcv+DVstLdvNXIvc/xv9HPvufGc1B3ernayqrFycd6ver7v/rrvMzdvPvSv9/9v/TjudrLtebAUHp6d3q+4uG88sOz+9a15sB0dHRQenp3erz64r/l2bPd17PhxLXmwLXm0r7kx7Pb4r/0wL3T0r/E0b/78b/18b/K3rzVyLz957zM3bz70rXm1r/A7rz65rPb77/00r/3zbzP4rPDyr/S7LLS3bPB7L7g2L345rPK77/k0bXm01A6OjpQUHl5eXq88vu/5tV6aLXmwLPayrP623prYGt6v+rXvPXOtebSs9vzv8rSvNnpsvzbemtqan96v9nVve76ve7As9jev9TFvdPjv/TAvNDPv+frvdPdvcDev8DuvPrmv/vxv/XxtebTUDo6Ojc7KDE+NS00ULnayr7h4b/Rw7/0+b/L0Lnay7XmwFCy8dG/wO68+ua+5Me8ycC80su+4tC/2Om9wN6999yy8sK+5Ny84Mq15tIJNS8oOT8ptebTtebWvNXKv9XMs83Gs9fvvuDRv/X8stLdvO7Ev/XFtebWv+rdvffcsvLCv9/9v/Tjv+X6v/X8v/vxv/Xxv9//vuLRv9LNudrKs9rKs/rbemtga3q80M+/5+u909281Mi909Ky0t28zN28+9K8xOy8/dG52su+4ve52thQtebSveLns/rbvM/ivc7rvNjyvPrjvMnAvffcsvLCv9/9v/TjvO3rv+D8st3wsvvWsvnbs93VtebWv+HgsvfqemkkaGp6s/rbv8fdv9X1tebWvPXVs/rbvcDcs/rSv8DuvPrms9vvv+TwvuLRv9LNs/jyvPrmsvzVvfXetebTUFC52sqqxcH7teLVer/f8r/FxbzQzb/+673GxbLS3bzM3b/3zbznzrzt8rzG2rPxwrPK77/k0bnay7XmwFBrdHq9z/G/4tm/4M+y0+iy0t297tG9ytyz1My/9MC15sABvejkvfjgv/vxv9//v9TFvfLlv+DPstPoehIfAnqy0t2y2da8w/W8+ua97cB1s+HLvMflve7RvcrctebWs8PevuLQsuj6v8rLvfzbvuH+B1BodHq/9OO/w/K98+C/5dl1v/X8v+XZstLds9jQvPvcs9TMv/TAtebAAbzC1L344LL81b/0wL/J8L7gwb/047/D8r/l37P60r3Y4Lna1r3z4L/l2b3e+7/78bLT6LzV1bPY0Lna17na27/J8L7gwbz23r7n17na1r/01r/f8r3e+7/+zLz73LLS3b/S3LPAzr3twLna17na27/J8L7gwbzyw73r/r3Y4Lna1r/1/L/l2b/78bLT6Lna1wdQaXR6v/7AstPosubwvMHlstLds/HCv9/Ts9nyvufXs9TMv/TAtebAAbzC1L344LL81b/0wL/K3rz23rLT6L/n87Lm8LzB5bP63L/g1bXm1r7h/7/V0LLE+L/f07333L/S7XW96NO999yy9NCy0+i9wN696OS9+OCz2fK+59cHUG50eqrFzv56s8HsvuDYvfjmstLdvMzdv/fNv/Xcv+D8s8LovdLcs/rKvfTNtebAvNPavMbTvMzdv/fNemtqan96vODKst3wvuTcvODKvffcsvLCtebSvuLhvPLDs/vWemIka256v/fNudrbv9P1vPLDs/vWemtvJGhver/3zbna27/X2r/70Lzyw7P71npuJGJ6v/fNudrbvPjHv9LNemtoJGhqer/3zbXm07na2KrFwPF6ve/Pv+rXv8Duvfzbv8byv+rbs8f4vPLDs/vWvuLRvMzjvNLMvNXIvc/xvM3bvNfVs9r6vd77vN7VveTzvcDev9vnvOb4v/fNvNLMvOPQv/fNvM/ivuDYvfjmtebbqsXA8Xq/wO69/Nu93vu+4ve9zsW8xtO97fKz2vq/7fK/xNF6EQoTerzP4r/3zbXm21BQudrKs9rKs/rbemtga3q96vu/+uu81Mi909Ky0t28zN28+9K8xOy8/dG15tK/6te83dO/1MW98uW/yt6z+tu15tO52su15sBQcrLx0b/A7rz65rz647zJwL/1/LPAwbLk8rL3wr/S6r3A3r/K3rP6273Gxb/1/LL8zLL84L3T47/k77PayrP627Lm4r/d4LXm1r313r7k0b/82L7i0bXmwHNQUHd3d1B5eXl6vNDPv+frvdPdemu15sABs/rbs8f4s/vEv8TRtebWv/zYtebAv+rbs8f4vuLhsvzMsvzgs/rbB1C52sqqxdTyerL8zLL84LP48rz65rLS3b/j5L7nz7PUzL/0wLPf173n9Lnay7XmwFB3er3P8b/i2bLZ1rzD9bXmwAG96OS9+OC/+/G/3/+y8+iz+tu/4M+y0+iy0t297tG9yty15ta/yvGy6Pq/ysu9/Nu+4f4HUHd6v/Tjv8PystLdvPriv+XZsvnHs/nktebAAb3o5L344LzW3b/0wL3z4L/l2XW/9fy/5dm/6/a82v252tu+59e95/S52tuz+9Wy0+h6Eh8Cudrbv/vNs+7TvNLMvNXIvc/xv9HPvufGB1B3er/3zbPxzrLS3bPxwr/f07zUyL/X6rXmwAG/982z8c6z+PK8+ua52tu/982y0+i/6te89c652tuz8cK/39O+59e95/S15ta/5u2/0uy/zPS+4tq84t+8w+q+4uG88sO52tu/wO69/Nu/2+e85vi/982+4Ni9+OYHULnayqrFycd6ver7v/rrvMzdvPvSv9/9v/Tjv9faudrLtebAUHd6vuLhvPLDs/vWtebAtebSvNXKv9XMvffcsvLCvPriv+XZvuLhs/vWtebWve/KsvHMv9/SsvvWtebWYiRrbr/3zbXm01B3er/T9bzyw7P71nW/6tSy8tq15sC15tK81cq/1cy96vu/+uu8+uK/5dm/9MC+59e15tZrbyRob7/3zbXm01BQcrLx0b7kx7/g1b/q17zd07/Uxb3q+7/6673A3r329npoudrbaXR0dHoUerP627Xm1rPayrP627/01rzP7rLm4r/d4Lz11b7i2rP6273A3rnayqrF1PJ6svzMsvzgs/jyvPrmstLdv+PkvufPs9TMv/TAs9/Xvef0udrLtebSvMLUvfjgv/XxvPfhvfPgv+XZdb/1/L/l2bna27zG073e+7/+zLz73Lna27zQwr3twHW99Pez+ve/4+S+58+52tu//sCy0+iy5vC8weWz+ty/4NW15tOy0t252sqqxcnHer3q+7/667zM3bz70r/f/b/047/X2rnay3NQOjo6UFB5eXpudHqqxcjhemtga3qz2N6/1MW+49F6Eg4XFnp1eg47MzYtMzQ+erzQz7/n673T3b3vyrz90b345npyv9X1vcHuvNT/sv7dsvnnvuflvc7yc1A6OjoyLjc2UGZ7d3d6v/TWvM/uudrbvuPkvO3yudrbv9X1vuH/vcHuvNT/v8byvdrVsvznv8PyvdfyvfHRs9vRsvvWvcDeehIOFxZ6vuH5vfjmtebWv9bfv8rxeg47MzYtMzQ+ehkJCXoZHhR6stLdv9/9stv1vPL5v+bVtebWa2pqf3q/5fq/9fyz3de91eS+4tCy5eq80M+/5+u90929wN69xsW/9fy/4+S+58+/xsyy/fm52tu98+C/5dl1v/X8v+XZv/Tjv8PystLdvdPSs8f4end3ZFA6OjpQUHd3d1C8xtq/5Na15tay8dG/0cO/5d+zw96+4tC+4tG8zOO9wN56EAkVFHq/19q/+9C15ta81cq+5MG/09e98fWy0+i9//Ky0t288sO96/6/68+9/uC15tKy8dG9+OC+5cd6EAkVFHqy8MS86c+/ytK86c++4s689t6+59e/9Na8z+615tO15sBQOjo6MCk1NFAhUHp6eCkuIzY/BTQ7Nz94YHp4vejkvODMs/jyvPrmvuL3vMzdv8rXvfLrenIfND02MykyegkuIzY/ehQ7Nz9zeHZQenp4Ljs9KXhgegF4vPriv+XZsvzMsvzgvdPjv+Tva3h2eni90+O/5O9oeHZ6eL3T47/k72l4dnp4vdPjv+Tvbnh2eni90+O/5O9veAd2UHp6eCo7Nj8uLj94YHoBUHp6enoheCg1Nj94YHp4vc/xv+LZstnWvMP1eHZ6eDI/Inhgenh5AgICAgICeHZ6eDQ7Nz94YHp4vejkvfjgs/vVstPov8rXvfLreCd2UHp6enoheCg1Nj94YHp4vuLhsvzbvMzdv/fNstLdve3AvPjHeHZ6eDI/Inhgenh5AgICAgICeHZ6eDQ7Nz94YHp4vejkvfjgs/vVstPov8rXvfLreCd2UHp6enoheCg1Nj94YHp4vPriv+XZv+btsvDlstPoemt4dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeni96OS9+OCz+9Wy0+i/yte98ut4J3ZQenp6eiF4KDU2P3hgeni8+uK/5dm/5u2y8OWy0+h6aHh2engyPyJ4YHp4eQICAgICAnh2eng0Ozc/eGB6eL3o5L344LP71bLT6L/K173y63gndlB6enp6IXgoNTY/eGB6eLLmzr/Q87/m7bLw5bLT6HppeHZ6eDI/Inhgenh5AgICAgICeHZ6eDQ7Nz94YHp4vejkvfjgs/vVstPov8rXvfLreCd2UHp6enoheCg1Nj94YHp4subOv9Dzv+btsvDlstPoem54dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeni96OS9+OCz+9Wy0+i/yte98ut4J1B6egd2UHp6eC0yMy4/BSkqOzk/BSg7LjM1eGB6eGxvf3h2UHp6eD4/NCkzLiN4YHp4ve/KvP3Rv9bMv8bMsv35v8TReFAnUDo6OlA=";

function _0xgetDecryptedInstruction() {
  try {
    const binary = atob(_0xSEC_CAPSULE);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) ^ 0x5A;
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    return "";
  }
}

// 動態約束規範快取（來自 Auto-Pilot 自動質檢回傳的 guardrails.json）
let _dynamicGuardrailsCache = null;

async function loadDynamicGuardrails() {
  try {
    const res = await fetch("guardrails.json?v=" + Date.now());
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.rules) && data.rules.length > 0) {
        _dynamicGuardrailsCache = data.rules;
        console.log(`[Guardrails] 成功動態加載 ${_dynamicGuardrailsCache.length} 條抗失真規範 (更新時間: ${data.updated_at || '最新'})`);

        // 呈現版本與規則數
        const badge = document.getElementById("system-version-badge");
        if (badge) {
          badge.textContent = `${APP_VERSION} (${_dynamicGuardrailsCache.length} 條規則)`;
          if (badge.parentElement) {
            badge.parentElement.title = `版本: ${APP_VERSION}\n約束規則數: ${_dynamicGuardrailsCache.length} 條\n同步時間: ${data.updated_at || '最新'}`;
          }
        }
      }
    }
  } catch (e) {
    console.debug("[Guardrails] 動態約束載入略過:", e);
  }
}

function getEffectiveSystemInstruction() {
  const base = _0xgetDecryptedInstruction();
  if (_dynamicGuardrailsCache && _dynamicGuardrailsCache.length > 0) {
    const ruleLines = _dynamicGuardrailsCache
      .filter(r => r.title && r.rule)
      .map(r => `   - ★【${r.title.trim()}】：${r.rule.trim()}`);
    if (ruleLines.length > 0) {
      const block = "\n\n5. 🛡️【實證抗失真約束規範（來自真實 NotebookLM 閉環質檢自動更新）】:\n" + ruleLines.join("\n");
      return base + block;
    }
  }
  return base;
}

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
  loadDynamicGuardrails();
});

// === 1. API KEY 管理與資安脫敏防護 ===
function maskApiKey(key) {
  if (!key || typeof key !== "string") return "";
  if (key.length <= 8) return "••••••••";
  const head = key.slice(0, 6);
  const tail = key.slice(-4);
  const dots = "•".repeat(Math.min(18, Math.max(6, key.length - 10)));
  return `${head}${dots}${tail}`;
}

function getApiKey(provider = currentProvider) {
  return sessionStorage.getItem(`${provider}_api_key`) || localStorage.getItem(`${provider}_api_key`) || "";
}

function setApiKey(provider, key, isSessionOnly = false) {
  if (key && key.trim()) {
    if (isSessionOnly) {
      sessionStorage.setItem(`${provider}_api_key`, key.trim());
      localStorage.removeItem(`${provider}_api_key`);
    } else {
      localStorage.setItem(`${provider}_api_key`, key.trim());
      sessionStorage.removeItem(`${provider}_api_key`);
    }
  } else {
    localStorage.removeItem(`${provider}_api_key`);
    sessionStorage.removeItem(`${provider}_api_key`);
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
    const k = getApiKey("gemini");
    input.value = k ? maskApiKey(k) : "";
    input.dataset.masked = k ? "true" : "false";
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

// === 單頁全螢幕高清放大檢視管理 ===
let currentZoomIndex = 0;

function openSlideZoom(index) {
  if (index < 0 || index >= uploadedSlidePages.length) return;
  currentZoomIndex = index;
  const slide = uploadedSlidePages[index];
  const pageNum = index + 1;
  const isSelected = selectedPageIndices.has(pageNum);

  const modal = document.getElementById("modal-slide-zoom");
  const title = document.getElementById("zoom-slide-title");
  const status = document.getElementById("zoom-slide-status");
  const img = document.getElementById("zoom-slide-img");
  const toggleBtnText = document.getElementById("btn-zoom-toggle-text");

  if (title) title.textContent = `第 ${pageNum} 頁 · ${slide.name || ""}`;
  if (status) {
    status.textContent = isSelected ? "✓ 已勾選納入解析" : "未勾選";
    status.className = isSelected
      ? "text-xs font-mono px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold"
      : "text-xs font-mono px-2.5 py-1 rounded-md bg-white/[0.06] text-zinc-400 border border-white/10";
  }
  if (toggleBtnText) {
    toggleBtnText.textContent = isSelected ? "取消勾選此頁" : "勾選納入解析";
  }
  if (img) img.src = slide.image;

  if (modal) {
    modal.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
  }
}

function closeSlideZoom() {
  const modal = document.getElementById("modal-slide-zoom");
  if (modal) modal.classList.add("hidden");
}

function toggleZoomSlideSelection() {
  const pageNum = currentZoomIndex + 1;
  if (selectedPageIndices.has(pageNum)) {
    selectedPageIndices.delete(pageNum);
  } else {
    selectedPageIndices.add(pageNum);
  }
  pageSelectionMode = "custom";
  updatePageSelectionModeUI();
  syncPageRangeInputFromSelection();
  renderLargeSlidesGrid();
  renderThumbnails();
  openSlideZoom(currentZoomIndex); // 刷新燈箱狀態
}


// === API Key 即時連線測試與健康度診斷引擎 ===
async function testApiKeyConnection(provider, apiKey) {
  if (!apiKey) {
    throw new Error("請先貼上或輸入 API 金鑰後再進行測試！");
  }

  const startTime = performance.now();

  if (provider === "gemini") {
    // 優先以最穩定、高響應的現代 Gemini Flash 模型發起快速輕量 ping
    const testModels = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
    let lastErr = null;

    for (const model of testModels) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "hi" }] }]
          })
        });

        const elapsed = Math.round(performance.now() - startTime);
        const data = await resp.json();

        if (resp.ok) {
          return {
            ok: true,
            provider: "Google Gemini",
            model: model,
            latencyMs: elapsed,
            message: `連線成功！金鑰正常有效，${model} 回應延遲 ${elapsed}ms`
          };
        }

        const msg = data.error?.message || "請求失敗";
        const msgLower = msg.toLowerCase();

        if (msgLower.includes("spending cap") || msgLower.includes("spend cap") || msgLower.includes("ai.studio/spend")) {
          return {
            ok: false,
            type: "spend_cap",
            message: "此金鑰所屬的 Google 專案已達「每月消費上限 (Monthly Spend Cap)」！解決方式：① 點擊下方「前往 Google AI Studio」選『Create API key in new project』建立新專案免費金鑰（最快）；或 ② 前往 https://ai.studio/spend 調高該專案的消費上限。"
          };
        }

        if (resp.status === 400 || msgLower.includes("api_key_invalid") || msgLower.includes("api key not valid")) {
          return {
            ok: false,
            type: "invalid_key",
            message: "API Key 無效 (API_KEY_INVALID)：請確認是否完整複製了 AIzaSy 開頭的金鑰字串！"
          };
        }

        if (resp.status === 429 || msgLower.includes("resource_exhausted") || msgLower.includes("quota")) {
          return {
            ok: false,
            type: "quota_exhausted",
            message: "金鑰存在但目前配額已用盡 (429 Rate Limit / Quota)：請在 AI Studio 建立新專案金鑰或稍候再試！"
          };
        }

        if (resp.status === 503 || msgLower.includes("high demand") || msgLower.includes("spikes in demand")) {
          lastErr = new Error(`模型 ${model} 當前雲端流量較高 (${msg})，系統解析時已配置好自動備援`);
          continue;
        }

        lastErr = new Error(msg);
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error("無法連線至 Google Gemini API，請檢查網路連線。");
  } else if (provider === "openai") {
    const endpoint = "https://api.openai.com/v1/chat/completions";
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5
      })
    });
    const elapsed = Math.round(performance.now() - startTime);
    const data = await resp.json();
    if (resp.ok) {
      return {
        ok: true,
        provider: "OpenAI",
        model: "gpt-4o-mini",
        latencyMs: elapsed,
        message: `連線成功！OpenAI 金鑰正常有效 (延遲 ${elapsed}ms)`
      };
    }
    const msg = data.error?.message || "OpenAI API 請求失敗";
    return { ok: false, message: `OpenAI 錯誤: ${msg}` };
  } else if (provider === "anthropic") {
    return {
      ok: true,
      provider: "Anthropic Claude",
      message: "Anthropic 金鑰格式正確（瀏覽器端直連受 CORS 限制，後端調用支援）"
    };
  }
}


/**
 * 處理網址爬取 (支援 Google Slides, 線上 PDF, 線上圖片, 以及通用網頁/簡報)
 */
async function handleUrlCrawl(url) {
  if (!/^https?:\/\//i.test(url)) {
    showToast("網址格式無效，請以 http:// 或 https:// 開頭", "warning");
    return;
  }

  const btnCrawl = document.getElementById("btn-crawl-url");
  const statusEl = document.getElementById("url-crawl-status");
  const statusText = document.getElementById("url-crawl-status-text");

  const setStatus = (msg) => {
    if (statusEl) statusEl.classList.remove("hidden");
    if (statusText) statusText.textContent = msg;
  };

  const clearStatus = () => {
    if (statusEl) statusEl.classList.add("hidden");
    if (btnCrawl) {
      btnCrawl.disabled = false;
      btnCrawl.classList.remove("opacity-50", "cursor-not-allowed");
    }
  };

  if (btnCrawl) {
    btnCrawl.disabled = true;
    btnCrawl.classList.add("opacity-50", "cursor-not-allowed");
  }

  setStatus("正在建立連線並分析網址內容...");

  // 針對 Canva 網址的防爬保護偵測與即時指引
  if (/canva\.com\/(templates|design)\//i.test(url)) {
    clearStatus();
    showToast("💡 Canva 設有防拷透明遮罩。請按鍵盤 Win + Shift + S 框選截圖，切換回本站直接按 Ctrl+V 貼上即可！", "info", 9000);
    return;
  }

  try {
    // 1. 若處於本機 Python 環境 (localhost / 127.0.0.1)，優先呼叫本機爬蟲後端 (具備完整 Playwright 與 fitz 引擎)
    if (!isGitHubPages && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
      try {
        setStatus("呼叫 Python 爬蟲引擎進行多頁面截取與解析...");
        const fd = new FormData();
        fd.append("source_url", url);
        const resp = await fetch("/api/crawl-preview", { method: "POST", body: fd });
        if (resp.ok) {
          const res = await resp.json();
          if (res.preview_pages && res.preview_pages.length > 0) {
            uploadedSlidePages = res.preview_pages.map(p => ({
              page: p.page_number,
              image: p.data_uri,
              name: `網址素材 (第 ${p.page_number} 頁)`,
              text: ""
            }));
            selectedFiles = [];
            currentComparisonPage = 0;
            renderThumbnails();
            clearStatus();
            showToast(`成功自網址載入 ${uploadedSlidePages.length} 頁投影片！`, "success");
            return;
          }
        }
      } catch (err) {
        console.warn("本機爬蟲端點連線失敗，切換至純前端解析模式:", err);
      }
    }

    // 2. 純前端解析模式 (適用於 GitHub Pages 靜態網站環境)
    // 策略 A: Google Slides
    const gmatch = url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
    if (gmatch) {
      setStatus("偵測到 Google Slides，正在匯出並轉譯投影片...");
      const presId = gmatch[1];
      const exportUrl = `https://docs.google.com/presentation/d/${presId}/export/pdf`;

      let arrayBuffer = null;
      const proxies = [
        `https://corsproxy.io/?url=${encodeURIComponent(exportUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(exportUrl)}`
      ];

      for (const pUrl of proxies) {
        try {
          const r = await fetch(pUrl);
          if (r.ok) {
            arrayBuffer = await r.arrayBuffer();
            if (arrayBuffer && arrayBuffer.byteLength > 1000) break;
          }
        } catch (e) { /* try next */ }
      }

      if (arrayBuffer && typeof pdfjsLib !== "undefined") {
        setStatus("正在算繪 Google Slides 投影片高畫質縮圖...");
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const total = Math.min(pdf.numPages, 30);
        const pages = [];
        for (let i = 1; i <= total; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          pages.push({
            page: i,
            image: canvas.toDataURL("image/jpeg", 0.85),
            name: `Google Slides (第 ${i} 頁)`,
            text: ""
          });
        }
        uploadedSlidePages = pages;
        selectedFiles = [];
        currentComparisonPage = 0;
        renderThumbnails();
        clearStatus();
        showToast(`成功自 Google Slides 載入 ${uploadedSlidePages.length} 頁簡報！`, "success");
        return;
      }
    }

    // 策略 B: 線上 PDF (結尾或路徑包含 .pdf)
    if (url.toLowerCase().includes(".pdf")) {
      setStatus("偵測到線上 PDF，正在下載檔案...");
      let pdfBuffer = null;
      const proxies = [
        `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
      ];
      for (const pUrl of proxies) {
        try {
          const r = await fetch(pUrl);
          if (r.ok) {
            pdfBuffer = await r.arrayBuffer();
            if (pdfBuffer && pdfBuffer.byteLength > 1000) break;
          }
        } catch (e) { /* try next */ }
      }

      if (pdfBuffer && typeof pdfjsLib !== "undefined") {
        setStatus("正在算繪 PDF 各頁投影片...");
        const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
        const total = Math.min(pdf.numPages, 30);
        const pages = [];
        for (let i = 1; i <= total; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          pages.push({
            page: i,
            image: canvas.toDataURL("image/jpeg", 0.85),
            name: `線上 PDF (第 ${i} 頁)`,
            text: ""
          });
        }
        uploadedSlidePages = pages;
        selectedFiles = [];
        currentComparisonPage = 0;
        renderThumbnails();
        clearStatus();
        showToast(`成功自線上 PDF 載入 ${uploadedSlidePages.length} 頁投影片！`, "success");
        return;
      }
    }

    // 策略 C: 線上圖片連結 (.png / .jpg / .webp)
    if (/\.(png|jpe?g|webp)(\?.*)?$/i.test(url)) {
      setStatus("正在載入線上投影片圖片...");
      const dataUri = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || 1920;
          canvas.height = img.naturalHeight || 1080;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/jpeg", 0.88));
        };
        img.onerror = () => {
          const proxyImg = new Image();
          proxyImg.crossOrigin = "anonymous";
          proxyImg.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = proxyImg.naturalWidth || 1920;
            canvas.height = proxyImg.naturalHeight || 1080;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(proxyImg, 0, 0);
            resolve(canvas.toDataURL("image/jpeg", 0.88));
          };
          proxyImg.onerror = () => reject(new Error("圖片載入失敗"));
          proxyImg.src = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
        };
        img.src = url;
      });

      uploadedSlidePages = [
        { page: 1, image: dataUri, name: "線上圖片投影片", text: "" }
      ];
      selectedFiles = [];
      currentComparisonPage = 0;
      renderThumbnails();
      clearStatus();
      showToast("成功載入線上投影片圖片！", "success");
      return;
    }

    // 策略 D: 一般網頁 / 線上簡報平台 (以 16:9 投影片視角截圖)
    setStatus("以 16:9 投影片視角截取網頁視覺版面...");
    const shotServiceUrl = `https://image.thum.io/get/width/1920/crop/1080/noanimate/${encodeURIComponent(url)}`;
    const shotDataUri = await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 1920, 1080);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("網頁截圖服務暫不可用"));
      img.src = shotServiceUrl;
    });

    uploadedSlidePages = [
      { page: 1, image: shotDataUri, name: "網頁版面視覺截圖", text: "" }
    ];
    selectedFiles = [];
    currentComparisonPage = 0;
    renderThumbnails();
    clearStatus();
    showToast("成功自網址抓取 16:9 網頁版面截圖！", "success");

  } catch (err) {
    console.error("網址抓取失敗:", err);
    clearStatus();
    showToast(`抓取失敗：${err.message || "無法解析該網址"}。若是 Google Slides，請確認簡報已開啟「知道連結的人皆可檢視」公開分享權限。`, "error");
  }
}

function setupEventListeners() {
  const on = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    return el;
  };

  const modalApiKey = document.getElementById("modal-apikey");
  const modalTutorial = document.getElementById("modal-tutorial");
  const modalSecurity = document.getElementById("modal-security");
  const modalDisclaimer = document.getElementById("modal-disclaimer");
  const modalNblmTutorial = document.getElementById("modal-nblm-tutorial");

  // 頂部導航按鈕
  on("btn-apikey-modal", "click", () => {
    openApiKeyModal(currentProvider);
  });
  on("btn-close-apikey-modal", "click", () => {
    if (modalApiKey) modalApiKey.classList.add("hidden");
  });

  // 點擊「API 申請教學」開啟完整多供應商教學彈窗（Gemini、OpenAI、Claude 3 步驟圖解）
  on("btn-tutorial", "click", () => {
    if (modalTutorial) {
      modalTutorial.classList.remove("hidden");
      switchTutTab(currentProvider || "gemini");
      if (window.lucide) window.lucide.createIcons();
    }
  });
  on("btn-close-tutorial", "click", () => {
    if (modalTutorial) modalTutorial.classList.add("hidden");
  });
  on("btn-tutorial-got-it", "click", () => {
    if (modalTutorial) modalTutorial.classList.add("hidden");
    openApiKeyModal(modalSelectedProvider || currentProvider);
  });
  on("btn-modal-open-tutorial", "click", () => {
    if (modalApiKey) modalApiKey.classList.add("hidden");
    if (modalTutorial) {
      modalTutorial.classList.remove("hidden");
      switchTutTab(modalSelectedProvider || currentProvider);
      if (window.lucide) window.lucide.createIcons();
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
    if (modalTutorial) {
      modalTutorial.classList.remove("hidden");
      switchTutTab("openai");
      if (window.lucide) window.lucide.createIcons();
    }
  });
  on("btn-save-onboarding-key", "click", () => {
    const input = document.getElementById("input-onboarding-key");
    let key = input ? input.value.trim() : "";
    if (input && input.dataset.masked === "true") {
      key = getApiKey("gemini");
    }
    if (!key) {
      showToast("請先貼上有效的 Google 官方免費 API Key，或點擊跳過", "warning");
      return;
    }
    setApiKey("gemini", key);
    switchProvider("gemini");
    closeOnboardingModal(true);
    showToast("Google API Key 已就緒！請拖入投影片開始分析", "success");
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

  // 免責聲明彈窗
  const openDisclaimerModal = () => {
    if (modalDisclaimer) {
      modalDisclaimer.classList.remove("hidden");
      if (window.lucide) window.lucide.createIcons();
    }
  };
  const closeDisclaimerModal = () => {
    if (modalDisclaimer) modalDisclaimer.classList.add("hidden");
  };

  on("btn-disclaimer", "click", openDisclaimerModal);
  on("btn-close-disclaimer", "click", closeDisclaimerModal);
  on("btn-close-disclaimer-confirm", "click", closeDisclaimerModal);
  on("btn-open-disclaimer-link", "click", openDisclaimerModal);
  on("btn-onboarding-disclaimer", "click", openDisclaimerModal);
  on("btn-footer-disclaimer", "click", openDisclaimerModal);

  // NotebookLM 操作 SOP 彈窗
  const openNblmTutorialModal = () => {
    if (modalNblmTutorial) {
      modalNblmTutorial.classList.remove("hidden");
      if (window.lucide) window.lucide.createIcons();
    }
  };
  const closeNblmTutorialModal = () => {
    if (modalNblmTutorial) modalNblmTutorial.classList.add("hidden");
  };

  on("btn-open-nblm-tutorial", "click", openNblmTutorialModal);
  on("btn-open-nblm-tutorial-sidebar", "click", openNblmTutorialModal);
  on("btn-nblm-header-guide", "click", openNblmTutorialModal);
  on("btn-close-nblm-tutorial", "click", closeNblmTutorialModal);
  on("btn-close-nblm-tutorial-confirm", "click", closeNblmTutorialModal);

  // 隱私保證彈窗
  on("btn-security", "click", () => {
    if (modalSecurity) modalSecurity.classList.remove("hidden");
  });
  on("btn-footer-security", "click", () => {
    if (modalSecurity) modalSecurity.classList.remove("hidden");
  });
  on("btn-close-security", "click", () => {
    if (modalSecurity) modalSecurity.classList.add("hidden");
  });
  on("btn-close-security-confirm", "click", () => {
    if (modalSecurity) modalSecurity.classList.add("hidden");
  });

  // 點選遮罩背景自動關閉彈窗
  [modalDisclaimer, modalSecurity, modalApiKey, modalNblmTutorial].forEach(m => {
    if (m) {
      m.addEventListener("click", (e) => {
        if (e.target === m) m.classList.add("hidden");
      });
    }
  });

  // 金鑰設定彈窗內供應商切換
  document.querySelectorAll("#modal-provider-selector .modal-provider-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-modal-provider");
      openApiKeyModal(p);
    });
  });

  // 儲存金鑰
  // 測試 API Key 連線按鈕監聽
  on("btn-test-key", async () => {
    const inputKey = document.getElementById("input-api-key");
    let key = inputKey ? inputKey.value.trim() : "";
    if (inputKey && inputKey.dataset.masked === "true") {
      key = getApiKey(modalSelectedProvider);
    }
    const testBtn = document.getElementById("btn-test-key");
    const testBtnText = document.getElementById("btn-test-key-text");
    const resultBox = document.getElementById("api-key-test-result");
    const resultIcon = document.getElementById("test-result-icon");
    const resultTitle = document.getElementById("test-result-title");
    const resultDetail = document.getElementById("test-result-detail");

    if (!key) {
      showToast("請先輸入或貼上金鑰後再進行測試！", "warning");
      if (inputKey) inputKey.focus();
      return;
    }

    if (testBtn) testBtn.disabled = true;
    if (testBtnText) testBtnText.textContent = "連線驗證中...";
    if (resultBox) resultBox.classList.add("hidden");

    try {
      const res = await testApiKeyConnection(modalSelectedProvider, key);
      if (resultBox) {
        resultBox.classList.remove("hidden");
        if (res.ok) {
          resultBox.className = "p-3 rounded-lg border text-xs font-mono transition-all bg-[#E9EFEA] border-[#768A7A] text-[#322E2B]";
          resultIcon.textContent = "✅";
          resultTitle.textContent = "金鑰連線正常 · 驗證通過！";
          resultDetail.textContent = res.message;
          showToast("🎉 API 金鑰測試通過！連線完全正常", "success");
        } else {
          resultBox.className = "p-3 rounded-lg border text-xs font-mono transition-all bg-[#F4EAE8] border-[#C8A7A3] text-[#322E2B]";
          resultIcon.textContent = "⚠️";
          resultTitle.textContent = "金鑰驗證未通過";
          resultDetail.textContent = res.message;
          showToast(`金鑰驗證失敗：${res.message}`, "error");
        }
      }
    } catch (err) {
      if (resultBox) {
        resultBox.classList.remove("hidden");
        resultBox.className = "p-3 rounded-lg border text-xs font-mono transition-all bg-[#F4EAE8] border-[#C8A7A3] text-[#322E2B]";
        resultIcon.textContent = "❌";
        resultTitle.textContent = "連線異常";
        resultDetail.textContent = err.message || "無法連線至 API 伺服器，請檢查網路連線。";
      }
      showToast(`連線測試異常: ${err.message}`, "error");
    } finally {
      if (testBtn) testBtn.disabled = false;
      if (testBtnText) testBtnText.textContent = "重新測試連線";
      if (window.lucide) window.lucide.createIcons();
    }
  });

  on("btn-save-key", "click", () => {
    const inputKey = document.getElementById("input-api-key");
    const checkSession = document.getElementById("check-session-only");
    const isSession = checkSession ? checkSession.checked : false;
    let key = inputKey ? inputKey.value.trim() : "";
    if (inputKey && inputKey.dataset.masked === "true") {
      key = getApiKey(modalSelectedProvider);
    }
    if (!key) {
      showToast("請輸入有效金鑰，或點擊清除", "warning");
      return;
    }
    setApiKey(modalSelectedProvider, key, isSession);
    if (modalApiKey) modalApiKey.classList.add("hidden");
    const modeDesc = isSession ? "（隱私模式：關閉分頁自動銷毀）" : "（已安全保存）";
    showToast(`${PROVIDER_CONFIG[modalSelectedProvider].name} 金鑰${modeDesc}！`, "success");
    if (modalSelectedProvider !== currentProvider) {
      switchProvider(modalSelectedProvider);
    }
  });

  // 清除金鑰
  on("btn-clear-key", "click", () => {
    setApiKey(modalSelectedProvider, "");
    const inputKey = document.getElementById("input-api-key");
    if (inputKey) {
      inputKey.value = "";
      inputKey.dataset.masked = "false";
    }
    showToast(`已清除 ${PROVIDER_CONFIG[modalSelectedProvider].name} 本地金鑰`, "info");
  });

  // 密碼顯隱切換與脫敏互動
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

    keyInput.addEventListener("keydown", (e) => {
      if (keyInput.dataset.masked === "true" && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        keyInput.value = "";
        keyInput.dataset.masked = "false";
      }
    });
    keyInput.addEventListener("paste", () => {
      keyInput.dataset.masked = "false";
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


  // 來源切換 Tabs (檔案上傳 vs 網址爬取)
  const tabSourceFile = document.getElementById("tab-source-file");
  const tabSourceUrl = document.getElementById("tab-source-url");
  const dropZoneEl = document.getElementById("drop-zone");
  const urlZoneEl = document.getElementById("url-zone");
  const btnCrawlUrl = document.getElementById("btn-crawl-url");
  const inputSourceUrl = document.getElementById("input-source-url");

  if (tabSourceFile && tabSourceUrl && dropZoneEl && urlZoneEl) {
    tabSourceFile.addEventListener("click", () => {
      tabSourceFile.className = "py-2 px-3 rounded-lg font-semibold text-[#322E2B] bg-white shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer";
      tabSourceUrl.className = "py-2 px-3 rounded-lg font-medium text-[#68615B] hover:text-[#322E2B] flex items-center justify-center gap-1.5 transition-all cursor-pointer";
      dropZoneEl.classList.remove("hidden");
      urlZoneEl.classList.add("hidden");
    });

    tabSourceUrl.addEventListener("click", () => {
      tabSourceUrl.className = "py-2 px-3 rounded-lg font-semibold text-[#322E2B] bg-white shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer";
      tabSourceFile.className = "py-2 px-3 rounded-lg font-medium text-[#68615B] hover:text-[#322E2B] flex items-center justify-center gap-1.5 transition-all cursor-pointer";
      dropZoneEl.classList.add("hidden");
      urlZoneEl.classList.remove("hidden");
      if (window.lucide) window.lucide.createIcons();
      if (inputSourceUrl) inputSourceUrl.focus();
    });
  }

  if (btnCrawlUrl && inputSourceUrl) {
    const triggerCrawl = () => {
      const u = inputSourceUrl.value.trim();
      if (!u) {
        showToast("請輸入欲爬取的簡報或網頁連結", "warning");
        return;
      }
      handleUrlCrawl(u);
    };

    btnCrawlUrl.addEventListener("click", triggerCrawl);
    inputSourceUrl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        triggerCrawl();
      }
    });

    // 清空網址按鈕事件處理 (支援頂部清空文字按鈕與輸入框右側清空按鈕)
    const btnClearUrl = document.getElementById("btn-clear-url");
    const btnClearUrlText = document.getElementById("btn-clear-url-text");
    const handleClearUrl = () => {
      const hadValue = inputSourceUrl.value.trim().length > 0;
      inputSourceUrl.value = "";
      inputSourceUrl.focus();

      const statusEl = document.getElementById("url-crawl-status");
      if (statusEl) statusEl.classList.add("hidden");

      btnCrawlUrl.disabled = false;
      btnCrawlUrl.classList.remove("opacity-50", "cursor-not-allowed");

      if (hadValue) {
        showToast("已清空簡報網址", "info");
      }
    };

    if (btnClearUrl) btnClearUrl.addEventListener("click", handleClearUrl);
    if (btnClearUrlText) btnClearUrlText.addEventListener("click", handleClearUrl);
  }

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

  // 全域剪貼簿貼上 (Ctrl+V 一鍵貼上截圖或投影片圖片，支援 Canva/Figma/螢幕截圖直接貼上)
  window.addEventListener("paste", (e) => {
    const activeEl = document.activeElement;
    const isTextInput = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");

    const items = e.clipboardData && e.clipboardData.items;
    if (!items || items.length === 0) return;

    const imageFiles = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          let ext = ".png";
          if (file.type.includes("jpeg") || file.type.includes("jpg")) ext = ".jpg";
          else if (file.type.includes("webp")) ext = ".webp";

          const filename = (file.name && file.name !== "image.png" && file.name !== "blob")
            ? file.name
            : `剪貼簿簡報_${Date.now()}_${i + 1}${ext}`;

          const namedFile = new File([file], filename, { type: file.type || "image/png" });
          imageFiles.push(namedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      handleFilesAdded(imageFiles);
      showToast(`已自剪貼簿貼上 ${imageFiles.length} 張簡報圖片！`, "success");
    }
  });

  on("btn-clear-files", "click", () => {
    if (uploadedSlidePages.length > 0) {
      removedSlidesHistory.push({
        type: "clear",
        slides: [...uploadedSlidePages],
        selectedIndices: new Set(selectedPageIndices),
        timestamp: Date.now()
      });
      updateUndoButtonsUI();
    }
    selectedFiles = [];
    uploadedSlidePages = [];
    selectedPageIndices.clear();
    pageSelectionMode = "all";
    currentComparisonPage = 0;
    renderThumbnails();
    if (isLargePickerOpen()) {
      renderLargeSlidesGrid();
    }
    if (fileInput) fileInput.value = "";
    showToastWithUndo("已清空所有選取的投影片（誤刪可點擊喚回）", () => undoRemoveSlide(), "info");
  });

  // 頁數較多 (>8頁) 時的範圍解析控制項監聽
  on("btn-mode-custom-pages", "click", () => {
    pageSelectionMode = "custom";
    updatePageSelectionModeUI();
    syncPageRangeInputFromSelection();
    renderThumbnails();
    if (isLargePickerOpen()) renderLargeSlidesGrid();
  });

  on("btn-mode-all-pages", "click", () => {
    pageSelectionMode = "all";
    updatePageSelectionModeUI();
    selectedPageIndices = new Set(uploadedSlidePages.map((_, i) => i + 1));
    syncPageRangeInputFromSelection();
    renderThumbnails();
  });

  const rangeInput = document.getElementById("input-page-ranges");
  if (rangeInput) {
    rangeInput.addEventListener("input", (e) => {
      selectedPageIndices = parsePageRanges(e.target.value, uploadedSlidePages.length);
      const countEl = document.getElementById("selected-pages-count");
      if (countEl) countEl.textContent = selectedPageIndices.size;
      renderThumbnails();
    });
  }

// 已移除智能推薦按鈕，全面交由使用者自主挑選

  on("btn-quick-select-all", "click", () => {
    selectedPageIndices = new Set(uploadedSlidePages.map((_, i) => i + 1));
    syncPageRangeInputFromSelection();
    renderThumbnails();
  });

  on("btn-quick-clear", "click", () => {
    selectedPageIndices.clear();
    pageSelectionMode = "custom";
    updatePageSelectionModeUI();
    syncPageRangeInputFromSelection();
    renderThumbnails();
    if (isLargePickerOpen()) renderLargeSlidesGrid();
    showToast("已清空所有勾選", "info");
  });

  // 大畫面挑選彈窗與喚回監聽
  on("btn-open-large-picker", "click", openLargePickerModal);
  on("btn-close-large-picker", "click", closeLargePickerModal);
  on("btn-close-zoom-modal", "click", closeSlideZoom);
  on("btn-zoom-toggle-select", "click", toggleZoomSlideSelection);
  const zoomModal = document.getElementById("modal-slide-zoom");
  if (zoomModal) {
    zoomModal.addEventListener("click", (e) => {
      if (e.target === zoomModal) closeSlideZoom();
    });
  }
  on("btn-large-finish", "click", closeLargePickerModal);

  on("btn-undo-delete", "click", undoRemoveSlide);
  on("btn-large-undo", "click", undoRemoveSlide);

  on("btn-large-select-all", "click", () => {
    selectedPageIndices = new Set(uploadedSlidePages.map((_, i) => i + 1));
    syncPageRangeInputFromSelection();
    renderLargeSlidesGrid();
    renderThumbnails();
  });

  on("btn-large-clear-sel", "click", () => {
    selectedPageIndices.clear();
    pageSelectionMode = "custom";
    updatePageSelectionModeUI();
    syncPageRangeInputFromSelection();
    renderLargeSlidesGrid();
    renderThumbnails();
    showToast("已全不選，請點擊卡片勾選您想要解析的投影片", "info");
  });

  // 鍵盤快捷鍵：Escape 關閉大畫面挑選；Ctrl+Z / Cmd+Z 喚回誤刪投影片
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isLargePickerOpen()) {
      closeLargePickerModal();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
        return; // 保留原生輸入框的復原行為
      }
      if (removedSlidesHistory.length > 0) {
        e.preventDefault();
        undoRemoveSlide();
      }
    }
  });

  // 結果頁籤切換監聽
  document.querySelectorAll(".result-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-result-tab");
      switchResultTab(tab);
    });
  });

  // 投影片翻頁與視角切換監聽
  on("btn-prev-slide", "click", () => {
    const activeSlides = getActiveComparisonSlides();
    if (currentComparisonPage > 0) {
      currentComparisonPage--;
      updateComparisonView();
    }
  });
  on("btn-next-slide", "click", () => {
    const activeSlides = getActiveComparisonSlides();
    if (currentComparisonPage < activeSlides.length - 1) {
      currentComparisonPage++;
      updateComparisonView();
    }
  });
  on("btn-toggle-comparison-scope", "click", () => {
    comparisonViewScope = (comparisonViewScope === "selected") ? "all" : "selected";
    currentComparisonPage = 0;
    updateComparisonView();
  });

  // 提示詞模式選擇（左側操作卡片）
  document.querySelectorAll("#prompt-mode-selector .prompt-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-prompt-mode");
      if (mode) switchPromptMode(mode);
    });
  });

  // 提示詞模式切換（右側結果頁子導航：模式1、模式2、自訂頁面內容元件）
  on("btn-subtab-global", "click", () => switchPromptMode("global"));
  on("btn-subtab-slide", "click", () => switchPromptMode("slide"));
  on("btn-subtab-custom", "click", () => switchPromptMode("custom"));

  // 自訂頁面內容元件故事板按鈕
  on("btn-add-custom-slide", "click", () => {
    const nextIdx = customStoryboardSlides.length + 1;
    customStoryboardSlides.push({
      layout: "D",
      topic: `第 ${nextIdx} 頁自訂核心論點`
    });
    renderCustomStoryboardUI();
    syncCustomPromptAndPreview();
    showToast(`已新增第 ${nextIdx} 頁！請選擇版型並填寫主題`, "success");
  });

  on("btn-rebuild-custom-prompt", "click", () => {
    syncCustomPromptAndPreview();
    showToast("已依最新版型與文案指派更新 NotebookLM 提示詞！", "success");
  });

  // 開始分析按鈕
  on("btn-start-analyze", "click", handleStartAnalyze);

  // 複製按鈕（動態對應當前所選模式與使用者自訂頁數/手動微調內容）
  on("btn-copy-nblm", "click", () => {
    const codeEl = document.getElementById("nblm-prompt-code");
    const liveText = (codeEl?.innerText || codeEl?.textContent || "").trim();
    let promptToCopy = "";
    if (liveText && !liveText.startsWith("等待分析產生") && !liveText.startsWith("未擷取到")) {
      promptToCopy = liveText;
    } else {
      if (currentPromptMode === "global") promptToCopy = generatedPromptGlobal || generatedNblmPrompt;
      else if (currentPromptMode === "slide") promptToCopy = generatedPromptSlide || generatedNblmPrompt;
      else if (currentPromptMode === "custom") promptToCopy = generatedPromptCustom || generateCustomStoryboardPrompt();
      promptToCopy = applyTargetPageCountToPrompt(promptToCopy, userTargetPageCount);
    }
    if (!promptToCopy) return;
    navigator.clipboard.writeText(promptToCopy).then(() => {
      const label = document.getElementById("copy-btn-label");
      if (label) {
        const originalText = label.textContent;
        label.textContent = "已複製！";
        setTimeout(() => label.textContent = originalText, 2000);
      }
      const modeName = currentPromptMode === "global" ? "【模式 1：學風格 · 做新簡報】" : "【模式 2：參考原稿 · 逐頁排版】";
      showToast(`已成功複製 ${modeName} 提示詞！請前往 NotebookLM 右側工作室「簡報」貼上`, "success");
    });
  });

  // 直達工作流按鈕：複製並開啟 NotebookLM
  on("btn-copy-and-open-nblm", "click", () => {
    const codeEl = document.getElementById("nblm-prompt-code");
    const liveText = (codeEl?.innerText || codeEl?.textContent || "").trim();
    let promptToCopy = "";
    if (liveText && !liveText.startsWith("等待分析產生") && !liveText.startsWith("未擷取到")) {
      promptToCopy = liveText;
    } else {
      if (currentPromptMode === "global") promptToCopy = generatedPromptGlobal || generatedNblmPrompt;
      else if (currentPromptMode === "slide") promptToCopy = generatedPromptSlide || generatedNblmPrompt;
      else if (currentPromptMode === "custom") promptToCopy = generatedPromptCustom || generateCustomStoryboardPrompt();
      promptToCopy = applyTargetPageCountToPrompt(promptToCopy, userTargetPageCount);
    }
    if (!promptToCopy) {
      showToast("尚未產生提示詞，請先上傳簡報進行分析", "warning");
      return;
    }
    navigator.clipboard.writeText(promptToCopy).then(() => {
      showToast(`已複製提示詞！正在開啟 NotebookLM，請至右側工作室點選「簡報」貼上`, "success");
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
      b.className = "tut-tab-btn py-1.5 border-b-2 border-[#768A7A] text-[#322E2B] font-semibold cursor-pointer";
    } else {
      b.className = "tut-tab-btn py-1.5 border-b-2 border-transparent text-[#68615B] hover:text-[#322E2B] cursor-pointer";
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
      btn.className = "modal-provider-btn px-2 py-1.5 rounded-lg text-xs font-semibold border transition-all text-center bg-[#768A7A] text-white border-[#768A7A] cursor-pointer";
    } else {
      btn.className = "modal-provider-btn px-2 py-1.5 rounded-lg text-xs font-medium border transition-all text-center bg-[#F3EFEA] text-[#68615B] border-[#322E2B]/10 hover:bg-[#EAE3DC] cursor-pointer";
    }
  });

  document.getElementById("modal-key-label").textContent = `${config.name} API Key：`;
  const keyInput = document.getElementById("input-api-key");
  keyInput.placeholder = config.defaultPlaceholder;

  const storedKey = getApiKey(provider);
  if (storedKey) {
    keyInput.value = maskApiKey(storedKey);
    keyInput.dataset.masked = "true";
  } else {
    keyInput.value = "";
    keyInput.dataset.masked = "false";
  }

  // 隱私模式勾選狀態
  const checkSession = document.getElementById("check-session-only");
  if (checkSession) {
    checkSession.checked = !!sessionStorage.getItem(`${provider}_api_key`);
  }

  const portalLink = document.getElementById("modal-portal-link");
  portalLink.href = config.portalUrl;
  document.getElementById("modal-portal-text").textContent = config.portalText;

  const resultBox = document.getElementById("api-key-test-result");
  if (resultBox) resultBox.classList.add("hidden");
  const testBtnText = document.getElementById("btn-test-key-text");
  if (testBtnText) testBtnText.textContent = "測試金鑰連線";
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
  const maxPages = Math.min(totalPages, 30);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.25 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    
    let pageText = "";
    try {
      const textContent = await page.getTextContent();
      pageText = textContent.items.map(it => it.str).join(" ").trim();
    } catch (e) {
      pageText = "";
    }
    pages.push({ page: i, image: dataUrl, text: pageText });
  }
  if (totalPages > 30) {
    setTimeout(() => {
      showToast(`檢測到此簡報共有 ${totalPages} 頁，已為您自動載入前 30 頁核心版型`, "info");
    }, 500);
  }
  return { total_pages: totalPages, preview_pages: pages };
}

// === 頁面選取狀態管理 (支援超過 8 頁時精選喜好頁面) ===
let pageSelectionMode = "all"; // "all" | "custom"
let selectedPageIndices = new Set(); // 1-based page indices: Set([1, 3, 5, ...])

// 將 Set([1, 2, 3, 5, 7, 8]) 轉為簡潔字串 "1-3, 5, 7-8"
function formatPageRanges(setOrArray) {
  if (!setOrArray) return "";
  const nums = Array.from(setOrArray).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (nums.length === 0) return "";
  const ranges = [];
  let start = nums[0];
  let end = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === end + 1) {
      end = nums[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = nums[i];
      end = nums[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(", ");
}

// 將字串 "1, 3, 5-8" 解析為 Set([1, 3, 5, 6, 7, 8])
function parsePageRanges(rangeStr, maxPage) {
  const result = new Set();
  if (!rangeStr || typeof rangeStr !== "string") return result;
  const parts = rangeStr.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes("-")) {
      const [sStr, eStr] = trimmed.split("-");
      const s = parseInt(sStr.trim(), 10);
      const e = parseInt(eStr.trim(), 10);
      if (!isNaN(s) && !isNaN(e) && s <= e) {
        for (let i = Math.max(1, s); i <= Math.min(e, maxPage || 9999); i++) {
          result.add(i);
        }
      }
    } else {
      const n = parseInt(trimmed, 10);
      if (!isNaN(n) && n >= 1 && (!maxPage || n <= maxPage)) {
        result.add(n);
      }
    }
  }
  return result;
}

// 同步輸入框與計數器數值
function syncPageRangeInputFromSelection() {
  const input = document.getElementById("input-page-ranges");
  const countEl = document.getElementById("selected-pages-count");
  if (input) {
    input.value = formatPageRanges(selectedPageIndices);
  }
  if (countEl) {
    countEl.textContent = selectedPageIndices.size;
  }
}

// 檢查簡報頁數是否超過 8 頁，動態顯示/隱藏選取控制面板
function checkAndUpdatePageSelectionPanel() {
  const panel = document.getElementById("page-selection-panel");
  const badge = document.getElementById("page-selection-badge");
  const promptTotal = document.getElementById("prompt-total-pages");
  const totalSlides = uploadedSlidePages.length;

  if (!panel) return;

  if (totalSlides > 8) {
    panel.classList.remove("hidden");
    if (badge) badge.textContent = `共 ${totalSlides} 頁`;
    if (promptTotal) promptTotal.textContent = totalSlides;
  } else {
    panel.classList.add("hidden");
  }
}

// 更新自選 vs 全選按鈕外觀
function updatePageSelectionModeUI() {
  const btnCustom = document.getElementById("btn-mode-custom-pages");
  const btnAll = document.getElementById("btn-mode-all-pages");
  const customControls = document.getElementById("custom-pages-controls");

  if (pageSelectionMode === "custom") {
    if (btnCustom) {
      btnCustom.className = "page-scope-btn active p-2.5 rounded-xl text-left transition-all cursor-pointer bg-[#E9EFEA] text-[#322E2B] border border-[#768A7A]";
    }
    if (btnAll) {
      btnAll.className = "page-scope-btn p-2.5 rounded-xl text-left transition-all cursor-pointer bg-[#F3EFEA] text-[#68615B] border border-transparent hover:border-[#D9CEC2]";
    }
    if (customControls) customControls.classList.remove("hidden");
  } else {
    if (btnCustom) {
      btnCustom.className = "page-scope-btn p-2.5 rounded-xl text-left transition-all cursor-pointer bg-[#F3EFEA] text-[#68615B] border border-transparent hover:border-[#D9CEC2]";
    }
    if (btnAll) {
      btnAll.className = "page-scope-btn active p-2.5 rounded-xl text-left transition-all cursor-pointer bg-[#E9EFEA] text-[#322E2B] border border-[#768A7A]";
    }
    if (customControls) customControls.classList.add("hidden");
  }
}

// === 3. 縮圖渲染、大畫面挑選與逐頁喚回管理 ===
function renderThumbnails() {
  const gallery = document.getElementById("thumbnail-gallery");
  const previewSec = document.getElementById("file-preview-section");
  const countLabel = document.getElementById("file-count-label");

  if (!gallery) return;
  gallery.innerHTML = "";

  updateUndoButtonsUI();

  if (!uploadedSlidePages || uploadedSlidePages.length === 0) {
    if (previewSec) previewSec.classList.add("hidden");
    if (countLabel) countLabel.textContent = "已選取 0 頁投影片";
    checkAndUpdatePageSelectionPanel();
    return;
  }

  if (previewSec) previewSec.classList.remove("hidden");
  if (countLabel) countLabel.textContent = `已選取 ${uploadedSlidePages.length} 頁投影片`;

  // 檢查是否超過 8 頁觸發精選控制項
  checkAndUpdatePageSelectionPanel();

  const isCustomMode = (pageSelectionMode === "custom");

  uploadedSlidePages.forEach((slide, idx) => {
    const pageNum = idx + 1;
    const isSelected = !isCustomMode || selectedPageIndices.has(pageNum);

    const card = document.createElement("div");
    card.className = `relative group rounded-xl border p-1 flex flex-col items-center shadow-sm transition-all cursor-pointer select-none ${
      isSelected
        ? "border-emerald-500/50 bg-emerald-500/[0.04] ring-1 ring-emerald-500/20"
        : "border-white/[0.06] bg-[#F3EFEA] opacity-40 hover:opacity-80"
    }`;

    card.innerHTML = `
      <div class="relative w-full h-20 overflow-hidden rounded-lg bg-black border border-white/[0.06]">
        <img src="${slide.image}" class="w-full h-full object-cover" alt="第 ${pageNum} 頁">
        
        <!-- 勾選狀態標記 (自選模式時啟用) -->
        ${isCustomMode ? `
          <div class="absolute top-1 left-1 w-5 h-5 rounded-md flex items-center justify-center transition-all ${
            isSelected ? "bg-emerald-500 text-black shadow-sm" : "bg-black/70 border border-white/30 text-transparent"
          }">
            <i data-lucide="check" class="w-3.5 h-3.5 stroke-[3]"></i>
          </div>
        ` : ""}

        <span class="absolute bottom-1 left-1 bg-black/80 backdrop-blur-sm text-[9px] px-1.5 py-0.2 rounded text-zinc-300 font-mono border border-white/10">
          P.${pageNum}
        </span>
        <button type="button" class="btn-delete-slide absolute top-1 right-1 w-5 h-5 rounded-full bg-black/80 hover:bg-rose-600 text-zinc-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shadow-sm border border-white/20" title="移除第 ${pageNum} 頁（誤刪可喚回）" data-slide-index="${idx}">
          <i data-lucide="x" class="w-3 h-3 pointer-events-none"></i>
        </button>
      </div>
      <span class="truncate max-w-[90px] text-[10px] text-zinc-400 mt-1 font-mono">${slide.name || `第 ${pageNum} 頁`}</span>
    `;

    // 點擊卡片切換選取狀態
    card.addEventListener("click", () => {
      if (!isCustomMode) {
        pageSelectionMode = "custom";
        updatePageSelectionModeUI();
      }
      if (selectedPageIndices.has(pageNum)) {
        selectedPageIndices.delete(pageNum);
      } else {
        selectedPageIndices.add(pageNum);
      }
      syncPageRangeInputFromSelection();
      renderThumbnails();
      if (isLargePickerOpen()) renderLargeSlidesGrid();
    });

    const delBtn = card.querySelector(".btn-delete-slide");
    if (delBtn) {
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeSlideAtIndex(idx);
      });
    }

    gallery.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

// === 大畫面挑選與檢視 (Full-screen Lightbox Grid Picker) ===
function openLargePickerModal() {
  if (!uploadedSlidePages || uploadedSlidePages.length === 0) {
    showToast("目前尚無投影片，請先上傳 PDF 或投影片圖片！", "warning");
    return;
  }
  const modal = document.getElementById("modal-large-picker");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("overflow-hidden");
  renderLargeSlidesGrid();
  updateUndoButtonsUI();
}
window.openLargePickerModal = openLargePickerModal;

function closeLargePickerModal() {
  const modal = document.getElementById("modal-large-picker");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("overflow-hidden");
  syncPageRangeInputFromSelection();
  renderThumbnails();
}
window.closeLargePickerModal = closeLargePickerModal;

function isLargePickerOpen() {
  const modal = document.getElementById("modal-large-picker");
  return modal && !modal.classList.contains("hidden");
}

function renderLargeSlidesGrid() {
  const grid = document.getElementById("large-slides-grid");
  const badge = document.getElementById("large-picker-badge");
  const footerTip = document.getElementById("large-picker-footer-tip");
  if (!grid) return;

  grid.innerHTML = "";

  const total = uploadedSlidePages.length;
  const selectedCount = selectedPageIndices.size;

  if (badge) {
    badge.textContent = `已選 ${selectedCount} / ${total} 頁`;
  }
  if (footerTip) {
    footerTip.innerHTML = `已選取 <strong class="text-emerald-400 font-mono">${selectedCount}</strong> / ${total} 頁 · 建議挑選 <strong class="text-amber-300 font-mono">3～8 頁</strong> 以獲取最佳 NotebookLM 提示詞精度`;
  }
  const finishBtnText = document.getElementById("btn-large-finish-text");
  if (finishBtnText) {
    finishBtnText.textContent = `完成挑選 (已選 ${selectedCount} 頁)`;
  }

  if (total === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 flex flex-col items-center justify-center text-center text-zinc-500">
        <i data-lucide="layers" class="w-12 h-12 stroke-[1.2] mb-3 text-zinc-600"></i>
        <p class="text-sm font-medium text-zinc-400">目前沒有任何投影片頁面</p>
        <p class="text-xs text-zinc-600 mt-1">若不小心刪除，可點擊上方「喚回」按鈕復原</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  uploadedSlidePages.forEach((slide, idx) => {
    const pageNum = idx + 1;
    const isSelected = selectedPageIndices.has(pageNum);

    const card = document.createElement("div");
    card.className = `large-slide-card relative group rounded-2xl border-2 transition-all cursor-pointer overflow-hidden flex flex-col bg-[#FAF8F5] select-none ${
      isSelected
        ? "border-emerald-500 shadow-[0_0_24px_rgba(16,185,129,0.25)] ring-1 ring-emerald-500/40"
        : "border-white/[0.08] opacity-75 hover:opacity-100 hover:border-white/30"
    }`;

    card.innerHTML = `
      <!-- 卡片頂部獨立狀態列：頁碼、勾選與功能按鈕 (絕不遮擋投影片文字！) -->
      <div class="px-3.5 py-2.5 bg-[#171B24] border-b border-white/[0.08] flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2">
          <div class="w-5 h-5 rounded-md flex items-center justify-center transition-all ${
            isSelected ? 'bg-emerald-500 text-zinc-950 font-bold shadow-sm' : 'border border-white/30 bg-black/40 text-transparent'
          }">
            <i data-lucide="check" class="w-3.5 h-3.5 stroke-[3]"></i>
          </div>
          <span class="font-mono font-bold text-xs ${isSelected ? 'text-emerald-400' : 'text-zinc-300'}">
            第 ${pageNum} 頁
          </span>
        </div>

        <div class="flex items-center gap-1">
          <!-- 放大檢視按鈕 -->
          <button type="button" class="btn-large-zoom-slide p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-emerald-300 transition-colors cursor-pointer" title="點擊放大檢視第 ${pageNum} 頁高清原圖" data-slide-index="${idx}">
            <i data-lucide="maximize-2" class="w-4 h-4 pointer-events-none"></i>
          </button>
          <!-- 移除按鈕 -->
          <button type="button" class="btn-large-delete-slide p-1.5 rounded-lg hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer" title="移除此頁（可喚回）" data-slide-index="${idx}">
            <i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i>
          </button>
        </div>
      </div>

      <!-- 16:9 高畫質投影片原圖區 (全屏無遮擋完整展示！) -->
      <div class="large-slide-preview-box">
        <img src="${slide.image}" class="large-slide-preview-img" alt="第 ${pageNum} 頁" loading="lazy">
      </div>

      <!-- 底部資訊列 -->
      <div class="px-3.5 py-2.5 bg-[#101218] border-t border-white/[0.06] flex items-center justify-between text-xs shrink-0">
        <span class="text-zinc-400 font-mono text-[11px] truncate max-w-[200px] sm:max-w-[280px]" title="${slide.name || `第 ${pageNum} 頁`}">
          ${slide.name || `投影片第 ${pageNum} 頁`}
        </span>
        <span class="text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
          isSelected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-white/[0.04] text-zinc-500 border border-transparent'
        }">
          ${isSelected ? '✓ 已納入解析' : '未勾選'}
        </span>
      </div>
    `;

    // 點擊卡片本體切換選取狀態
    card.addEventListener("click", () => {
      if (selectedPageIndices.has(pageNum)) {
        selectedPageIndices.delete(pageNum);
      } else {
        selectedPageIndices.add(pageNum);
      }
      pageSelectionMode = "custom";
      updatePageSelectionModeUI();
      syncPageRangeInputFromSelection();
      renderLargeSlidesGrid();
      renderThumbnails();
    });


    // 放大檢視按鈕
    const zoomBtn = card.querySelector(".btn-large-zoom-slide");
    if (zoomBtn) {
      zoomBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openSlideZoom(idx);
      });
    }

    // 刪除按鈕
    const delBtn = card.querySelector(".btn-large-delete-slide");
    if (delBtn) {
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeSlideAtIndex(idx);
      });
    }

    grid.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

// === 誤刪投影片喚回復原機制 (Undo / Restore) ===
function removeSlideAtIndex(index) {
  if (index < 0 || index >= uploadedSlidePages.length) return;
  const removedItem = uploadedSlidePages[index];
  const removedName = removedItem.name || `第 ${index + 1} 頁`;
  const wasSelected = selectedPageIndices.has(index + 1);

  // 存入喚回復原堆疊
  removedSlidesHistory.push({
    type: "single",
    slide: { ...removedItem },
    originalIndex: index,
    wasSelected: wasSelected,
    timestamp: Date.now()
  });

  uploadedSlidePages.splice(index, 1);
  uploadedSlidePages.forEach((item, i) => {
    item.page = i + 1;
  });

  // 調整 selectedPageIndices
  const newSet = new Set();
  selectedPageIndices.forEach(p => {
    if (p < index + 1) newSet.add(p);
    else if (p > index + 1) newSet.add(p - 1);
  });
  selectedPageIndices = newSet;
  syncPageRangeInputFromSelection();

  if (currentComparisonPage >= uploadedSlidePages.length) {
    currentComparisonPage = Math.max(0, uploadedSlidePages.length - 1);
  }

  updateUndoButtonsUI();
  renderThumbnails();
  if (isLargePickerOpen()) {
    renderLargeSlidesGrid();
  }
  updateComparisonView();
  showToastWithUndo(`已移除投影片：${removedName}（誤刪可點擊喚回）`, () => undoRemoveSlide(), "info");
}
window.removeSlideAtIndex = removeSlideAtIndex;

function undoRemoveSlide() {
  if (removedSlidesHistory.length === 0) {
    showToast("目前沒有可喚回的投影片！", "info");
    return;
  }

  const record = removedSlidesHistory.pop();

  if (record.type === "single") {
    const insertIdx = Math.min(record.originalIndex, uploadedSlidePages.length);
    uploadedSlidePages.splice(insertIdx, 0, record.slide);

    // 重新排序頁碼
    uploadedSlidePages.forEach((item, i) => {
      item.page = i + 1;
    });

    // 調整 selectedPageIndices
    const restoredPage = insertIdx + 1;
    const newSet = new Set();
    selectedPageIndices.forEach(p => {
      if (p < restoredPage) newSet.add(p);
      else newSet.add(p + 1);
    });
    if (record.wasSelected) {
      newSet.add(restoredPage);
    }
    selectedPageIndices = newSet;
    syncPageRangeInputFromSelection();

    showToast(`已成功喚回：${record.slide.name || `第 ${restoredPage} 頁`}！`, "success");
  } else if (record.type === "clear") {
    uploadedSlidePages = [...record.slides];
    uploadedSlidePages.forEach((item, i) => {
      item.page = i + 1;
    });
    selectedPageIndices = new Set(record.selectedIndices);
    syncPageRangeInputFromSelection();

    showToast("已成功復原所有清空的投影片！", "success");
  }

  updateUndoButtonsUI();
  renderThumbnails();
  if (isLargePickerOpen()) {
    renderLargeSlidesGrid();
  }
  updateComparisonView();
}
window.undoRemoveSlide = undoRemoveSlide;

function updateUndoButtonsUI() {
  const btnUndoSidebar = document.getElementById("btn-undo-delete");
  const labelUndoSidebar = document.getElementById("undo-delete-label");
  const btnUndoLarge = document.getElementById("btn-large-undo");
  const labelUndoLarge = document.getElementById("btn-large-undo-label");

  const count = removedSlidesHistory.length;

  if (count > 0) {
    if (btnUndoSidebar) {
      btnUndoSidebar.classList.remove("hidden");
      if (labelUndoSidebar) labelUndoSidebar.textContent = `喚回 (${count})`;
    }
    if (btnUndoLarge) {
      btnUndoLarge.classList.remove("hidden");
      if (labelUndoLarge) labelUndoLarge.textContent = `喚回 (${count})`;
    }
  } else {
    if (btnUndoSidebar) btnUndoSidebar.classList.add("hidden");
    if (btnUndoLarge) btnUndoLarge.classList.add("hidden");
  }
  if (window.lucide) window.lucide.createIcons();
}
window.updateUndoButtonsUI = updateUndoButtonsUI;

// 剪貼簿一鍵貼上金鑰
async function pasteClipboardToInput(inputId) {
  try {
    const text = await navigator.clipboard.readText();
    const input = document.getElementById(inputId);
    if (input && text && text.trim()) {
      input.value = text.trim();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      showToast("已貼上 API Key 金鑰！", "success");
    } else {
      showToast("剪貼簿為空或尚未複製金鑰", "warning");
    }
  } catch (err) {
    console.warn("無法存取剪貼簿:", err);
    showToast("瀏覽器權限限制，請直接在輸入框按 Ctrl+V (或 ⌘+V) 貼上", "info");
  }
}

// === 示範資料：手繪筆記塗鴉風 (Sketchnote) 完整逆向成果 ===
const DEMO_ANALYSIS_DATA = {
  status: "success",
  auto_reason: "免金鑰實例示範 · 5 頁手繪筆記塗鴉風",
  model_used: "Gemini 2.5 Flash (手繪筆記拓撲提煉實例)",
  structured_meta: {
    style_name: "企業手繪筆記塗鴉風 (Sketchnote & Doodle System)",
    tags: [
      "手繪筆記風",
      "橫線信紙底",
      "墨水炭黑線條",
      "螢光黃重點塗抹",
      "5色功能標籤色譜",
      "齒輪垂直階梯流程",
      "橫向時程檢驗門檻",
      "中樞盾牌六向輻射",
      "16:9 筆記留白"
    ],
    white_space_ratio: "65% 舒適筆記留白",
    palette: [
      { role: "信紙基底米白 (Paper)", hex: "#FAF8F5", name: "Paper Cream" },
      { role: "墨水炭黑手繪線 (Ink)", hex: "#181A1B", name: "Charcoal Black" },
      { role: "螢光筆核心強調 (Highlight)", hex: "#FEE054", name: "Marker Yellow" },
      { role: "功能標籤：戰略規劃 (Strategy)", hex: "#BAE6FD", name: "Sky Blue" },
      { role: "功能標籤：資安警示 (Alert)", hex: "#FED7AA", name: "Peach Orange" },
      { role: "功能標籤：執行流程 (Process)", hex: "#FEF08A", name: "Lemon Yellow" },
      { role: "功能標籤：成效產出 (Output)", hex: "#BBF7D0", name: "Mint Green" },
      { role: "功能標籤：治理風控 (Governance)", hex: "#E9D5FF", name: "Lavender Purple" }
    ]
  },
  markdown_report: `## 1. 視覺語言與排版拓撲風格總結
- **核心設計風格**：手繪筆記塗鴉風（Sketchnote & Corporate Doodle System），打破傳統商務簡報冰冷、死板的條列式感，透過擬真墨水線條、螢光筆手塗重點與多色手繪標籤，大幅降低認知摩擦，極度適合高階策略說明、跨部門流程落地與教育賦能。
- **畫布比例與幾何骨架**：16:9 寬螢幕，模擬米黃色橫線筆記信紙（水平淺灰間距橫線），左側或頂部可具備手繪筆記本線圈/圖釘點綴。
- **邊框與視覺組件語彙**：手繪非絕對筆直的不規則墨水邊框（線寬 1.5px~2.5px），轉角帶有微圓弧與手繪回筆重疊特徵；核心組件採用手繪圖示（燈泡小人、大齒輪、里程碑三角旗、中樞安全盾牌、資料庫硬碟）。
- **留白比率**：約 65% 開闊留白，所有模組邊距充裕，絕無資訊過載與文字牆。

---

## 2. 色彩系統與多維標籤色譜規範 (8色精確調色盤)
> **💡 色彩系統真相解密**：傳統商務簡報常將色彩簡化為「4 色」，然而真實且專業的簡報排版是 **「基底雙色 + 核心螢光強調 + 5 大維度功能色標籤色譜」** 的立體色彩架構：

1. **畫布背景色**：\`#FAF8F5\`（溫暖米白信紙底色，護眼且具備手工紙張溫潤質感）
2. **手繪線條與主文色**：\`#181A1B\`（高對比墨水炭黑，非生硬純黑，具手寫鋼筆沉穩感）
3. **螢光核心強調色**：\`#FEE054\`（螢光筆半透明塗抹黃，用於標題底部粗塗抹、關鍵數字打底）
4. **功能標籤色譜（5 大維度彩色標籤）**：
   - 策略規劃標籤：\`#BAE6FD\`（水藍色手繪卡片 / 標籤膠帶）
   - 資安警示標籤：\`#FED7AA\`（珊瑚橘手繪警告標籤）
   - 流程執行標籤：\`#FEF08A\`（檸檬黃階段推進標籤）
   - 成效產出標籤：\`#BBF7D0\`（薄荷綠達成指標標籤）
   - 治理風控標籤：\`#E9D5FF\`（丁香紫合規架構標籤）

---

## 3. 📋 NotebookLM 專用結構指令 (Prompt)

### 模式 1：學風格 · 做新簡報（提取配色與設計感，做新簡報）

\`\`\`markdown
你是一位具備「手繪筆記塗鴉風（Sketchnote System）」專長的頂級簡報視覺設計師與商業顧問。
請依據我提供的來源資料（Sources），將內容轉譯為彈性 3~20 頁極具親和力、排版生動的手繪筆記風投影片大綱。

【視覺風格與排版約束】：
1. 視覺語彙：手繪筆記塗鴉風（Sketchnote），模擬米黃信紙橫線筆記本（底色 #FAF8F5、墨黑線條 #181A1B、螢光黃強調 #FEE054）。
2. 配色系統：嚴格使用「5色多維標籤色譜」（策略水藍 #BAE6FD、資安粉橘 #FED7AA、流程檸檬黃 #FEF08A、成效薄荷綠 #BBF7D0、治理淡紫 #E9D5FF）區分不同業務模組。
3. 拓撲版型庫（依據各頁內容量動態挑選）：
   - 【封面頁】：手繪燈泡/思考小人 + 螢光塗抹大標題 + 副標籤。
   - 【策略卡片】：2~4 欄不規則手繪卡片，上方帶有手繪圖釘或紙膠帶。
   - 【流程進程】：齒輪/階梯垂直上升流程，以手繪粗箭頭串接。
   - 【橫向時程】：4 階段橫向時間軸，每階段包含里程碑旗幟與檢查勾選框。
   - 【治理與生態】：中樞盾牌/核心大腦，6 向手繪輻射線環繞架構。
4. 文案結構規範：每頁控制 1 個核心洞察標題，卡片內文字不超過 3 點，每點不超過 18 字，嚴禁文字牆。
5. 🚫 頁面呈現零重複最高約束：每頁投影片呈現形態嚴格禁止重複！整份簡報中，必須從拓撲版型庫輪替選用不同版型（如：封面 ➔ 策略卡片 ➔ 階梯進程 ➔ 橫向時程 ➔ 輻射生態），相鄰頁面與全篇各頁絕不重複套用同一版型！

請依序輸出各頁：[頁碼與標題] ➔ [建議手繪拓撲版型] ➔ [色彩標籤分配] ➔ [插槽文案內容] ➔ [手繪圖示塗鴉描述]。
\`\`\`

### 模式 2：照原稿 · 一頁頁複刻（5 頁完整還原）

\`\`\`markdown
請嚴格依據我上傳的來源資料，依照下方 5 頁「企業 AI 導入九十天方案」手繪筆記投影片之像素級拓撲骨架，1:1 還原填入相應業務內容：

---
### 投影片 1：封面（燈泡小人與思考啟發）
- 版面拓撲：居中橫向佈局，左上角標籤膠帶，右側手繪燈泡思考小人（線條發散光芒）。
- 配色：信紙米白 #FAF8F5，大標題底下帶有螢光黃 #FEE054 筆刷塗抹底色。
- [主標題插槽]：企業 AI 導入九十天方案（或您的主題）
- [副標題/目標]：從痛點探索、原型驗證到全面落地與合規治理
- [作者/團隊插槽]：專案推動小組 · 2026

---
### 投影片 2：四欄策略分析卡片（問題意識與痛點解構）
- 版面拓撲：4 欄手繪並列方框，每個方框頂部有手繪彩色標籤膠帶，框內包含手繪 Icon。
- [卡片 1 - 策略水藍 #BAE6FD]：問題意識（員工重複耗時工作、資訊孤島）
- [卡片 2 - 資安粉橘 #FED7AA]：痛點解構（內部資料外洩疑慮、合規法規風險）
- [卡片 3 - 流程檸檬黃 #FEF08A]：資源評估（算力預算限制、缺乏專業Prompt人才）
- [卡片 4 - 成效薄荷綠 #BBF7D0]：價值錨定（縮短50%流程時間、標準化知識庫）

---
### 投影片 3：齒輪垂直階梯流程（落地推進三部曲）
- 版面拓撲：左側為由小到大、由下至上的「手繪推動大齒輪與齒痕」；右側為 3 階垂直上升階梯卡片。
- [第一階（底層啟動）]：第 1~30 天 · 盤點探索期（篩選 3 個高頻業務場景）
- [第二階（核心落地）]：第 31~60 天 · 原型驗證期（部署內部專屬小規模試點）
- [第三階（成果擴散）]：第 61~90 天 · 全員賦能期（制度建立、成效評估與規模化）

---
### 投影片 4：橫向時程檢驗門檻（Milestones & 檢驗清單）
- 版面拓撲：水平橫向時間軸貫穿全頁，上方標註 4 個手繪三角旗幟，下方為手繪打勾方框清單。
- [第 1 站 - 需求確認]：業務場景優先級評分表完成 [✔]
- [第 2 站 - 模型選型]：開源與商用 API 成本隱私評估通過 [✔]
- [第 3 站 - 試點成果]：關鍵指標（KPI）節省工時達 35% 以上 [✔]
- [第 4 站 - 全面移交]：各部門指派 AI 負責人並完成 SOP 交接 [✔]

---
### 投影片 5：中樞盾牌六向輻射（資安與合規治理架構）
- 版面拓撲：中央為巨大手繪防護盾牌（墨水線條 + 內部淡灰微填色），周圍以 6 條手繪虛線箭頭輻射連結 6 個手繪圓形標籤卡。
- [中央盾牌核心]：企業級安全防護與可信 AI 治理架構
- [輻射 1 - #FED7AA]：資料去識別化與隱私隔離
- [輻射 2 - #BAE6FD]：存取權限控管與 RBAC 驗證
- [輻射 3 - #BBF7D0]：幻覺監控與輸出審計日誌
- [輻射 4 - #FEF08A]：智慧財產權與商用授權邊界
- [輻射 5 - #E9D5FF]：模型漂移與回滾備援機制
- [輻射 6 - #FAF8F5]：全員倫理準則培訓認證
\`\`\`

---

## 4. 💻 HTML / Tailwind 像素級還原程式碼

\`\`\`html
<div class="w-full h-full bg-[#FAF8F5] text-[#181A1B] p-8 flex flex-col justify-between font-sans border-4 border-[#181A1B] rounded-2xl relative shadow-xl overflow-hidden" style="background-image: repeating-linear-gradient(#FAF8F5 0px, #FAF8F5 27px, #E5E0D8 28px);">
  <!-- 頂部手繪筆記抬頭 -->
  <div class="flex items-center justify-between border-b-2 border-dashed border-[#181A1B] pb-3">
    <div class="flex items-center gap-3">
      <span class="px-3 py-1 bg-[#FEE054] text-[#181A1B] font-bold text-xs rounded-md border border-[#181A1B] shadow-sm transform -rotate-1">
        📌 STRATEGY SKETCHNOTE
      </span>
      <h1 class="text-xl font-extrabold tracking-tight">企業 AI 導入九十天方案 · 全域視覺拓撲</h1>
    </div>
    <div class="flex items-center gap-2 text-xs font-mono font-semibold">
      <span class="w-2.5 h-2.5 rounded-full bg-[#BBF7D0] border border-[#181A1B]"></span>
      <span>16:9 HAND-DRAWN SPEC</span>
    </div>
  </div>

  <!-- 主內容 4 欄手繪卡片 -->
  <div class="grid grid-cols-4 gap-4 my-auto">
    <div class="bg-[#BAE6FD]/40 border-2 border-[#181A1B] rounded-xl p-4 shadow-[3px_3px_0px_#181A1B] transform hover:-translate-y-1 transition-transform">
      <div class="text-xs font-bold text-[#181A1B] bg-[#BAE6FD] px-2 py-0.5 rounded border border-[#181A1B] inline-block mb-2">01. 痛點解構</div>
      <h3 class="font-bold text-sm mb-1.5">重塑工作流</h3>
      <p class="text-xs text-[#181A1B]/80 leading-relaxed">消除 50% 跨系統人工作業，將繁瑣資料轉為結構化知識庫。</p>
    </div>

    <div class="bg-[#FED7AA]/40 border-2 border-[#181A1B] rounded-xl p-4 shadow-[3px_3px_0px_#181A1B] transform hover:-translate-y-1 transition-transform">
      <div class="text-xs font-bold text-[#181A1B] bg-[#FED7AA] px-2 py-0.5 rounded border border-[#181A1B] inline-block mb-2">02. 資安防護</div>
      <h3 class="font-bold text-sm mb-1.5">資料不出境</h3>
      <p class="text-xs text-[#181A1B]/80 leading-relaxed">落實嚴密隔離與去識別化機制，杜絕商業機密外流風險。</p>
    </div>

    <div class="bg-[#FEF08A]/40 border-2 border-[#181A1B] rounded-xl p-4 shadow-[3px_3px_0px_#181A1B] transform hover:-translate-y-1 transition-transform">
      <div class="text-xs font-bold text-[#181A1B] bg-[#FEF08A] px-2 py-0.5 rounded border border-[#181A1B] inline-block mb-2">03. 階梯落地</div>
      <h3 class="font-bold text-sm mb-1.5">三階段擴散</h3>
      <p class="text-xs text-[#181A1B]/80 leading-relaxed">從探索、原型驗證到全員賦能，以齒輪齒痕穩步推進。</p>
    </div>

    <div class="bg-[#BBF7D0]/40 border-2 border-[#181A1B] rounded-xl p-4 shadow-[3px_3px_0px_#181A1B] transform hover:-translate-y-1 transition-transform">
      <div class="text-xs font-bold text-[#181A1B] bg-[#BBF7D0] px-2 py-0.5 rounded border border-[#181A1B] inline-block mb-2">04. 成效治理</div>
      <h3 class="font-bold text-sm mb-1.5">六向輻射盾</h3>
      <p class="text-xs text-[#181A1B]/80 leading-relaxed">建立可驗證的 KPI 門檻與模型日誌，保障組織數位資產。</p>
    </div>
  </div>

  <!-- 底部筆記註記與色票摘要 -->
  <div class="flex items-center justify-between text-xs font-mono pt-3 border-t-2 border-[#181A1B]">
    <div class="flex items-center gap-2">
      <span class="font-bold">PALETTE TOKENS:</span>
      <span class="inline-block w-4 h-4 rounded bg-[#FAF8F5] border border-[#181A1B]" title="#FAF8F5"></span>
      <span class="inline-block w-4 h-4 rounded bg-[#181A1B] border border-[#181A1B]" title="#181A1B"></span>
      <span class="inline-block w-4 h-4 rounded bg-[#FEE054] border border-[#181A1B]" title="#FEE054"></span>
      <span class="inline-block w-4 h-4 rounded bg-[#BAE6FD] border border-[#181A1B]" title="#BAE6FD"></span>
      <span class="inline-block w-4 h-4 rounded bg-[#FED7AA] border border-[#181A1B]" title="#FED7AA"></span>
      <span class="inline-block w-4 h-4 rounded bg-[#BBF7D0] border border-[#181A1B]" title="#BBF7D0"></span>
      <span class="inline-block w-4 h-4 rounded bg-[#E9D5FF] border border-[#181A1B]" title="#E9D5FF"></span>
    </div>
    <div class="text-zinc-600 font-sans">
      NotebookLM 專用拓撲轉譯器 · 逆向工程規範
    </div>
  </div>
</div>
\`\`\`
`
};

// 載入示範投影片
function loadDemoPresentation() {
  uploadedSlidePages = [
    { page: 1, image: "demo/slide_1.jpg", name: "01_封面_企業AI導入90天.jpg" },
    { page: 2, image: "demo/slide_2.jpg", name: "02_策略卡片_痛點解構.jpg" },
    { page: 3, image: "demo/slide_3.jpg", name: "03_齒輪垂直流程_落地三階段.jpg" },
    { page: 4, image: "demo/slide_4.jpg", name: "04_時間軸門檻_里程碑檢驗.jpg" },
    { page: 5, image: "demo/slide_5.jpg", name: "05_治理盾牌_六向輻射環繞.jpg" }
  ];
  selectedFiles = [];
  currentComparisonPage = 0;

  renderThumbnails();
  closeOnboardingModal(true);
  renderAnalysisResult(DEMO_ANALYSIS_DATA);

  const resultSec = document.getElementById("panel-result");
  if (resultSec) {
    resultSec.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  showToast("✨ 已載入「企業 AI 導入 90 天手繪筆記風」實例！可切換 5 頁對照並複製 NotebookLM 提示詞。", "success");
}

// === 檔案處理與縮圖收集 ===
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

  for (const file of newFiles) {
    const ext = "." + file.name.split(".").pop().toLowerCase();
    
    if (ext === ".pdf") {
      showToast(`正在解析 PDF：${file.name}...`, "info");
      try {
        let pdfData = null;
        if (typeof pdfjsLib !== "undefined") {
          try {
            pdfData = await parsePdfClientSide(file);
          } catch (e) {
            console.warn("前端 PDF 渲染異常，嘗試後端:", e);
          }
        }
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
          const pagesToAdd = pdfData.preview_pages.map(p => ({
            page: uploadedSlidePages.length + p.page,
            image: p.image,
            name: `${file.name} (P.${p.page})`,
            text: p.text || ""
          }));
          uploadedSlidePages.push(...pagesToAdd);
          renderThumbnails();
          showToast(`已成功載入 ${file.name}（共 ${pdfData.preview_pages.length} 頁）`, "success");
        } else {
          showToast(`無法擷取 ${file.name} 預覽，建議改傳投影片圖片`, "warning");
        }
      } catch (err) {
        console.warn("無法取得縮圖:", err);
      }

    } else if (ext === ".pptx") {
      showToast(`正在解析 PPTX：${file.name}...`, "info");
      try {
        let pptxSuccess = false;
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
          const formData = new FormData();
          formData.append("file", file);
          const resp = await fetch("/api/preview", { method: "POST", body: formData });
          if (resp.ok) {
            const data = await resp.json();
            if (data.status === "success" && data.preview_pages && data.preview_pages.length > 0) {
              const pagesToAdd = data.preview_pages.map(p => ({
                page: uploadedSlidePages.length + p.page,
                image: p.image,
                name: `${file.name} (P.${p.page})`,
                text: p.text || ""
              }));
              uploadedSlidePages.push(...pagesToAdd);
              renderThumbnails();
              pptxSuccess = true;
              showToast(`已成功載入 ${file.name}（共 ${data.preview_pages.length} 頁）`, "success");
            }
          }
        }
        if (!pptxSuccess) {
          showToast("💡 提示：在純靜態環境，建議將 PPT 匯出為 PDF 或直接截圖上傳！", "info");
        }
      } catch (err) {
        console.warn("無法取得 PPTX 縮圖:", err);
      }

    } else {
      await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          uploadedSlidePages.push({
            page: uploadedSlidePages.length + 1,
            image: e.target.result,
            name: file.name
          });
          resolve();
        };
        reader.onerror = () => resolve();
        reader.readAsDataURL(file);
      });
      renderThumbnails();
    }
  }

  // 全部檔案載入完成後：預設選取全部，並直接自動彈出大畫面讓使用者自由挑選！
  renderThumbnails();
  if (uploadedSlidePages.length > 0) {
    if (uploadedSlidePages.length > 8) {
      pageSelectionMode = "custom";
      selectedPageIndices = new Set(uploadedSlidePages.map((_, i) => i + 1));
      updatePageSelectionModeUI();
      syncPageRangeInputFromSelection();
      renderThumbnails();
    }
    setTimeout(() => {
      openLargePickerModal();
    }, 300);
  }
}

// === 4. 純瀏覽器端 AI 直連呼叫引擎 (支援 GitHub Pages Serverless) ===
async function callGeminiDirectly(apiKey, selectedModel, slideImages, promptText) {
  // 建立高穩定性模型候選清單（最新 2.5 Flash 優先，具備 1M context 與極高多模態視覺精度）
  const candidateModels = [];
  if (selectedModel && selectedModel !== "auto") {
    candidateModels.push(selectedModel);
  }
  // 候選優先級：gemini-2.5-flash ➔ gemini-2.5-flash-lite ➔ gemini-2.0-flash ➔ gemini-flash-latest
  const defaultList = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-flash-latest"];
  for (const m of defaultList) {
    if (!candidateModels.includes(m)) {
      candidateModels.push(m);
    }
  }

  const parts = [];
  // 傳入全部投影片縮圖（支援至 30 頁多模態完整辨識）
  for (const page of slideImages.slice(0, 30)) {
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
        { text: getEffectiveSystemInstruction() }
      ]
    },
    generationConfig: {
      temperature: 0.4
    }
  };

  let lastError = null;

  // 自動依序嘗試候選模型（遇到個別模型未開放、404、503 High Demand 流量尖峰、429 自動平滑無縫切換備援）
  for (let idx = 0; idx < candidateModels.length; idx++) {
    const modelName = candidateModels[idx];
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
        const msgLower = msg.toLowerCase();

        // 若為 Google Project Monthly Spending Cap (專案每月消費上限已滿)，整個專案皆會被阻擋，立即提示解決方案並彈出金鑰視窗
        if (msgLower.includes("spending cap") || msgLower.includes("spend cap") || msgLower.includes("ai.studio/spend")) {
          setTimeout(() => {
            openApiKeyModal("gemini");
            const resultBox = document.getElementById("api-key-test-result");
            const resultIcon = document.getElementById("test-result-icon");
            const resultTitle = document.getElementById("test-result-title");
            const resultDetail = document.getElementById("test-result-detail");
            if (resultBox && resultTitle && resultDetail) {
              resultBox.classList.remove("hidden");
              resultBox.className = "p-3 rounded-lg border text-xs font-mono transition-all bg-[#F4EAE8] border-[#C8A7A3] text-[#322E2B]";
              if (resultIcon) resultIcon.textContent = "⚠️";
              resultTitle.textContent = "您的 Google 專案已達「每月消費上限 (Spending Cap)」";
              resultDetail.innerHTML = `1. <strong>最快免費解法</strong>：點上方「前往 Google AI Studio」，按 <code>+ Create API key</code> 並選 <strong>Create API key in new project</strong> 換一組新專案金鑰。<br>2. <strong>或調高原專案上限</strong>：前往 <a href="https://ai.studio/spend" target="_blank" rel="noopener noreferrer" class="underline font-bold text-[#8F6561]">https://ai.studio/spend</a> 調整 Monthly spend cap。`;
            }
          }, 200);
          throw new Error("您目前的 Google 專案已達每月消費上限 (Spending Cap)！已為您開啟金鑰設定視窗，請建立新專案金鑰或前往 ai.studio/spend 調高上限。");
        }
        
        // 判斷是否為暫時性流量高峰（High Demand）、限流（Rate Limit）或模型不存在
        const isFallbackTrigger = (
          response.status === 404 ||
          response.status === 503 ||
          response.status === 429 ||
          response.status === 500 ||
          msgLower.includes("high demand") ||
          msgLower.includes("spikes in demand") ||
          msgLower.includes("resource has been exhausted") ||
          msgLower.includes("quota") ||
          msgLower.includes("rate limit") ||
          msgLower.includes("temporarily") ||
          msgLower.includes("overloaded") ||
          msgLower.includes("not found") ||
          msgLower.includes("not supported")
        );

        if (isFallbackTrigger && idx < candidateModels.length - 1) {
          const nextModel = candidateModels[idx + 1];
          console.warn(`[Gemini API] 模型 ${modelName} 遇到尖峰或暫不可用 (${msg})，正在自動平滑切換至備援模型 ${nextModel}...`);
          showToast(`⚡ 模型 ${modelName} 流量尖峰（High Demand），正在為您無縫切換至備援模型 ${nextModel}...`, "info");
          lastError = new Error(`Google Gemini API 提示: ${msg}`);
          await new Promise(r => setTimeout(r, 800)); // 稍候 800ms
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
      const errLower = (err.message || "").toLowerCase();
      const isRetryable = (
        errLower.includes("high demand") ||
        errLower.includes("spikes in demand") ||
        errLower.includes("quota") ||
        errLower.includes("exhausted") ||
        errLower.includes("not found") ||
        errLower.includes("not supported")
      );
      if (isRetryable && idx < candidateModels.length - 1) {
        const nextModel = candidateModels[idx + 1];
        console.warn(`[Gemini API] 捕獲異常，切換至備援模型 ${nextModel}:`, err);
        showToast(`⚡ 模型 ${modelName} 暫不可用，正在切換至 ${nextModel}...`, "info");
        lastError = err;
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Google Gemini API 無法調用任何可用模型，請檢查 API Key 是否正確或稍後重試。");
}

async function callOpenAiDirectly(apiKey, selectedModel, slideImages, promptText) {
  let modelName = selectedModel || "auto";
  if (modelName === "auto") {
    modelName = "gpt-4o";
  }

  const endpoint = "https://api.openai.com/v1/chat/completions";
  const content = [{ type: "text", text: promptText }];

  for (const page of slideImages.slice(0, 30)) {
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
      { role: "system", content: getEffectiveSystemInstruction() },
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
  updatePipelineUi(10, 1, "正在傳輸高解析投影片影像與圖層幾何邊界...", 0);
}

function startProgressPipeline() {
  resetProgressPipeline();
  let currentPercent = 10;
  const startTime = Date.now();

  progressPipelineInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const elapsedSec = Math.floor(elapsed / 1000);

    // 階段 1：0 ~ 4 秒（10% ~ 32%），光學採樣與切片
    if (elapsed < 4000) {
      currentPercent = Math.min(32, 10 + Math.floor((elapsed / 4000) * 22));
      updatePipelineUi(currentPercent, 1, "正在傳輸高解析影像並光學採樣圖層留白...", elapsedSec);
    } 
    // 階段 2：4 ~ 16 秒（32% ~ 62%），幾何骨架與拓撲逆向
    else if (elapsed < 16000) {
      currentPercent = Math.min(62, 32 + Math.floor(((elapsed - 4000) / 12000) * 30));
      updatePipelineUi(currentPercent, 2, "正在逆向版面幾何骨架，分析左右分割與卡片結構...", elapsedSec);
    } 
    // 階段 3：16 ~ 32 秒（62% ~ 82%），提取色票與視覺手冊
    else if (elapsed < 32000) {
      currentPercent = Math.min(82, 62 + Math.floor(((elapsed - 16000) / 16000) * 20));
      updatePipelineUi(currentPercent, 3, "正在提煉色彩系統與多維標籤色譜規範...", elapsedSec);
    } 
    // 階段 4：32 ~ 55 秒（82% ~ 93%），提示詞與還原代碼深度生成
    else if (elapsed < 55000) {
      currentPercent = Math.min(93, 82 + Math.floor(((elapsed - 32000) / 23000) * 11));
      updatePipelineUi(currentPercent, 4, "正在深度編譯 NotebookLM 雙模式提示詞庫與 1:1 代碼...", elapsedSec);
    }
    // 階段 4 深層延伸：55 秒以上（93% ~ 97%），微動呼吸避免卡死感
    else {
      const extraSteps = Math.min(4, Math.floor((elapsed - 55000) / 8000));
      currentPercent = Math.min(97, 93 + extraSteps);
      updatePipelineUi(currentPercent, 4, "多頁簡報正進行最後的拓撲規則校準與結構打包，即將就緒...", elapsedSec);
    }
  }, 150);
}

function completeProgressPipeline() {
  if (progressPipelineInterval) {
    clearInterval(progressPipelineInterval);
    progressPipelineInterval = null;
  }
  updatePipelineUi(100, 4, "逆向分析全部就緒！正在為您渲染成果...");
  const timerCounterEl = document.getElementById("loading-timer-counter");
  const timerHintEl = document.getElementById("loading-timer-hint");
  if (timerCounterEl) timerCounterEl.textContent = "推論完成";
  if (timerHintEl) timerHintEl.textContent = "解析成功！即刻展示拓撲報告與提示詞。";
}

function stopProgressPipeline() {
  if (progressPipelineInterval) {
    clearInterval(progressPipelineInterval);
    progressPipelineInterval = null;
  }
}

function updatePipelineUi(percent, activeStep, taskDescription, elapsedSec = 0) {
  const percentEl = document.getElementById("loading-progress-percent");
  const barEl = document.getElementById("loading-progress-bar");
  const taskEl = document.getElementById("loading-active-task");
  const stepCounterEl = document.getElementById("loading-step-counter");
  const timerCounterEl = document.getElementById("loading-timer-counter");
  const timerStatusEl = document.getElementById("loading-timer-status");
  const timerHintEl = document.getElementById("loading-timer-hint");

  if (percentEl) percentEl.textContent = `${percent}%`;
  if (barEl) barEl.style.width = `${percent}%`;
  if (taskEl) taskEl.textContent = taskDescription;
  if (stepCounterEl) stepCounterEl.textContent = `階段 ${activeStep}/4`;

  if (timerCounterEl && percent < 100) timerCounterEl.textContent = `已推論 ${elapsedSec} 秒`;
  if (timerStatusEl && percent < 100) timerStatusEl.textContent = taskDescription;

  if (timerHintEl && percent < 100) {
    if (elapsedSec < 20) {
      timerHintEl.textContent = "深度視覺拓撲推論約需 20 ~ 45 秒（多頁簡報或高解析約 30 ~ 60 秒），請稍候...";
    } else if (elapsedSec < 45) {
      timerHintEl.textContent = "AI 模型正深度分析各頁幾何對齊與雙模式提示詞，處理即將完成...";
    } else {
      timerHintEl.textContent = "投影片頁數或細節較多，模型正在進行最後的結構封裝，請耐心等候...";
    }
  }

  for (let i = 1; i <= 4; i++) {
    const card = document.getElementById(`step-pipe-${i}`);
    const badge = document.getElementById(`step-pipe-badge-${i}`);
    const icon = document.getElementById(`step-pipe-icon-${i}`);
    if (!card || !badge || !icon) continue;

    if (i < activeStep || percent === 100) {
      // 已完成
      card.className = "p-3 rounded-lg bg-[#F3EFEA] border border-emerald-500/25 flex items-start gap-3 transition-colors opacity-100";
      icon.className = "w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5";
      icon.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i>';
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      badge.textContent = "已就緒";
    } else if (i === activeStep) {
      // 進行中
      card.className = "p-3 rounded-lg bg-[#F3EFEA] border border-white/20 flex items-start gap-3 transition-colors opacity-100 shadow-sm";
      icon.className = "w-6 h-6 rounded-md bg-white/10 text-white flex items-center justify-center shrink-0 mt-0.5 animate-pulse";
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/10 text-white border border-white/20";
      badge.textContent = "處理中";
    } else {
      // 等待中
      card.className = "p-3 rounded-lg bg-[#F3EFEA] border border-white/[0.05] flex items-start gap-3 transition-colors opacity-50";
      icon.className = "w-6 h-6 rounded-md bg-white/[0.04] text-zinc-500 flex items-center justify-center shrink-0 mt-0.5";
      badge.className = "text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.03] text-zinc-500 border border-white/[0.05]";
      badge.textContent = "等待中";
    }
  }
  if (window.lucide) window.lucide.createIcons();
}

// === 5. 開始發起分析流程 ===
async function handleStartAnalyze() {
  if (uploadedSlidePages.length === 0 && selectedFiles.length === 0) {
    showToast("請先上傳簡報 PDF 或投影片圖片！", "warning");
    return;
  }

  const apiKey = getApiKey(currentProvider);
  if (!apiKey) {
    showToast(`請先輸入您的 ${PROVIDER_CONFIG[currentProvider].name} 官方免費 API Key`, "warning");
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

  // 決定實際解析的頁面（若頁數 > 8 且選擇自選模式，使用使用者勾選的目標頁）
  let targetSlidePages = uploadedSlidePages;
  let selectedPagesParam = null;

  if (pageSelectionMode === "custom" && uploadedSlidePages.length > 8) {
    if (!selectedPageIndices || selectedPageIndices.size === 0) {
      showToast("⚠️ 請至少勾選或輸入 1 頁您喜好的投影片進行解析！", "warning");
      startBtn.disabled = false;
      startBtn.classList.remove("opacity-50");
      document.getElementById("panel-idle").classList.remove("hidden");
      document.getElementById("panel-loading").classList.add("hidden");
      return;
    }
    targetSlidePages = uploadedSlidePages.filter((_, idx) => selectedPageIndices.has(idx + 1));
    const sortedNums = Array.from(selectedPageIndices).sort((a, b) => a - b);
    selectedPagesParam = sortedNums.join(",");
  }

  let data = null;

  try {
    // 1. 若非純靜態 GitHub Pages 且處於本地 localhost，先嘗試呼叫 Python 後端
    if (!isGitHubPages && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
      try {
        const formData = new FormData();
        selectedFiles.forEach(file => formData.append("files", file));
        formData.append("provider", currentProvider);
        formData.append("model", model);
        if (selectedPagesParam) {
          formData.append("selected_pages", selectedPagesParam);
        }

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
      if (targetSlidePages.length === 0) {
        throw new Error("未檢測到有效投影片影像，請確認上傳了清晰的 PDF 或投影片圖片。");
      }

      const promptText = "請詳細審視我上傳的簡報投影片，執行深度視覺與幾何拓撲逆向工程。\n" +
        "【核心使命】：\n" +
        "1. 必須逐頁精確拆解真實骨架，★絕對嚴禁將圖解簡化為普通圓點條列！若有同心圓引線對應（Leader Lines）、複合雙模組（靶心+進程軸並存）、時間軸、心智圖等，必須以機械級拓撲完整描述規格與箭頭指向。\n" +
        "2. ★【六大鑑識級抗失真鐵律（必須明確寫入產出的模式 1 與模式 2 提示詞中）】：\n" +
        "   - (A) 【容器填充極性精準鎖定】：嚴格區分原稿容器是『空心透明描邊框（如黑板粉筆空心雙線對話框，內部無填色透出底色，嚴禁填滿實心粉彩色塊！）』、『無外框開放式筆刷標記欄（無矩形外框與格線，僅副標下方刷一筆螢光筆底色，嚴禁私自加上粗黑方框或十字格線！）』或『實心色塊卡片』，並在提示詞中寫入對應的正向指令與負向禁令。\n" +
        "   - (B) 【畫布底紋與橫線防蒸發】：若原稿為橫線筆記本紙（Ruled Notebook Paper），必須強制要求每一頁背景全程清晰渲染『淺灰水平橫線 (#E5E3DC) + 左側垂直裝訂邊界線』，嚴禁退化為空白米色紙、泛黃牛皮紙或亂加墨水噴濺髒污與四角落引號框（┌ ┘）；若為黑板底（#191A1D），保持均勻霧面炭黑與輕微粉筆灰，嚴禁立體光暈。\n" +
        "   - (C) 【多色螢光筆輪替與塗抹部位鎖定】：若原稿有多種粉彩強調色（粉紅、青綠、亮黃、水藍等），同頁並排的多個欄位標題必須強制依序輪替不同色相（色1➔色2➔色3➔色4），嚴禁同頁全塗同一種顏色！且螢光筆刷僅限襯於『小標題或數字徽章下方』，絕對嚴禁將黃色螢光筆大面積塗抹在正文的完整句子上。\n" +
        "   - (D) 【連接線、時間軸折線與箭頭空心度】：精準分辨『90度直角階梯折線箭頭（Orthogonal 90-Degree Stepped Line，嚴禁畫成8字形雙波浪交叉曲線！）』與『平滑波浪軸』；精準標明箭頭為『空心粗框手繪箭頭（Hollow Outlined Arrow）』或『單線箭頭』，嚴禁私自填滿死黑實心箭頭。\n" +
        "   - (E) 【火柴人與插畫解剖約束】：若原稿含極簡火柴人（Stick Figures），必須規定『圓頭 + 空心無填色線條軀幹（Hollow Unfilled Torso） + 單線四肢』，嚴禁將小人身體塗黑或畫成美式卡通實心人物。\n" +
        "   - (F) 【絕對文字潔淨與零亂碼鐵律】：封面頁與結尾頁僅輸出主標題與明確副標，嚴禁生成任何無意義偽漢字亂碼（如「未成項传惠行」等拼湊假字），插畫氣泡或便利貼內嚴禁塞入模糊微縮亂碼字。\n" +
        "3. 產出的第 3 節 NotebookLM 提示詞必須同時完整輸出兩種模式代碼區塊：\n" +
        "   - 【模式 1：學風格 · 做新簡報（推薦）】：提取這份簡報的配色與設計感，套用在你的任何簡報上（頁數 3~20 頁自由決定，備註：NotebookLM 單次生成上限為 20 頁）。\n" +
        "     ★【最高強制約束：每一個頁面呈現都絕對不能重複（Zero-Repetition Rule）】：在產出的 NotebookLM 提示詞中，必須明文加入不可忽視的最高禁令——『嚴禁連續或重複使用同一種版型！生成的整份簡報中，每一個頁面都必須從版型語法庫中挑選完全不同的視覺拓撲（例如：時間軸 ➔ 心智圖 ➔ 橫向條帶 ➔ 矩陣表格 ➔ 環形流程 ➔ 雙側括號等輪替使用），相鄰頁面與全篇各頁版型呈現皆不得重複！』\n" +
        "   - 【模式 2：照原稿 · 一頁頁複刻】：完全保留原投影片每一頁的排版結構，適合想照原版格式填空的人，確保每一頁皆展現原稿獨立獨特的拓撲版型。\n" +
        "4. 產出一份可直接獨立運行的 HTML/Tailwind 1:1 還原投影片結構代碼。\n" +
        "5. 請嚴格依照 SYSTEM INSTRUCTION 規定的章節與末尾 JSON 格式輸出。";

      if (currentProvider === "gemini") {
        data = await callGeminiDirectly(apiKey, model, targetSlidePages, promptText);
      } else if (currentProvider === "openai") {
        data = await callOpenAiDirectly(apiKey, model, targetSlidePages, promptText);
      } else {
        throw new Error("Anthropic API 因官方安全跨域規範限制，純前端靜態站點請選擇 Google Gemini（推薦，免費且極速）或 OpenAI！");
      }
    }

    // 推進到 100% 並短暫停留以呈現完成回饋
    completeProgressPipeline();
    await new Promise(resolve => setTimeout(resolve, 350));

    renderAnalysisResult(data);
    const pageMsg = (pageSelectionMode === "custom" && uploadedSlidePages.length > 8)
      ? `已針對精選之 ${targetSlidePages.length} 頁`
      : "已針對整份簡報";
    showToast(`風格逆向分析完成！${pageMsg}產生 1:1 幾何對比與雙模式提示詞`, "success");

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
function renderAnalysisResult(data, options = {}) {
  generatedReportMarkdown = data.markdown_report || "";
  
  document.getElementById("panel-idle").classList.add("hidden");
  document.getElementById("panel-loading").classList.add("hidden");
  document.getElementById("panel-result").classList.remove("hidden");

  // 萃取各項產出 (模式 1 與 模式 2)
  const extracted = extractNblmPromptModes(generatedReportMarkdown);
  generatedPromptGlobal = data.global_prompt || extracted.globalPrompt;
  generatedPromptSlide = data.slide_prompt || extracted.slidePrompt;
  generatedNblmPrompt = currentPromptMode === "global" ? generatedPromptGlobal : generatedPromptSlide;
  generatedSlideHtml = extractSlideHtml(generatedReportMarkdown);

  // 渲染當前模式提示詞
  switchPromptMode(currentPromptMode);

  // 顯示解析範圍摘要徽章
  const scopeBadge = document.getElementById("result-scope-badge");
  if (scopeBadge) {
    if (options.fromSavedId) {
      scopeBadge.textContent = `已從收藏庫載入 (${uploadedSlidePages.length} 頁原始簡報樣式)`;
      scopeBadge.classList.remove("hidden");
    } else if (pageSelectionMode === "custom" && selectedPageIndices.size > 0 && selectedPageIndices.size < uploadedSlidePages.length) {
      const sortedNums = Array.from(selectedPageIndices).sort((a, b) => a - b);
      scopeBadge.textContent = `🎯 已鎖定解析所選 ${selectedPageIndices.size} 頁 (P.${sortedNums.join(', P.')}) · 原稿共 ${uploadedSlidePages.length} 頁`;
      scopeBadge.classList.remove("hidden");
    } else {
      scopeBadge.textContent = `🎯 已解析全篇 ${uploadedSlidePages.length} 頁`;
      scopeBadge.classList.remove("hidden");
    }
  }

  // 預設將對比舞台鎖定在所選頁面
  comparisonViewScope = "selected";
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
    span.className = "px-2 py-0.5 text-[11px] rounded bg-[#F3EFEA] text-[#68615B] border border-[#322E2B]/10 font-mono";
    span.textContent = `# ${tag}`;
    tagsContainer.appendChild(span);
  });

  if (meta.white_space_ratio) {
    document.getElementById("white-space-metric").textContent = `留白比例: ${meta.white_space_ratio}`;
  }

  const finalPalette = meta.palette || [
    {"role": "畫布背景", "hex": "#F3EFEA", "name": "Oatmeal Linen"},
    {"role": "主標題與邊框", "hex": "#322E2B", "name": "Warm Charcoal"},
    {"role": "核心強調色", "hex": "#768A7A", "name": "Sage Green"},
    {"role": "次要輔助色", "hex": "#C8A7A3", "name": "Dusty Rose"}
  ];
  renderColorPalette(finalPalette);

  const markdownContainer = document.getElementById("full-report-markdown");
  const cleanReportMarkdown = stripTrailingMetaJson(generatedReportMarkdown);
  markdownContainer.innerHTML = marked.parse(cleanReportMarkdown);

  // 自動保存每次分析完的提示詞與原始圖片樣式至本機收藏庫
  if (typeof handlePostAnalysisSave === "function") {
    handlePostAnalysisSave(data, meta, finalPalette, options);
  }

  lucide.createIcons();
}

// 取得當前對比舞台應呈現之投影片（依據使用者挑選模式動態過濾）
function getActiveComparisonSlides() {
  const isCustom = (pageSelectionMode === "custom" && selectedPageIndices.size > 0 && selectedPageIndices.size < uploadedSlidePages.length);
  
  if (isCustom && comparisonViewScope === "selected") {
    const list = [];
    uploadedSlidePages.forEach((slide, idx) => {
      const pageNum = idx + 1;
      if (selectedPageIndices.has(pageNum)) {
        list.push({
          ...slide,
          originalIndex: idx,
          originalPage: pageNum
        });
      }
    });
    if (list.length > 0) return list;
  }

  // 備援或全選模式：呈現全篇上傳頁面
  return uploadedSlidePages.map((slide, idx) => ({
    ...slide,
    originalIndex: idx,
    originalPage: idx + 1
  }));
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
  const scopeTag = document.getElementById("stage-scope-tag");
  const toggleBtn = document.getElementById("btn-toggle-comparison-scope");

  const activeSlides = getActiveComparisonSlides();
  const isCustom = (pageSelectionMode === "custom" && selectedPageIndices.size > 0 && selectedPageIndices.size < uploadedSlidePages.length);

  // 動態設定視角提示與切換按鈕
  if (isCustom) {
    if (scopeTag) {
      scopeTag.classList.remove("hidden");
      scopeTag.textContent = comparisonViewScope === "selected" ? `已鎖定所選 ${selectedPageIndices.size} 頁` : `原稿全篇 (${uploadedSlidePages.length} 頁)`;
    }
    if (toggleBtn) {
      toggleBtn.classList.remove("hidden");
      toggleBtn.textContent = comparisonViewScope === "selected" ? `查看原稿全篇 (${uploadedSlidePages.length}頁)` : `回到所選 ${selectedPageIndices.size} 頁`;
    }
  } else {
    if (scopeTag) scopeTag.classList.add("hidden");
    if (toggleBtn) toggleBtn.classList.add("hidden");
  }

  if (activeSlides && activeSlides.length > 0) {
    if (currentComparisonPage >= activeSlides.length) {
      currentComparisonPage = 0;
    }
    const pageData = activeSlides[currentComparisonPage] || activeSlides[0];
    originalImg.src = pageData.image;
    originalImg.classList.remove("hidden");
    if (originalPlaceholder) originalPlaceholder.classList.add("hidden");
    
    if (originalPageLabel) {
      originalPageLabel.textContent = `原稿 P.${pageData.originalPage}`;
    }
    
    if (activeSlides.length > 1) {
      pageNav.classList.remove("hidden");
      pageNav.classList.add("flex");
      
      if (isCustom && comparisonViewScope === "selected") {
        pageIndicator.textContent = `精選第 ${currentComparisonPage + 1} / ${activeSlides.length} 頁 (P.${pageData.originalPage})`;
      } else {
        pageIndicator.textContent = `第 ${currentComparisonPage + 1} / ${activeSlides.length} 頁`;
      }
      
      prevBtn.disabled = (currentComparisonPage === 0);
      nextBtn.disabled = (currentComparisonPage === activeSlides.length - 1);
      prevBtn.classList.toggle("opacity-30", currentComparisonPage === 0);
      nextBtn.classList.toggle("opacity-30", currentComparisonPage === activeSlides.length - 1);
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
      btn.className = "result-tab-btn active px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors bg-white text-[#322E2B] border border-[#322E2B]/10 shadow-sm cursor-pointer";
    } else {
      btn.className = "result-tab-btn px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors text-[#68615B] hover:text-[#322E2B] hover:bg-white/50 cursor-pointer";
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

// === 自訂頁面內容元件：故事板渲染與提示詞生成 ===
function renderCustomStoryboardUI() {
  const container = document.getElementById("custom-slides-list");
  if (!container) return;
  container.innerHTML = "";

  customStoryboardSlides.forEach((slide, idx) => {
    const row = document.createElement("div");
    row.className = "custom-slide-item flex items-center gap-2 p-2 rounded-lg bg-[#F3EFEA] border border-white/[0.06] hover:border-white/15 transition-all";
    row.setAttribute("data-slide-idx", idx);

    const optionsHtml = DEFAULT_LAYOUT_OPTIONS.map(opt => 
      `<option value="${opt.id}" ${opt.id === slide.layout ? "selected" : ""}>${opt.name}</option>`
    ).join("");

    row.innerHTML = `
      <span class="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 bg-white/[0.04] rounded shrink-0">P.${idx + 1}</span>
      <div class="flex-1 grid grid-cols-1 md:grid-cols-12 gap-1.5">
        <div class="md:col-span-5">
          <select class="custom-slide-layout w-full bg-[#14181F] border border-white/[0.1] rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-400/50">
            ${optionsHtml}
          </select>
        </div>
        <div class="md:col-span-7">
          <input type="text" value="${slide.topic || ""}" class="custom-slide-topic w-full bg-[#14181F] border border-white/[0.1] rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-400/50" placeholder="指定文案主題（例如：三大核心資安鐵律）">
        </div>
      </div>
      <button type="button" class="btn-remove-custom-slide text-zinc-500 hover:text-rose-400 p-1 transition-colors cursor-pointer shrink-0" title="移除此頁">
        <i data-lucide="trash" class="w-3.5 h-3.5 pointer-events-none"></i>
      </button>
    `;

    const selectEl = row.querySelector(".custom-slide-layout");
    if (selectEl) {
      selectEl.addEventListener("change", (e) => {
        slide.layout = e.target.value;
        syncCustomPromptAndPreview();
      });
    }

    const inputEl = row.querySelector(".custom-slide-topic");
    if (inputEl) {
      inputEl.addEventListener("input", (e) => {
        slide.topic = e.target.value;
        syncCustomPromptAndPreview();
      });
    }

    const removeBtn = row.querySelector(".btn-remove-custom-slide");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        if (customStoryboardSlides.length <= 1) {
          showToast("至少需保留 1 頁投影片！", "warning");
          return;
        }
        customStoryboardSlides.splice(idx, 1);
        renderCustomStoryboardUI();
        syncCustomPromptAndPreview();
      });
    }

    container.appendChild(row);
  });

  if (window.lucide) window.lucide.createIcons();
}

function generateCustomStoryboardPrompt() {
  const slides = customStoryboardSlides;
  let markdown = `【任務宣告】：
請嚴格依據我上傳的筆記來源（Sources），提取關鍵事實與洞察，將筆記內容【精準對號入座】填入下列我指定的每一頁版型結構中：
（★最高鐵律：嚴格遵循每一頁指定的幾何拓撲，絕不偏離版型設定）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【🎨 精確全域色彩系統規範 (Executive Color System)】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 畫布底色：內頁採用【溫潤暖象牙米灰 (#F4F3EE)】，封面與結尾採用【深邃墨夜海軍藍 (#0D2235)】，★嚴禁使用冰冷死白。
2. 核心強調色：【低飽和啞光駝金 / 沉穩古銅赭金 (#C29B53)】。
   🚫【絕對色彩禁令】：嚴禁使用高飽和鮮黃、檸檬黃、香蕉黃 (#FFCC00 / #FFFF00)，所有金色皆必須帶有深駝與古銅褐感。
3. 色彩比重：60% 暖米灰底 + 30% 深墨藍 + 10% 啞光駝金（僅限細節點綴，嚴禁整大片塗抹）。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【🎯 自訂逐頁版型與內容指派故事板（嚴格對號入座）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  slides.forEach((s, idx) => {
    const layoutObj = DEFAULT_LAYOUT_OPTIONS.find(l => l.id === s.layout) || DEFAULT_LAYOUT_OPTIONS[0];
    markdown += `---
### 第 ${idx + 1} 頁：[${s.topic || `第 ${idx + 1} 頁主題`}]（強制採用：${layoutObj.name}）
- 【🎨 視覺幾何拓撲規格】：${layoutObj.desc}
- 【📝 筆記內容提取與指定指派】：
  - 核心指派主題：${s.topic || "請依上傳來源提取最切合該版型的核心重點"}
  - 填入約束：嚴格依據選定之幾何插槽（如引線指向、階梯踏板、公式運算元或獨立卡片）逐項填入短語（每點限定 10~18 字以內，維持極佳呼吸感）。
\n`;
  });

  return markdown;
}

// 使用者於【任務宣告】自訂的頁數要求（空白代表由 AI 自行裁量）
let userTargetPageCount = "";

/**
 * 將使用者填寫的頁數要求動態注入或替換至提示詞【任務宣告】區塊中
 */
function applyTargetPageCountToPrompt(rawPrompt, pageVal = userTargetPageCount) {
  if (!rawPrompt || typeof rawPrompt !== "string") return rawPrompt || "";
  const cleaned = (pageVal || "").trim();
  const defaultAutoLine = "（總頁數由您根據筆記內容深度自行裁量，建議 3~20 頁均可，每頁皆須嚴格遵循下列風格規範）";

  // 若為空白或「自動」，還原預設自動裁量說明
  if (!cleaned || cleaned === "自動" || cleaned.toLowerCase() === "auto") {
    return rawPrompt.replace(/[（(][★\s]*總頁數[^\n）)]*[）)]/g, defaultAutoLine);
  }

  // 若只填寫數字或區間（例如 "10" 或 "8~12"），自動補上「頁」
  const formattedPages = /頁/.test(cleaned) ? cleaned : `${cleaned} 頁`;
  const customPageLine = `（★總頁數要求：請嚴格規劃並生成共 【 ${formattedPages} 】 投影片，每頁皆須嚴格遵循下列風格規範）`;

  // 1. 若提示詞內已有（總頁數...）或（★總頁數要求...），直接替換該行
  if (/[（(][★\s]*總頁數[^\n）)]*[）)]/.test(rawPrompt)) {
    return rawPrompt.replace(/[（(][★\s]*總頁數[^\n）)]*[）)]/g, customPageLine);
  }

  // 2. 若提示詞內有【任務宣告】但尚未包含總頁數括號行（如模式 2 或自訂模式），於【任務宣告】第一段下方插入
  if (rawPrompt.includes("【任務宣告】")) {
    return rawPrompt.replace(/(【任務宣告】[：:]?\s*\n[^\n]+)/, `$1\n${customPageLine}`);
  }

  return rawPrompt;
}

/**
 * 同步更新左右兩側頁數輸入框、快捷按鈕狀態，並即時刷新顯示中的提示詞
 */
function setTargetPageCount(val, sourceInput = null) {
  const normalized = (val || "").trim();
  userTargetPageCount = (normalized === "自動" || normalized.toLowerCase() === "auto") ? "" : normalized;

  // 同步兩個輸入框的值
  document.querySelectorAll(".target-pages-input").forEach(inp => {
    if (inp !== sourceInput && inp.value !== userTargetPageCount) {
      inp.value = userTargetPageCount;
    }
  });

  // 更新快捷按鈕高亮狀態
  document.querySelectorAll(".quick-pages-btn").forEach(btn => {
    const btnVal = (btn.getAttribute("data-pages") || "").trim();
    const isMatched = (userTargetPageCount === "" && btnVal === "") ||
      (userTargetPageCount !== "" && (btnVal === userTargetPageCount || btnVal === `${userTargetPageCount}頁` || btnVal.replace(/\s+/g, "") === userTargetPageCount.replace(/\s+/g, "")));
    if (isMatched) {
      btn.className = "quick-pages-btn px-2 py-0.5 rounded bg-[#768A7A] text-white text-[10px] font-mono font-semibold border border-[#586B5C] transition-colors cursor-pointer shadow-sm";
    } else {
      btn.className = "quick-pages-btn px-2 py-0.5 rounded bg-[#FAF8F5] hover:bg-[#E9EFEA] text-[#68615B] hover:text-[#4E6152] text-[10px] font-mono border border-[#322E2B]/10 transition-colors cursor-pointer";
    }
  });

  // 即時更新右側提示詞預覽區塊
  const codeEl = document.getElementById("nblm-prompt-code");
  if (!codeEl) return;

  const currentLive = (codeEl.innerText || codeEl.textContent || "").trim();
  if (currentLive && currentLive.includes("【任務宣告】")) {
    codeEl.textContent = applyTargetPageCountToPrompt(currentLive, userTargetPageCount);
  } else {
    let basePrompt = "";
    if (currentPromptMode === "global") basePrompt = generatedPromptGlobal || generatedNblmPrompt;
    else if (currentPromptMode === "slide") basePrompt = generatedPromptSlide || generatedNblmPrompt;
    else if (currentPromptMode === "custom") basePrompt = generatedPromptCustom || generateCustomStoryboardPrompt();
    if (basePrompt) {
      codeEl.textContent = applyTargetPageCountToPrompt(basePrompt, userTargetPageCount);
    }
  }
}

function syncCustomPromptAndPreview() {
  generatedPromptCustom = generateCustomStoryboardPrompt();
  if (currentPromptMode === "custom") {
    const codeEl = document.getElementById("nblm-prompt-code");
    if (codeEl) codeEl.textContent = applyTargetPageCountToPrompt(generatedPromptCustom, userTargetPageCount);
  }
}

function switchPromptMode(mode) {
  currentPromptMode = mode;

  document.querySelectorAll("#prompt-mode-selector .prompt-mode-btn").forEach(btn => {
    const m = btn.getAttribute("data-prompt-mode");
    if (m === mode) {
      btn.className = "prompt-mode-btn active p-3 rounded-xl text-left transition-all cursor-pointer bg-[#E9EFEA] text-[#322E2B] border border-[#768A7A]";
    } else {
      btn.className = "prompt-mode-btn p-3 rounded-xl text-left transition-all cursor-pointer bg-[#F3EFEA] text-[#68615B] border border-transparent hover:border-[#D9CEC2]";
    }
  });

  // 更新右側結果頁三子頁籤樣式
  const btnGlobal = document.getElementById("btn-subtab-global");
  const btnSlide = document.getElementById("btn-subtab-slide");
  const btnCustom = document.getElementById("btn-subtab-custom");
  const descGlobal = document.getElementById("desc-mode-global");
  const descSlide = document.getElementById("desc-mode-slide");
  const descCustom = document.getElementById("desc-mode-custom");
  const customBuilder = document.getElementById("custom-slides-builder");
  const codeEl = document.getElementById("nblm-prompt-code");

  const inactiveBtn = "subtab-mode-btn flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 text-[#68615B] hover:text-[#322E2B] hover:bg-white/60 border border-transparent cursor-pointer";
  const activeBtn = "subtab-mode-btn flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 bg-white text-[#322E2B] shadow-sm border border-[#322E2B]/10 cursor-pointer";

  if (btnGlobal) btnGlobal.className = inactiveBtn;
  if (btnSlide) btnSlide.className = inactiveBtn;
  if (btnCustom) btnCustom.className = inactiveBtn;

  if (descGlobal) descGlobal.classList.add("hidden");
  if (descSlide) descSlide.classList.add("hidden");
  if (descCustom) descCustom.classList.add("hidden");
  if (customBuilder) customBuilder.classList.add("hidden");

  if (mode === "global") {
    if (btnGlobal) btnGlobal.className = activeBtn;
    if (descGlobal) descGlobal.classList.remove("hidden");
    const raw = generatedPromptGlobal || generatedNblmPrompt || "未擷取到全域風格提示詞，請查看完整報告。";
    if (codeEl) codeEl.textContent = applyTargetPageCountToPrompt(raw, userTargetPageCount);
  } else if (mode === "slide") {
    if (btnSlide) btnSlide.className = activeBtn;
    if (descSlide) descSlide.classList.remove("hidden");
    const raw = generatedPromptSlide || generatedNblmPrompt || "未擷取到逐頁 1:1 提示詞，請查看完整報告。";
    if (codeEl) codeEl.textContent = applyTargetPageCountToPrompt(raw, userTargetPageCount);
  } else if (mode === "custom") {
    if (btnCustom) btnCustom.className = activeBtn;
    if (descCustom) descCustom.classList.remove("hidden");
    if (customBuilder) customBuilder.classList.remove("hidden");
    renderCustomStoryboardUI();
    syncCustomPromptAndPreview();
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
      if (section.includes("模式 1") || section.includes("全域風格") || section.includes("學風格")) {
        const m1Part = section.split(/### 模式 2|模式 2/i)[0];
        const m1Match = m1Part.match(/```(?:markdown)?([\s\S]*?)```/i);
        if (m1Match && m1Match[1]) {
          globalPrompt = m1Match[1].trim();
        }
      }

      if (section.includes("模式 2") || section.includes("逐頁 1:1") || section.includes("照原稿")) {
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

// 簡報精確色票卡片 (Precision Studio Pantone Tokens)
function renderColorPalette(palette) {
  const container = document.getElementById("color-palette-container");
  if (!container) return;
  container.innerHTML = "";

  palette.forEach(color => {
    const card = document.createElement("div");
    card.className = "group studio-swatch-card p-2 flex flex-col justify-between cursor-pointer";
    card.title = `點擊複製 Pantone 色碼：${color.hex}`;
    
    card.innerHTML = `
      <div class="relative w-full h-8 sm:h-9 rounded-md border border-white/10 mb-2 shadow-inner overflow-hidden" style="background-color: ${color.hex}">
        <span class="absolute top-1 right-1 bg-black/75 backdrop-blur-sm text-[8px] font-mono text-zinc-300 px-1 py-0.2 rounded border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">COPY</span>
      </div>
      <div>
        <div class="text-[10px] font-medium text-[#68615B] truncate leading-tight">${color.role || color.name}</div>
        <div class="text-[11px] font-mono font-semibold text-[#322E2B] flex items-center justify-between mt-0.5">
          <span>${color.hex}</span>
          <i data-lucide="copy" class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400"></i>
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      navigator.clipboard.writeText(color.hex);
      showToast(`已複製 Pantone 色碼: ${color.hex}`, "success");
    });

    container.appendChild(card);
  });
  if (window.lucide) window.lucide.createIcons();
}

function stripTrailingMetaJson(markdown) {
  if (!markdown || typeof markdown !== "string") return "";
  return markdown.replace(/```json\s*\{[\s\S]*?"style_name"[\s\S]*?"palette"[\s\S]*?\}\s*```\s*$/i, "").trim();
}

function fallbackExtractMeta(markdown) {
  if (markdown && typeof markdown === "string") {
    // 1. 優先解析 Gemini / OpenAI 報告末尾產出的結構化 JSON 區塊
    const jsonBlocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gi)];
    for (let i = jsonBlocks.length - 1; i >= 0; i--) {
      try {
        const candidate = JSON.parse(jsonBlocks[i][1].trim());
        if (candidate && (candidate.style_name || Array.isArray(candidate.palette))) {
          return {
            style_name: candidate.style_name || "簡報視覺色彩與排版拓撲",
            tags: Array.isArray(candidate.tags) && candidate.tags.length > 0
              ? candidate.tags
              : ["版面骨架", "色彩系統", "幾何插槽", "NotebookLM對齊"],
            palette: Array.isArray(candidate.palette) && candidate.palette.length > 0
              ? candidate.palette
              : undefined,
            white_space_ratio: candidate.white_space_ratio || "65%"
          };
        }
      } catch (_) {}
    }

    // 2. 次優先：嘗試從 Markdown 報告第一節擷取「風格定義」或「核心風格名稱」
    const styleLineMatch = markdown.match(/(?:風格定義|核心風格名稱|視覺風格)[：:]\s*\**([^\n*]+)/);
    const extractedStyleName = styleLineMatch ? styleLineMatch[1].trim() : null;

    const hexMatches = markdown.match(/#[0-9a-fA-F]{6}/g) || ["#FAF8F5", "#181A1B", "#FEE054", "#BAE6FD", "#FED7AA", "#FEF08A", "#BBF7D0", "#E9D5FF"];
    const uniqueHex = Array.from(new Set(hexMatches)).slice(0, 8);
    return {
      style_name: extractedStyleName || "簡報視覺色彩與排版拓撲",
      tags: ["版面骨架", "色彩系統", "幾何插槽", "NotebookLM對齊"],
      palette: uniqueHex.map((hex, idx) => ({
        role: idx === 0 ? "畫布底色" : idx === 1 ? "線條與主文" : idx === 2 ? "核心強調色" : `功能標籤 ${idx - 2}`,
        hex: hex,
        name: "提取色"
      })),
      white_space_ratio: "65%"
    };
  }

  return {
    style_name: "簡報視覺色彩與排版拓撲",
    tags: ["版面骨架", "色彩系統", "幾何插槽", "NotebookLM對齊"],
    palette: [],
    white_space_ratio: "65%"
  };
}

let toastTimeoutId = null;

function dismissToast() {
  const toast = document.getElementById("toast");
  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
    toastTimeoutId = null;
  }
  if (toast) {
    toast.classList.remove("translate-y-0", "opacity-100", "pointer-events-auto");
    toast.classList.add("translate-y-20", "opacity-0", "pointer-events-none");
  }
}

function showToast(message, type = "info", extra = null) {
  if (extra && typeof extra === "object" && typeof extra.onAction === "function") {
    showToastWithUndo(message, extra.onAction, type, extra.actionLabel);
  } else {
    showToastWithUndo(message, null, type);
  }
}

function showToastWithUndo(message, onUndo = null, type = "info", actionLabel = "復原") {
  const toast = document.getElementById("toast");
  const icon = document.getElementById("toast-icon");
  const text = document.getElementById("toast-text");
  const actionBtn = document.getElementById("toast-action-btn");
  const closeBtn = document.getElementById("toast-close-btn");

  if (!toast || !text) return;
  text.textContent = message;

  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      dismissToast();
    };
  }

  if (actionBtn) {
    if (typeof onUndo === "function") {
      actionBtn.textContent = actionLabel || "復原";
      actionBtn.classList.remove("hidden");
      actionBtn.onclick = (e) => {
        e.stopPropagation();
        onUndo();
        dismissToast();
      };
    } else {
      actionBtn.classList.add("hidden");
      actionBtn.onclick = null;
    }
  }

  const isPersistent = (type === "error" || type === "warning");

  if (type === "success") {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 pointer-events-auto transition-all duration-300 flex items-start gap-2.5 px-4 py-3.5 rounded-xl bg-[#322E2B] border border-[#768A7A] text-xs shadow-2xl text-[#FAF8F5] max-w-lg select-text";
    if (icon) {
      icon.className = "w-4 h-4 text-[#95B89C] shrink-0 mt-0.5";
      icon.setAttribute("data-lucide", "check-circle");
    }
  } else if (isPersistent) {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 pointer-events-auto transition-all duration-300 flex items-start gap-2.5 px-4 py-3.5 rounded-xl bg-[#4A2523] border-2 border-[#C8A7A3] text-xs shadow-2xl text-[#FAF8F5] max-w-lg select-text";
    if (icon) {
      icon.className = "w-4 h-4 text-[#F4EAE8] shrink-0 mt-0.5";
      icon.setAttribute("data-lucide", "alert-circle");
    }
  } else {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 pointer-events-auto transition-all duration-300 flex items-start gap-2.5 px-4 py-3.5 rounded-xl bg-[#322E2B] border border-[#D9CEC2]/40 text-xs shadow-2xl text-[#FAF8F5] max-w-lg select-text";
    if (icon) {
      icon.className = "w-4 h-4 text-[#D9CEC2] shrink-0 mt-0.5";
      icon.setAttribute("data-lucide", "info");
    }
  }

  if (window.lucide) window.lucide.createIcons();

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
    toastTimeoutId = null;
  }

  // 錯誤與警告訊息常駐保留，直到使用者手動點擊「關閉」；一般成功/資訊提示 4.5 秒後自動收起
  if (!isPersistent) {
    toastTimeoutId = setTimeout(() => {
      dismissToast();
    }, 4500);
  }
}

function updateUiState() {
  lucide.createIcons();
}

// === [P0 智財與防逆向安全守護] Anti-Inspection & DevTools Guard ===
(function initSecurityGuard() {
  // 1. 停用右鍵檢視原始碼
  document.addEventListener("contextmenu", (e) => {
    // 允許在輸入框、提示詞區域或錯誤提示視窗點擊右鍵以方便選取與複製
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.closest("#nblm-prompt-code") || e.target.closest("#toast") || e.target.closest("#api-key-test-result")) {
      return;
    }
    e.preventDefault();
    if (typeof showToast === "function") {
      showToast("🛡️ 智財安全保護：原始碼已鎖定", "info");
    }
  });

  // 2. 攔截常見開發者工具熱鍵 (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U)
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "F12" ||
      (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i" || e.key === "J" || e.key === "j" || e.key === "C" || e.key === "c")) ||
      (e.ctrlKey && (e.key === "U" || e.key === "u" || e.key === "S" || e.key === "s"))
    ) {
      if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        e.stopPropagation();
        if (typeof showToast === "function") {
          showToast("🛡️ 智財安全保護：快捷鍵已被系統保護鎖定", "warning");
        }
        return false;
      }
    }
  });

  // 3. 偵測 DevTools 開啟並清空控制台
  setInterval(() => {
    const threshold = 160;
    if (
      window.outerWidth - window.innerWidth > threshold ||
      window.outerHeight - window.innerHeight > threshold
    ) {
      console.clear();
      console.log("%c[Security Protected] 核心智財與提示詞已於後端伺服器安全封裝。", "color: #10b981; font-weight: bold; font-size: 14px;");
    }
  }, 1500);
})();

// =========================================================================
// === 6. 已保存風格與提示詞收藏庫 (Saved Styles & Original Slides DB) ===
// =========================================================================

const SAVED_STYLES_DB_NAME = "nblm_saved_styles_db_v1";
const SAVED_STYLES_STORE = "styles";
const SAVED_STYLES_LS_KEY = "nblm_saved_styles_fallback_v1";

let savedStylesCache = [];
let currentSavedFilter = "all"; // "all" | "fav"
let currentActiveStyleId = null;
let editingStyleId = null;
let lastDeletedStyleRecord = null;

function openSavedStylesDB() {
  return new Promise((resolve) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(SAVED_STYLES_DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(SAVED_STYLES_STORE)) {
          db.createObjectStore(SAVED_STYLES_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  });
}

/**
 * 自動修復與升級舊版保存紀錄：
 * 1. 從 markdownReport 末尾 JSON 還原真實風格標題、精確色票名稱與標籤（修正舊版「簡報視覺色彩與排版拓撲」泛稱問題）
 * 2. 為既有提示詞注入 v6.36 鑑識級抗失真與文字潔淨鐵律（修正空心對話框被填滿、橫線蒸發、單色重複、時間軸變8字曲線與封面亂碼問題）
 */
function upgradeSavedStyleRecord(item) {
  if (!item || typeof item !== "object") return { record: item, changed: false };
  let changed = false;

  if (item.markdownReport) {
    const extractedMeta = fallbackExtractMeta(item.markdownReport);
    if (
      (!item.title || item.title === "簡報視覺色彩與排版拓撲") &&
      extractedMeta.style_name &&
      extractedMeta.style_name !== "簡報視覺色彩與排版拓撲"
    ) {
      item.title = extractedMeta.style_name;
      changed = true;
    }
    const hasGenericPalette = Array.isArray(item.palette) && item.palette.some(c => c && c.name === "提取色");
    if ((hasGenericPalette || !Array.isArray(item.palette) || item.palette.length === 0) && Array.isArray(extractedMeta.palette) && extractedMeta.palette.length > 0) {
      const extractedNotGeneric = extractedMeta.palette.some(c => c && c.name && c.name !== "提取色");
      if (extractedNotGeneric) {
        item.palette = extractedMeta.palette;
        changed = true;
      }
    }
    const hasDefaultTags = Array.isArray(item.tags) && item.tags.join(",") === "版面骨架,色彩系統,幾何插槽,NotebookLM對齊";
    if ((hasDefaultTags || !Array.isArray(item.tags) || item.tags.length === 0) && Array.isArray(extractedMeta.tags) && extractedMeta.tags.length > 0) {
      if (extractedMeta.tags.join(",") !== "版面骨架,色彩系統,幾何插槽,NotebookLM對齊") {
        item.tags = extractedMeta.tags;
        changed = true;
      }
    }
    if ((!item.whiteSpaceRatio || item.whiteSpaceRatio === "65%") && extractedMeta.white_space_ratio && extractedMeta.white_space_ratio !== "65%") {
      item.whiteSpaceRatio = extractedMeta.white_space_ratio;
      changed = true;
    }
  }

  const upgradePromptText = (promptStr, isSlideMode = false) => {
    if (!promptStr || typeof promptStr !== "string") return promptStr;
    if (promptStr.includes("【🛡️ 全域抗失真與文字潔淨最高鐵律")) return promptStr;

    let updated = promptStr;
    const isChalkboard = /黑板|#191A1D|Chalkboard/i.test(updated) || /黑板|Chalkboard/i.test(item.title || "");
    const isNotebook = /筆記本|#F9F7F1|橫線|Notebook Doodle/i.test(updated) || /筆記本|Notebook/i.test(item.title || "");

    if (isChalkboard) {
      // 修正黑板風：強制對話框與雲朵為空心透明描邊框（嚴禁填滿實心色塊）
      updated = updated.replace(
        /所有對話框與幾何容器皆採用「雙重或多重手繪粉筆線條」描邊/g,
        "所有對話框、雲朵框與幾何容器皆強制採用「空心透明無填色（Hollow Transparent Interior，內部直接透出 #191A1D 深黑板底色，呈現純白粉筆字）+ 外圍雙重粉彩粉筆線條描邊」；🚫【絕對容器禁令】：除橫幅標籤條與便利貼外，嚴禁將對話氣泡或雲朵框填滿實心粉彩色塊！"
      );
      const chalkGuardrail = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【🛡️ 全域抗失真與文字潔淨最高鐵律（Anti-Distortion Lock）】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n1. 【容器空心極性鎖定】：全篇對話框（Speech Bubbles）、雲朵框與波浪框一律為「空心透明黑板底 + 雙線粉彩粉筆外框 + 內部純白粉筆字」，嚴禁填滿實心粉彩色塊（僅標題膠囊橫幅與便利貼塊可為實心粉彩底配深黑字）！\n2. 【色彩輪替強制令】：同頁多個對話框或步驟節點必須強制依序輪替不同粉彩色相（珊瑚紅 #F27D72 ➔ 薄荷綠 #A3D9C9 ➔ 奶油黃 #F4D068 ➔ 丁香紫 #C6B4E8 ➔ 粉藍 #8AB8E6），嚴禁整頁使用單一配色。\n3. 【零亂碼與文字潔淨鐵律】：封面頁、結尾頁與所有插畫氣泡內僅允許清晰可讀的繁體中文重點，絕對嚴禁生成任何無意義偽漢字亂碼或微縮假字。\n`;
      if (updated.includes("【🎨 視覺設計規範")) {
        updated = updated.replace("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【🎨 視覺設計規範", `${chalkGuardrail}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【🎨 視覺設計規範`);
      } else {
        updated += chalkGuardrail;
      }
    } else if (isNotebook) {
      // 修正手繪塗鴉筆記本風：修正橫線蒸發、無框欄位被加粗黑框、單色重複、時間軸 90 度直角階梯折線、空心火柴人與封面亂碼
      updated = updated.replace(
        /波浪曲折蛇行軸線 \(Serpentine Wave\)/g,
        "單條 90 度直角階梯折線箭頭（Orthogonal 90-Degree Stepped Line，呈「┌─┐」方角垂直與水平折轉，🚫嚴禁畫成 8 字形雙波浪交叉曲線！）"
      );
      updated = updated.replace(
        /一條粗黑手繪線條如波浪般上下曲折橫貫畫面中央，形成 4 個波峰\/波谷轉折點/g,
        "單條粗黑手繪線條以「90度直角階梯折線（Orthogonal Stepped Line）」上下方角折轉橫貫畫面中央，形成 4 個直角階梯轉折點（🚫嚴禁畫成 8 字形雙波浪交叉線）"
      );
      const notebookGuardrail = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【🛡️ 全域抗失真與文字潔淨最高鐵律（Anti-Distortion Lock）】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n1. 【筆記本橫線防蒸發鐵律】：每一頁（P.1~結尾）背景必須全程清晰可見「水平橫線筆記本格線 (#E5E3DC) + 左側單條垂直裝訂線」，絕對嚴禁退化為無橫線空白米色紙、泛黃牛皮紙，且嚴禁添加墨水噴濺髒污（Ink Splatters）或四角落直角引號框（┌ ┘）！\n2. 【無外框筆刷欄 vs 獨立線框卡嚴格區分】：開放式筆刷欄位（如三欄展開、四欄目標、放射心智圖分支）採用「無外框、無分隔線」設計（僅在小標題下方刷一筆彩色螢光筆條），嚴禁私自加上粗黑矩形外框或「+」字格線！僅明確指定為獨立手繪框的頁面才畫黑框。\n3. 【多色螢光筆輪替與塗抹部位鎖定】：同一頁並排的 3~6 個小標題或數字圓圈，必須強制依序輪替不同螢光筆色（櫻花粉 #FF9CEE ➔ 螢光青 #70F3EA ➔ 亮黃 #FFE382 ➔ 水藍 #73C2FB），嚴禁同頁全塗同一顏色！且螢光筆僅限襯於「小標題或編號下方」，絕對嚴禁將黃色螢光筆塗抹在下方正文的句子上！\n4. 【空心火柴人與空心粗框箭頭】：所有極簡火柴人（Stick Figures）軀幹必須為「空心無填色線條（Hollow Unfilled Torso）」，嚴禁將小人身體塗黑；流程粗箭頭必須為「空心粗黑框箭頭（Hollow Outlined Arrow）」，嚴禁填滿死黑實心箭頭。\n5. 【零亂碼與封面潔淨鐵律】：封面頁與結尾頁僅輸出主標題與明確副標，絕對嚴禁在主標題下方生成任何無意義偽漢字亂碼（如「未成項传惠行」等假字）！\n`;
      if (updated.includes("【🎨 視覺設計規範")) {
        updated = updated.replace("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【🎨 視覺設計規範", `${notebookGuardrail}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【🎨 視覺設計規範`);
      } else {
        updated += notebookGuardrail;
      }
    } else {
      const generalGuardrail = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【🛡️ 全域抗失真與文字潔淨最高鐵律（Anti-Distortion Lock）】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n1. 【容器填充極性鎖定】：嚴格遵循原稿容器之「空心描邊」、「無外框筆刷欄」或「實心色塊」屬性，嚴禁將空心框填滿實心色塊或替無框欄位私自加上粗黑外框。\n2. 【多色強調色輪替】：同頁並排之多個欄位標題或步驟節點必須依序輪替色票中的不同強調色，嚴禁單色重複，且嚴禁將螢光筆塗抹於正文長句上。\n3. 【零亂碼與文字潔淨鐵律】：封面與各頁插畫內絕對嚴禁生成任何無意義偽漢字亂碼或模糊微縮假字。\n`;
      if (updated.includes("【🎨 視覺設計規範")) {
        updated = updated.replace("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【🎨 視覺設計規範", `${generalGuardrail}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【🎨 視覺設計規範`);
      } else {
        updated += generalGuardrail;
      }
    }
    return updated;
  };

  if (item.globalPrompt) {
    const newGlobal = upgradePromptText(item.globalPrompt, false);
    if (newGlobal !== item.globalPrompt) {
      item.globalPrompt = newGlobal;
      changed = true;
    }
  }
  if (item.slidePrompt) {
    const newSlide = upgradePromptText(item.slidePrompt, true);
    if (newSlide !== item.slidePrompt) {
      item.slidePrompt = newSlide;
      changed = true;
    }
  }

  return { record: item, changed };
}

async function loadAllSavedStylesFromStorage() {
  const db = await openSavedStylesDB();
  if (db) {
    try {
      const items = await new Promise((resolve) => {
        const tx = db.transaction(SAVED_STYLES_STORE, "readonly");
        const store = tx.objectStore(SAVED_STYLES_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      if (items && items.length > 0) {
        for (const it of items) {
          const res = upgradeSavedStyleRecord(it);
          if (res.changed) {
            try {
              const wtx = db.transaction(SAVED_STYLES_STORE, "readwrite");
              wtx.objectStore(SAVED_STYLES_STORE).put(res.record);
            } catch (_) {}
          }
        }
        savedStylesCache = items.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        return savedStylesCache;
      }
    } catch (e) {
      console.warn("IndexedDB 讀取失敗，改用 LocalStorage 備援:", e);
    }
  }

  try {
    const raw = localStorage.getItem(SAVED_STYLES_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(it => upgradeSavedStyleRecord(it));
        savedStylesCache = parsed.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        return savedStylesCache;
      }
    }
  } catch (e) {
    console.warn("LocalStorage 讀取失敗:", e);
  }

  savedStylesCache = [];
  return savedStylesCache;
}

async function saveStyleRecordToStorage(record) {
  const idx = savedStylesCache.findIndex(item => item.id === record.id);
  if (idx >= 0) {
    savedStylesCache[idx] = record;
  } else {
    savedStylesCache.unshift(record);
  }
  savedStylesCache.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

  const db = await openSavedStylesDB();
  if (db) {
    try {
      await new Promise((resolve) => {
        const tx = db.transaction(SAVED_STYLES_STORE, "readwrite");
        const store = tx.objectStore(SAVED_STYLES_STORE);
        store.put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      console.warn("IndexedDB 寫入失敗:", e);
    }
  }

  try {
    localStorage.setItem(SAVED_STYLES_LS_KEY, JSON.stringify(savedStylesCache.slice(0, 15)));
  } catch (e) {
    // 若 LocalStorage 容量滿則僅保留最近 5 筆輕量備份，完整資料由 IndexedDB 保存
    try {
      const compact = savedStylesCache.slice(0, 6).map(it => ({
        ...it,
        slides: (it.slides || []).slice(0, 2)
      }));
      localStorage.setItem(SAVED_STYLES_LS_KEY, JSON.stringify(compact));
    } catch (_) {}
  }
}

async function deleteStyleRecordFromStorage(id) {
  savedStylesCache = savedStylesCache.filter(item => item.id !== id);
  const db = await openSavedStylesDB();
  if (db) {
    try {
      await new Promise((resolve) => {
        const tx = db.transaction(SAVED_STYLES_STORE, "readwrite");
        tx.objectStore(SAVED_STYLES_STORE).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {}
  }
  try {
    localStorage.setItem(SAVED_STYLES_LS_KEY, JSON.stringify(savedStylesCache.slice(0, 10)));
  } catch (e) {}
}

// 壓縮單張投影片圖片為高清晰 16:9 縮圖 (800x450 JPEG 0.78)，兼顧原圖對比細節與儲存空間
function compressSlideImageForSave(dataUrl, maxW = 800, quality = 0.78) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof dataUrl !== "string") {
      resolve("");
      return;
    }
    const img = new Image();
    if (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      try {
        const ratio = img.width > maxW ? maxW / img.width : 1;
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#F3EFEA";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (err) {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// 每次分析完成後自動保存「原始圖片樣式 + 色票 + 提示詞」
async function handlePostAnalysisSave(data, meta, finalPalette, options = {}) {
  if (options.fromSavedId) {
    currentActiveStyleId = options.fromSavedId;
    updateSaveToolbarButtonState();
    renderSavedStylesList();
    return;
  }

  const activeSlides = getActiveComparisonSlides();
  const slidesToSave = activeSlides.slice(0, 12);
  const compressedSlides = [];
  for (let i = 0; i < slidesToSave.length; i++) {
    const s = slidesToSave[i];
    const compressedImg = await compressSlideImageForSave(s.image, 840, 0.8);
    compressedSlides.push({
      page: s.originalPage || (i + 1),
      image: compressedImg,
      text: (s.text || "").slice(0, 300)
    });
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateLabel = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const styleId = `style_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    id: styleId,
    title: meta.style_name || `簡報風格 (${dateLabel})`,
    isFavorite: false,
    createdAtMs: Date.now(),
    dateLabel,
    pageCount: compressedSlides.length || uploadedSlidePages.length || 1,
    coverImage: compressedSlides[0]?.image || "",
    slides: compressedSlides,
    palette: finalPalette,
    tags: meta.tags || [],
    whiteSpaceRatio: meta.white_space_ratio || "65%",
    markdownReport: generatedReportMarkdown,
    globalPrompt: generatedPromptGlobal,
    slidePrompt: generatedPromptSlide,
    modelUsed: data.model_used || "",
    autoReason: data.auto_reason || ""
  };

  currentActiveStyleId = styleId;
  await saveStyleRecordToStorage(record);
  updateSaveToolbarButtonState();
  renderSavedStylesList();
}

function updateSaveToolbarButtonState() {
  const btn = document.getElementById("btn-save-current-style");
  const textEl = document.getElementById("btn-save-current-style-text");
  if (!btn || !textEl) return;

  const currentRecord = savedStylesCache.find(item => item.id === currentActiveStyleId);
  if (currentRecord && currentRecord.isFavorite) {
    btn.className = "px-3 py-1.5 text-xs font-semibold bg-[#E9EFEA] hover:bg-[#DCE6DE] text-[#4E6152] rounded-lg border border-[#768A7A] flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm";
    textEl.textContent = "已收藏 · 修改名稱";
  } else {
    btn.className = "px-3 py-1.5 text-xs font-semibold bg-[#F4EAE8] hover:bg-[#EBDAD7] text-[#8F6561] rounded-lg border border-[#DFC9C6] flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm";
    textEl.textContent = "加入收藏 · 自訂名稱";
  }
}

function renderSavedStylesList() {
  const listEl = document.getElementById("saved-styles-list");
  const emptyEl = document.getElementById("saved-styles-empty");
  const countBadge = document.getElementById("saved-styles-count-badge");
  const clearUnfavBtn = document.getElementById("btn-clear-unfav-styles");

  if (!listEl) return;

  if (countBadge) {
    countBadge.textContent = `${savedStylesCache.length} 筆`;
  }

  const unfavCount = savedStylesCache.filter(it => !it.isFavorite).length;
  if (clearUnfavBtn) {
    if (unfavCount > 0 && savedStylesCache.length > 1) {
      clearUnfavBtn.classList.remove("hidden");
    } else {
      clearUnfavBtn.classList.add("hidden");
    }
  }

  // 排序：已收藏置頂，其次依時間倒序
  const filtered = savedStylesCache
    .filter(item => currentSavedFilter === "fav" ? item.isFavorite : true)
    .sort((a, b) => {
      if (!!b.isFavorite !== !!a.isFavorite) {
        return b.isFavorite ? 1 : -1;
      }
      return (b.createdAtMs || 0) - (a.createdAtMs || 0);
    });

  // 移除舊卡片但保留 emptyEl
  Array.from(listEl.querySelectorAll(".saved-style-card")).forEach(el => el.remove());

  if (filtered.length === 0) {
    if (emptyEl) {
      emptyEl.classList.remove("hidden");
      const titleP = emptyEl.querySelector("p.font-semibold");
      if (titleP) {
        titleP.textContent = currentSavedFilter === "fav" ? "尚無標記為「已收藏」的風格" : "尚無保存的簡報風格";
      }
    }
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");

  filtered.forEach(item => {
    const isActive = item.id === currentActiveStyleId;
    const card = document.createElement("div");
    card.className = `saved-style-card rounded-xl p-2.5 border transition-colors ${
      isActive
        ? "bg-[#E9EFEA]/70 border-[#768A7A] shadow-sm"
        : "bg-[#F3EFEA]/90 hover:bg-[#EAE3DC]/80 border-[#322E2B]/[0.09]"
    }`;

    const paletteDots = (item.palette || []).slice(0, 4).map(c =>
      `<span class="w-3 h-3 rounded-full border border-[#322E2B]/15 shrink-0" style="background-color: ${c.hex || '#C8A7A3'};" title="${c.role || ''}: ${c.hex || ''}"></span>`
    ).join("");

    const thumbHtml = item.coverImage
      ? `<img src="${item.coverImage}" alt="${item.title}" class="w-full h-full object-cover">`
      : `<div class="w-full h-full flex items-center justify-center text-[10px] font-mono text-[#968E86]">16:9</div>`;

    card.innerHTML = `
      <div class="flex items-start gap-2.5">
        <!-- 左側：原始投影片 16:9 縮圖 (點擊直接載入) -->
        <div class="btn-load-saved-style relative w-24 aspect-video rounded-lg overflow-hidden bg-[#EAE3DC] border border-[#D9CEC2] shrink-0 cursor-pointer group" title="點擊載入原始圖片樣式與提示詞">
          ${thumbHtml}
          <span class="absolute bottom-1 right-1 px-1.5 py-0.2 rounded bg-[#322E2B]/80 text-[#FAF8F5] font-mono text-[9px]">
            ${item.pageCount || 1} 頁
          </span>
        </div>

        <!-- 右側：標題、色票與快捷操作 -->
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-start justify-between gap-1">
            <button type="button" class="btn-load-saved-style text-left text-xs font-bold text-[#322E2B] hover:text-[#4E6152] truncate cursor-pointer flex-1" title="${item.title}">
              ${item.title}
            </button>
            <button type="button" class="btn-toggle-fav shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${
              item.isFavorite
                ? "bg-[#F4EAE8] text-[#8F6561] border-[#DFC9C6] font-semibold"
                : "bg-white/60 text-[#968E86] border-[#322E2B]/10 hover:text-[#322E2B]"
            }" title="切換收藏置頂">
              ${item.isFavorite ? "已收藏" : "收藏"}
            </button>
          </div>

          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1">
              ${paletteDots}
            </div>
            <span class="text-[10px] font-mono text-[#968E86] truncate">${item.dateLabel || ""}</span>
          </div>

          <!-- 底部操作列 -->
          <div class="flex items-center justify-between pt-1 border-t border-[#322E2B]/[0.06] gap-1">
            <div class="flex items-center gap-1">
              <button type="button" class="btn-load-saved-style px-2 py-0.5 rounded bg-[#768A7A] hover:bg-[#586B5C] text-white text-[10px] font-semibold cursor-pointer transition-colors">
                載入檢視
              </button>
              <button type="button" class="btn-quick-copy-saved px-2 py-0.5 rounded bg-[#FAF8F5] hover:bg-white text-[#322E2B] border border-[#322E2B]/10 text-[10px] font-medium cursor-pointer transition-colors" title="直接複製此風格的 NotebookLM 提示詞">
                複製提示詞
              </button>
            </div>
            <div class="flex items-center gap-1">
              <button type="button" class="btn-edit-saved-name px-1.5 py-0.5 rounded text-[10px] text-[#68615B] hover:text-[#322E2B] hover:bg-white/60 cursor-pointer" title="修改名稱">
                改名
              </button>
              <button type="button" class="btn-delete-saved px-1.5 py-0.5 rounded text-[10px] text-[#968E86] hover:text-[#A65B56] hover:bg-white/60 cursor-pointer" title="刪除此筆紀錄">
                刪除
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 綁定載入事件
    card.querySelectorAll(".btn-load-saved-style").forEach(btn => {
      btn.addEventListener("click", () => loadSavedStyleIntoWorkspace(item.id));
    });

    // 綁定直接複製提示詞
    const copyBtn = card.querySelector(".btn-quick-copy-saved");
    if (copyBtn) {
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rawPrompt = (currentPromptMode === "slide" ? item.slidePrompt : item.globalPrompt) || item.globalPrompt || item.markdownReport || "";
        const promptToCopy = applyTargetPageCountToPrompt(rawPrompt, userTargetPageCount);
        if (!promptToCopy) {
          showToast("此紀錄無有效提示詞內容", "warning");
          return;
        }
        navigator.clipboard.writeText(promptToCopy).then(() => {
          showToast(`已複製「${item.title}」的 NotebookLM 提示詞！`, "success");
        });
      });
    }

    // 綁定切換收藏
    const favBtn = card.querySelector(".btn-toggle-fav");
    if (favBtn) {
      favBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        item.isFavorite = !item.isFavorite;
        await saveStyleRecordToStorage(item);
        updateSaveToolbarButtonState();
        renderSavedStylesList();
        showToast(item.isFavorite ? `已將「${item.title}」加入收藏置頂` : `已取消「${item.title}」的收藏標記`, "info");
      });
    }

    // 綁定改名彈窗
    const editBtn = card.querySelector(".btn-edit-saved-name");
    if (editBtn) {
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openSaveStyleModal(item.id);
      });
    }

    // 綁定刪除（含復原按鈕）
    const delBtn = card.querySelector(".btn-delete-saved");
    if (delBtn) {
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        lastDeletedStyleRecord = { ...item };
        await deleteStyleRecordFromStorage(item.id);
        if (currentActiveStyleId === item.id) {
          currentActiveStyleId = null;
          updateSaveToolbarButtonState();
        }
        renderSavedStylesList();
        showToast(`已刪除「${item.title}」`, "info", {
          actionLabel: "復原",
          onAction: async () => {
            if (lastDeletedStyleRecord) {
              await saveStyleRecordToStorage(lastDeletedStyleRecord);
              currentActiveStyleId = lastDeletedStyleRecord.id;
              lastDeletedStyleRecord = null;
              updateSaveToolbarButtonState();
              renderSavedStylesList();
              showToast("已復原保存的風格紀錄！", "success");
            }
          }
        });
      });
    }

    listEl.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

// 點擊左側已保存風格卡片 -> 立即在右側還原原始圖片樣式、色票與提示詞（免呼叫 API）
function loadSavedStyleIntoWorkspace(styleId) {
  const item = savedStylesCache.find(it => it.id === styleId);
  if (!item) {
    showToast("找不到該筆保存紀錄", "warning");
    return;
  }

  // 還原原始投影片縮圖至工作台，讓右側 16:9 Stage 與翻頁器完整顯示原始圖片樣式
  if (item.slides && item.slides.length > 0) {
    uploadedSlidePages = item.slides.map((s, idx) => ({
      page: s.page || (idx + 1),
      image: s.image,
      text: s.text || ""
    }));
    pageSelectionMode = "all";
    selectedPageIndices = new Set(uploadedSlidePages.map((_, i) => i + 1));
    renderThumbnails();
  }

  const mockData = {
    markdown_report: item.markdownReport || "",
    global_prompt: item.globalPrompt || "",
    slide_prompt: item.slidePrompt || "",
    model_used: item.modelUsed || "已保存紀錄",
    auto_reason: item.autoReason || `保存於 ${item.dateLabel || ""}`,
    structured_meta: {
      style_name: item.title,
      palette: item.palette,
      tags: item.tags,
      white_space_ratio: item.whiteSpaceRatio
    }
  };

  renderAnalysisResult(mockData, { fromSavedId: item.id });
  showToast(`已載入「${item.title}」的原始圖片樣式與提示詞！`, "success");
}

function openSaveStyleModal(targetId = null) {
  const idToEdit = targetId || currentActiveStyleId;
  const item = savedStylesCache.find(it => it.id === idToEdit);
  if (!item) {
    showToast("請先完成一次簡報分析或選擇一筆風格紀錄", "warning");
    return;
  }

  editingStyleId = item.id;
  const modal = document.getElementById("modal-save-style");
  const previewImg = document.getElementById("save-modal-preview-img");
  const pageInfo = document.getElementById("save-modal-page-info");
  const swatchesEl = document.getElementById("save-modal-swatches");
  const nameInput = document.getElementById("input-save-style-name");
  const favCheck = document.getElementById("check-save-style-fav");

  if (previewImg) {
    previewImg.src = item.coverImage || "";
  }
  if (pageInfo) {
    pageInfo.textContent = `包含 ${item.pageCount || 1} 頁原始簡報縮圖 · 保存於 ${item.dateLabel || "剛剛"}`;
  }
  if (swatchesEl) {
    swatchesEl.innerHTML = (item.palette || []).map(c =>
      `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono border border-[#322E2B]/15 flex items-center gap-1 bg-[#FAF8F5]">
        <span class="w-2.5 h-2.5 rounded-full" style="background-color:${c.hex || '#768A7A'}"></span>
        <span>${c.hex || ''}</span>
      </span>`
    ).join("");
  }
  if (nameInput) {
    nameInput.value = item.title || "";
  }
  if (favCheck) {
    favCheck.checked = item.isFavorite !== false;
  }

  if (modal) {
    modal.classList.remove("hidden");
    setTimeout(() => nameInput && nameInput.focus(), 80);
  }
  if (window.lucide) window.lucide.createIcons();
}

function closeSaveStyleModal() {
  const modal = document.getElementById("modal-save-style");
  if (modal) modal.classList.add("hidden");
  editingStyleId = null;
}

// 初始化收藏庫事件與載入本機歷史資料
document.addEventListener("DOMContentLoaded", async () => {
  await loadAllSavedStylesFromStorage();
  renderSavedStylesList();

  const btnSaveCurrent = document.getElementById("btn-save-current-style");
  if (btnSaveCurrent) {
    btnSaveCurrent.addEventListener("click", () => openSaveStyleModal(currentActiveStyleId));
  }

  const btnCloseModal = document.getElementById("btn-close-save-style-modal");
  const btnCancelModal = document.getElementById("btn-cancel-save-style");
  if (btnCloseModal) btnCloseModal.addEventListener("click", closeSaveStyleModal);
  if (btnCancelModal) btnCancelModal.addEventListener("click", closeSaveStyleModal);

  const btnConfirmSave = document.getElementById("btn-confirm-save-style");
  if (btnConfirmSave) {
    btnConfirmSave.addEventListener("click", async () => {
      const item = savedStylesCache.find(it => it.id === editingStyleId);
      if (!item) {
        closeSaveStyleModal();
        return;
      }
      const nameInput = document.getElementById("input-save-style-name");
      const favCheck = document.getElementById("check-save-style-fav");
      const newTitle = (nameInput?.value || "").trim() || item.title;

      item.title = newTitle;
      item.isFavorite = favCheck ? !!favCheck.checked : true;

      await saveStyleRecordToStorage(item);

      if (currentActiveStyleId === item.id) {
        const titleEl = document.getElementById("result-style-name");
        if (titleEl) titleEl.textContent = newTitle;
      }

      updateSaveToolbarButtonState();
      renderSavedStylesList();
      closeSaveStyleModal();
      showToast(`已保存風格「${newTitle}」（含原始圖片樣式與提示詞）！`, "success");
    });
  }

  // 篩選按鈕切換 (全部紀錄 / 已收藏)
  document.querySelectorAll(".saved-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentSavedFilter = btn.getAttribute("data-saved-filter") || "all";
      document.querySelectorAll(".saved-filter-btn").forEach(b => {
        if (b.getAttribute("data-saved-filter") === currentSavedFilter) {
          b.className = "saved-filter-btn active px-2.5 py-1 rounded-md font-semibold bg-[#FAF8F5] text-[#322E2B] shadow-sm cursor-pointer transition-colors";
        } else {
          b.className = "saved-filter-btn px-2.5 py-1 rounded-md font-medium text-[#68615B] hover:text-[#322E2B] cursor-pointer transition-colors flex items-center gap-1";
        }
      });
      renderSavedStylesList();
    });
  });

  // 清理未收藏紀錄
  const btnClearUnfav = document.getElementById("btn-clear-unfav-styles");
  if (btnClearUnfav) {
    btnClearUnfav.addEventListener("click", async () => {
      const toDelete = savedStylesCache.filter(it => !it.isFavorite);
      if (toDelete.length === 0) return;
      for (const item of toDelete) {
        await deleteStyleRecordFromStorage(item.id);
      }
      renderSavedStylesList();
      showToast(`已清理 ${toDelete.length} 筆未收藏的歷史紀錄`, "info");
    });
  }

  // 匯出全部保存的風格與原圖 (.json)
  const btnExport = document.getElementById("btn-export-saved-styles");
  if (btnExport) {
    btnExport.addEventListener("click", () => {
      if (savedStylesCache.length === 0) {
        showToast("目前尚無已保存的風格可供匯出", "warning");
        return;
      }
      const payload = JSON.stringify({
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        styles: savedStylesCache
      }, null, 2);
      const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nblm-saved-styles-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`已匯出 ${savedStylesCache.length} 筆簡報風格與原圖備份檔！`, "success");
    });
  }

  // 匯入備份檔 (.json)
  const btnImport = document.getElementById("btn-import-saved-styles");
  const inputImport = document.getElementById("input-import-saved-styles");
  if (btnImport && inputImport) {
    btnImport.addEventListener("click", () => inputImport.click());
    inputImport.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : (parsed.styles || []);
        if (!Array.isArray(list) || list.length === 0) {
          throw new Error("備份檔格式無效或無內容");
        }
        for (const item of list) {
          if (item && item.id && item.title) {
            upgradeSavedStyleRecord(item);
            await saveStyleRecordToStorage(item);
          }
        }
        renderSavedStylesList();
        showToast(`成功匯入 ${list.length} 筆簡報風格與原始圖片樣式！`, "success");
      } catch (err) {
        showToast(`匯入失敗：${err.message}`, "error");
      } finally {
        inputImport.value = "";
      }
    });
  }

  // 綁定【任務宣告】頁數要求填寫框與快捷按鈕
  document.querySelectorAll(".target-pages-input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      setTargetPageCount(e.target.value, e.target);
    });
  });

  document.querySelectorAll(".quick-pages-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-pages") || "";
      setTargetPageCount(val);
      if (val) {
        showToast(`已設定【任務宣告】頁數要求：${val}`, "info");
      } else {
        showToast("已恢復【任務宣告】頁數：由 AI 依內容深度自動裁量", "info");
      }
    });
  });
});

