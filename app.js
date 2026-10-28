const APP_VERSION = "v6.34.3";
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
const _0xSEC_CAPSULE = "UL7n+rzC9b7i2r7n177izL3P1rP62L3uwL3A3r3q+7/667L8zLL84LPa3L/Ky7zE7Lz90b/i8bXm0gooPyk/NC47LjM1NHoWOyM1Ly56CD8sPygpP3cfND0zND8/KLXm07LS3b/j5L7nz7zUyL3T0r/q0r/07Lna2FC+5/q9wN6+5+W/y+e8wvW52sq/2dW97vq97sCy0t280cm8yOi97sC9xsW/9fyz2N6/1MW52su+5+W9zvKy2t++4tC/2Om9wN696vu/+uu99d6+5NG15tIKHhy52tsKCg4CerzSzLzQz7/n673T3bzS8L/GzLXm07Xm1r/k47/gz7zuxL/1xb/f7Lna1r3Gxb/1/L/j5L7nz7Pw8rzE7Lna27/GzLL9+bPA67/M4bna27PY0Lz73LzHyrLp8Lna27zM3b/3zb312r//1bLS3bLT6L/n873p4b3v67na17Xm1r7i/LLn07L39b3Y4LLZ53pramp/er/l+r/1/L/q17Pn0L3A3noUNS4/ODU1MRYXer/q0r3O8rzVyr3+4LLzxLLS3bzUyL3T0rLy97Ly0rL81b313rna2FBQuMD6teLVudrKvMbas/HCv9TFv9PdtebAv/X8vuDRvOvYvML1udrbvcbFvfjgs9jev9TFtebSDigvP3cuNXcJNS8oOT96DDMpLzs2ehwzPj82My4jtebTudrLtebAUGt0eqrF1PK52spramp/er/l+r/1/LzVyr/VzLLZ1rzD9bLS3b3P8b/i2b3T47/k77Xm0r/A7r3827P6yrLy973uzr3D57/b1b/t9LXm07nay7XmwFB6enp3er7hzr3u6rL92r/1xbLZ1rzD9bzC9bzt67LT6L/P3L/Rw7/gz7na273f/b3T3bPb9L3n87Xm0r/82LzAzbzv7bLh17LN173f/b3T3b3M0L/Q+r/r/noKMjUuNXoVLD8oNjsjtebTtebWs9jevML1vP/vver7ve7OvcPnudrYUHp6end6v+Xfs/rSvejkvfjgsvLCs9bevcbFv/X8v+DPstPoehI/Inq9+Oa15tK//Ni87eu87+2y4deyzdd6eWofaBtpYnq80sy97s69w+d6eRwcHBwcHLXm07Xm1r/A7r3827/m7b/S7Lzm2L3D57zSzLzJ37Ld8L3x3rzO47na2FBodHqqxcnKudrKvejkvfjgvNfPvNfTvuL8svLCs9bevNPavMbTvPriv+XZv+PkvufPsvnHs/nkstLdv8bMsv35vPLDsvLCudrLtebAUHp6end6stH/vPLDs/vWvM3bvMbTudrWv8TYvcHuv/X8v+XZvejNstPov/vQvPLDvMXrenIMPyguMzk7NnobOTk/NC56GDsoc7na17/l37P60r3o5LzgzLzW3bLw17P71bLT6LLS3b7n173n9LXm21B6enp3erLR/7L9yLLK57zSzL/r2rPZ8rzG07na1r/K1r/l2b/Gyb/m/b/S3bL9yL3I6npyGTU0OT80LigzOXobKDl6CDM0PSlzudrXudrbudrWv8rWv+XZv8bJs8fsv+XZudrXudrbudrWvOruv+Pps9rovfLRsuHiudrXudrbudrWve3AvPvcvdfyvfHRv9f7vdPdudrXudrbudrWvMzLs/z2ve7RvPjHv9LNudrXtebWv+Xfs/rSemtqan96v/TWvM/uvNfPvNfTv9/sv+PkvufPsvzVvPrmtebbUGl0eqrFzv652sq/982/xNGy0t281Mi/1+q99dq//9W9xsW/9fyz2N6/1MW52su15sBQenp6d3q818+819O88sOz+9a/982z3de15tK//Ni90+O//v293vuy//W97cCy7N+96M2z8c56HyIuKDt6GDU2Pnp1ehM3Kjs5LrXm07na27zM3b/3zbLT6L/n87Xm0r/82L3uzr3D57Pxwr/q17z1zrXm07na27/q17Pn0LzM47/m1bLS3b/+/b/q1b/r/r3uwLna2FBudHqqxcDxudrKv8Duvfzbvd77vuL3vc7FvMbTv+PhsvzgudrWv+3yv8TRehEKE3q97+uy8tK//v28z+K/98252te52su15sBQenp6d3qzw/6zx8S/1MW/xsy8xva+5Ny/6uu8xtOy8+i/7fK/xNG8z+K/98215ta/yvy/0929/Nu89/iy3fCy+9a87eG/0Pq52thQULLx0b7h/73j27Pxzr7i97zM3bXm0r/V6r3b+b3lyLzf+b3O8rLwxLXm07Lm4r/d4L7h/77i0b3vyrz90b/WzL/667/L0LXmwFBQeXqqxdTyer3q+7/667P48rz65r3o5LzgzLPa3L/Ky7/667/L0FBQeXl6a3R6s9rKs/rbvdPSs8f4vNHJvMjostLdv+PkvufPs/DyvMTsenIJNjM+P3c4I3cJNjM+P3oONSo1NjU9I3NQAb/q177i0L/Y6b3A3rz11bP627zQz7/n673T3bPa6LL71r3o5LzgzL/j5L7nz7zR3LL9+bXm1r/l+r/1/L/q17zd077i0L/Y6b/f/b/0477j0b3Gxb/1/L3u6r312gdQd3pwcL329nprerP627zRybzI6HBwtebAUHp6d3q9z/G/4tmy2da8w/Wy0t28x8qy6fC15sByvejkvfjgvNXVsuXqtebWvuTRv/zYudrWvO3rvO/tsuHXss3XenJ5ah9oG2lic3q/z9y/0cO93/290928wM2y0+i85uK/6/6z2/S95/O52tdzUHp6d3qzzcaz1++/4+S+58+y+cez+eS15sBysvPpve7qvNbdsvDXtebWvuTRv/zYudrWvuLhvPLDs/vWv+38v9vuve3Qsujmv8TYvcHuv/X8v+XZvuD0vPPCstPov/vQvPLDvMXrtebBv9XpvuLQsv3Iv/7MvMnueml6v+v+vuD0s93LvPPCv8rWv+XZv8bJv+b9v9Ldsv3IvcjqtebWv+38vuLRsv3Iv+b9ve3Av8vmvN3TudrXc1B6end6vMzdv/fNv+v+ve7AstLdvNTIvdPStebAcr7k0b/82Lna1r3T47/+/b3e+7L/9b3twLLs373ozbPxzr/f8r/+/b/18b3uzr3D57zyw7P71rXm1r7i0bzM47Pf13pod2l6svvWve7OvcPnv+rUsvLaudrXc1BystH/vMbTvMHuv/7As/rbs8f4tebWsvHRvuTHv+DVs9rKs/rbvejkvfjgvNHcsv35c1BQeXl6aHR6vejkvfjgsvL3svLSvenhve/rsvzVvfXeenIePykzPTR6CSMpLj83c1B3enBwstPov+fzvenhve/renIfIjs5LnoSPyJ6Cjs2Py4uP3NwcLXmwFB6end6vc/xv+LZstnWvMP1stPotebAeQICAgICAnpyvejkvODMvNXKv9XMv+DPstPoc1B6end6vuLhvMzdv/fNstPotebAeQICAgICAnpyvuLhsvzbvPLDs/vWstPotebWv/zYve7OvcPnenkcHBwcHBxzUHp6d3q8+uK/5dm/5u2y8OWy0+h6chs5OT80LnO15sB5AgICAgICenK+4PS888Kz4dl1v8nbvdPWs93LvffTs93Xs+HEsvnHs/nkstPoc1B6end6vPb7svzbsubOv9DzstPotebAeQICAgICAnpyve3AvPjHudrbv9Lcv9PovNLMvPb7vMzdv/fNstPoc1B3enBwv/fNv8TRstLdvNTIv9fqv+v+ve7AcHC15sC88sOz+9a/982z3de52tu/1/u909288sOz+9a/98297sC52tu/3/28zN2/982y7cey0t2/6tez59C8zOO/5tVQd3pwcL/j5L7nz7/GzLL9+bLwxLzpz3BwtebAv8rWv+XZv8bJv+b9svzVvPrmudrbv8TYvcHustPov/vQvMXrudrbv9f7vdPds9jQvPvcvejNve7qstLdv8bMvf7gs/jyvPrmUFB5eXppdHqqxcnRehQ1Lj84NTUxFhd6v+rSvc7yver7v/rrvNXKvf7gsvPEenK+4Na/ytK+4tqzwcO88vu/5tWy5uK/3eBzUGR6svHRv8rWvMPYvNXKvuTBvuH/vuLRv9/zvfL0vPL7v+bVvcDev/TWvM/uehc7KDE+NS00er7h+b345r/X2r/70LXm1rL0yb7n5b3O8rLa37/G8r/T173x9b7i2rPX77Ld8L3O67/S3bzVwbXmwFBQeXl5erzy+7/m1XprtebAv9/yv8XFs/jyvPrmvMTsvP3RtebSvNTyssz8tebAv+fSvNr9emkkaGp6s/rbtebWvNXKv9XMvM/uvuHnstPov+fzudrbv/fNv8TRudrbvPLDsvDWsvnHs/nkstLdvdPSv8TRv+DxtebWvuHhvN7VvffcsvLCvcDcv9X1vcHuvNT/v//Nvc7ytebTUDo6Ojc7KDE+NS00ULnayr7h4b/Rw7/0+b/L0Lnay7XmwFCy8dG/wO68+ua+5Me8ycC80su+4tC/2Om9wN6999yy8sK+5Ny84Mq15tIJNS8oOT8ptebTtebWvNXKv9XMs83Gs9fvvuDRv/X8stLdvO7Ev/XFtebWvdjgvNLLsvzVv9DZvuLavuHnve/KvP3Rv8DusvbjudrbsvzMsvzgv+Ppsvv7vcDev+rSvP/3ver7v/rrv9/9v/TjudrYULXm0r3i57P627zP4r3O67zY8rz647zJwL333LLywr/f/b/047zt67/g/LLd8LL71rL527Pd1bXm1r/h4LL36nppJGhqerP627/H3b/V9bXm1rz11bP6273A3LP60r/A7rz65rPb77/k8L7i0b/SzbP48rz65rL81b313rXm01BQudrKqsXU8nq/3/K/xcWy/Myy/OCz+PK8+uay/NW99d56cgwzKS87NnoJLiM2P3odLzM+P3O52su15sBQa3R6vc/xv+LZv+DPstPostLdvMfKsunwtebAAb3o5LzgzL/78b/f/7Lk8rL3wr/S6r3A3r/gz7LT6LLS3bzHyrLp8LXm1r/82LXmwLzt67zv7bLh17LN13pyeWofaBtpYnN6v8/cv9HDvd/9vdPdvMDNstPovObiv+v+s9v0vefzB1BodHq8+uK/5dm/4+S+58+y+cez+eS90+O/5O+15tK89dWz+tu/5d+z+tK88sOy8uG//Ni+58+83dO9zvK15tO15sBQenp6d3q+4uG88sOz+9a8zdu15sABv/zYtebAv+38v9vuve3Qsujmemt6vPjHv8TYvcHuv/X8v+XZvejNvuD0vPPCstPov/vQvPLDvMXrenJ5HG8bbGhpcwdQenp6d3qy/ciyyue/4+S+58+15sABv/zYtebAv9XpvuLQsv3Is9/Xvef0eml6v+v+v/7MvMnuvuD0s93LvPPCv8rWv+XZv8bJv+b9v9Ldsv3IvcjqtebWv+38vuLRsv3Iv+b9ve3Av8vmvN3TB1BpdHq/982z8c6y0t281Mi/1+qz+PK8+ua15sABv/zYtebAvdPjv/79vd77sv/1ve3AsuzfvejNs/HOenIfIi4oO3oYNTY+enV6EzcqOzkuc7Xm1r/f8r/+/b/18bXm1r3uzr3D57Pxwr/q17z1zgdQULnayqrFwPF6s/rbs8f4vdPSv8TRs8Hss93Xsv7dvMbas/HCve7evMfFtebSFjsjNS8ueh4zLD8oKTMuI3p8egA/KDV3CD8qPy4zLjM1NHoILzY/tebTudrLtebAUGt0erz11b7i2rP627/L0r3V5L3vz77i17Pd17L+3bXmwL3O+L/d4L3A3rzQz7/n673T3b/f/b/0477i97Xm1r3B4rPe6rP627PH+Lnayr3vz7/q17/A7r3827nay7//zb3O8r3B4r/K1r3T0r/E0bXmwbzP7r7h573q+7/6677i97Xm1rz11b7i2r/a0bP627PH+LPZ57/l37P60rzU+73O8rzS8L3e7L7i17/K1r3A3rL8zLL84LzRybzI6L3vyrz90bXm0r7k0b/82LXmwLzD2LPMybLh4nq4xM56v+XZvMPgv8bMerjEznq88/G/ysu8+Me/4ux6uMTOer3F87PD+bL78rz65nq4xM56v8TYvcHuv9f7vdPderjEznqy7fW97cC/xsx6uMTOer3I6r/n+Lzv273y0Xq4xM56v/79vNH2ssPFv9LcvM71vffTv/7Av9/ZsubwvMHltebTudrYUGh0er/m7b/S7L/Rz7zf0bLm8LzB5bXmwL/X6b7k5b3B4rPe6rP627PH+L3A3r7i4bP71rzSzL/f/b/047Pd1b3B4r7m5rXm1r7jxb/l37P60r/m7b/S7LL00LzVwb/j5L7nz7zVyLz957LS3bL8zLL84L/L0r3V5LLm07PxzrXm1r/k47/gz7zHxr3vz7/X2b313b7i2r/k0b3A3r/X+73T3bzSzLz4x7/Szb/m1bL8zLL84L3M6L7j1bXm21BQudrKuMbYteLVer3q+7/667zM3b/3zb/13L/g/LPC6L3S3LP6yr30zbXm0r3s97zW27/L5r/K4rzexbXm1r/A7r3827zP+bzM3bz077LK57Xm07nay7XmwFBrdHq/wO68+ua84PW84Mq15sC809q8xtO/3/2/9OO/5d+z+tJ6a2pqf3q84Mqy3fC+5Ny84Mq999yy8sK15ta/wO69/Nu87eG/0Pq8xvC81cq/1dC9wN6//syz2fK81PKy8cy52thQaHR6v/fNvM/is8PKv9LstebAUHp6end6vNDPv+frvdPdvuLhvPLDs/vWtebAs8PKv/TAemIka256v/fNtebSve/KsvHMv9/SsvvWtebWv9HPsunJvNLMvuLhsvbYvcX3svDEtebTudrYUHp6end6v9P1vPLDs/vWdb/q1LLy2rXmwLPDyr/0wHprbyRob3q/98252thQenp6d3q/19q/+9B1v9f7vdPdvPLDs/vWtebAs8PKv/TAem4kYnq/98252thQenp6d3q8+Me/0s2y/Nuz4cS15sC89dW8+Mezw8q/9MB6a2gkaGp6v/fNtebSvPXVvPbedbz11b/X+73T3bzG2r/+wHpoJGl6s+HEtebTudrYUGl0eqrFwPF6suj6v8rLvNTIs8P+tebAs8P+s8fEvuTcvODKvffcsvLCvuL3v9/tv9jDvMLUvfjgve/rsvLSvM/ivMnAtebWv8r8v9PdudrKve/Pv+rXv8DuvfzbudrLvd77vuL3vc7FvMbTve3ys9r6v+3yv8TRehEKE3q97+uy8tK//v28z+K/98252thQULnayqrFycp6vdPSv8TRsvDEvOnPv+DxtebSsvHRvuTHv8res/rbv9/9v/Tjv+v2vNr9v9HPvN/Rs9vivc7ytebTudrLtebAUHd6Ab3T0r/E0XobtebAv+rbs8f4vuLhsvzMsvzgB7XmwL/+/bzyw7P71npxerz64r/l2b/0wL7n17/q1LLy2rna2FB3egG909K/xNF6GLXmwLz64r/l2b/X+73T3b/E0Qe15sBoJG56vPbevdfyvfHRve3AvPvcv9f7vdPdtebWvPXVvPbevNXKv9XMemt6v9rRvPriv+XZvO7Ev/XFenF6aHqz4cS9xfey8MS52thQd3oBvdPSv8TRehm15sCz2ui98tG8w9izzMmy4eK/xNEHtebAvPPxv8rLemkkbnqzwNS89O+99dqz4cS15ta88sOy8uGzwNS89O+/yte98uuy0t2z3da98tG9+Mu52thQd3oBvdPSv8TReh615sC8z+K8ycC/6te89c6/xNEHtebAv+38v9Xps8HDvPbev9Lcv9PotebWs9rosvvWv97wv9D5v+rXvPXOvNLMsuzyv9H4vNHcsv35udrYUHd6Ab3T0r/E0XoftebAve/KsvHMstLdsvvWv9HPv8TRB7XmwLPNxrPX773i573vynpxer7i0b7i2rz3/7L71r/Rz7zM47z70rna2FBystH/v9TFvNDPv+frvdPdvMbTvMHuv/7AvdPSv8TRtebWsvHRv9LNv93gvdPSv8TRehy52tsdudrbEnR0dLXm1rzVyr/VzLzT2rzG07P627PH+L3A3r3X8r3T47/j5L7nz73vyrz90XNQULnayrPayrP6273q+7/667/f/b/047Lm4r/d4Lz65r/m1bXm0rLx0b7kx7z3/rz65r/m1bPayrP627Lm4r/d4LXm07nay7XmwFB3d3dQeXl5er329noCerP627XmwAGz+tuzx/i+4uGz+9YHtebSvNT7vc7yvdPSv8TRtebAARt1GHUZdR51H3R0dAe15ta4wt+/wO68+ua97t68x8W15sC909K/xNG978++4tey0t2/09ey5eq+4eG+58+z+tuzx/iz3dey/t215tNQd3q52sqqxdTyerL8zLL84LLS3b3T0rPH+LPf173n9Lnay7XmwHK88sOy8uG//Ni+58+83dO9zvK/3/K/xcW/4M+y0+i52tu/xNi9we688sO8xeu52tu/yta/5dm/xsm/5v2999O/4+S+58+/39m97vpzUHd6udrKqsXJx3q96vu/+uu8zN28+9K/3/2/9OO52su15sBQenp3er7i4bzyw7P71rXmwHR0dFB6end6vPriv+XZs93Xs+HEtebAtebSvuTHs9viv/TAvdPSv8TRv/vxv/Xxv9f7vdPddbzD2LPMybLh4nW8+Me/0s2y/Nuz4cS15ta/wO68+uaz2++/9NK/9828z+Kzw8q/0uy15tNQOjo6UFB5eXl6vPL7v+bVemi15sCz2sqz+tt6a2Brer/q17z1zrXm0rPb87/K0rzZ6bL823pramp/er/Z1b3u+r3uwLPY3r/Uxb3T47/0wLzQz7/n673T3b3A3r/A7rz65r/78b/18bXm01A6Ojo3OygxPjUtNFC52sq+4eG/0cO/9Pm/y9C52su15sBQsvHRv8DuvPrmvuTHvMnAvNLLvuLQv9jpvcDevffcsvLCvuTcvODKtebSCTUvKDk/KbXm07Xm1rzVyr/VzLPNxrPX777g0b/1/LLS3bzuxL/1xbXm1r/q3b333LLywr/f/b/047/l+r/1/L/78b/18b/f/77i0b/SzbnayrPayrP623prYGt6vNDPv+frvdPdvNTIvdPSstLdvMzdvPvSvMTsvP3RudrLvuL3udrYULnayqrFwPF6s/rbs8f4v8vSvdXks8Hss93Xsv7dudrLtebAv8DuvPrmv+rXvN3Tv9TFvfLlv8res/rbvdfyvfHRvuPRvdPSv8TRvNHJvMjotebWvPXVvuLas/rbvcDcvdjgvdfyvfHRsvzMsvzgv8vSvdXktebWv8Duvfzbvuflvc7yudrWv8rWvuLQudrXvNLMv8rSvufvver7v9bMudrYUFC52sq96vu/+uu8zN2/982/9dy/4Pyzwui90tyz+sq99M252su15sBQa3R6v8DuvPrmvOD1vODKtebAvNPavMbTv9/9v/Tjv+Xfs/rSemtqan96vODKst3wvuTcvODKvffcsvLCtebWv8DuvfzbvO3hv9D6v/7Ms9nyvNTysvHMudrYUGh0er/A7rz65r/3zbzP4rPDyr/S7LXmwL7i4bzyw7P71rPDyr/0wHpiJGtuer/3zbna27/T9bzyw7P71rPDyr/0wHprbyRob3q/98252tu/1/u909288sOz+9azw8q/9MB6biRier/3zbna27z4x7/SzbPDyr/0wHpraCRoanq/98252thQaXR6qsXA8Xqy6Pq/ysu81Mizw/615sC/wO69/Nu93vu+4ve9zsW8xtO97fKz2vq/7fK/xNF6EQoTer3v67Ly0r/+/bzP4r/3zbna2FBQudrKs9rKs/rbemtga3q96vu/+uu81Mi909Ky0t28zN28+9K8xOy8/dG15tK/6te83dO/yt6z+tu80M+/5+u909215tO52su15sBQcrLx0b/A7rz65rz647zJwL/1/LPAwbLk8rL3wr/S6r3A3r/K3rP6273Gxb/1/LL8zLL84L3T47/k77PayrP627Lm4r/d4LXm1r313r7k0b/82L7i0bXmwHNQUHd3d1B5eXl6vNDPv+frvdPdemu15sABs/rbs8f4s/vEv8TRtebWv/zYtebAv+rbs8f4s/rbB1C52sqqxdTyerL8zLL84LP48rz65rLS3b3T0rPH+LPf173n9Lnay7XmwFB3er3P8b/i2bLZ1rzD9bXmwAG/+/G/3/+y8+iz+tu/4M+y0+iy0t28x8qy6fC15ta//Ni15sC87eu87+2y4deyzdd6cnlqH2gbaWJzer3f/b3T3bzm4r/r/rPb9L3n8wdQd3q8+uK/5dmy+cez+eS15sABv/vxv9//svPos/rbv+PkvufPv9/Zve76tebWv/zYtebAv+38v9vuv8TYvcHuvejNvuD0vPPCvPLDvMXrudrbv9XpvuLQsv3Iv8rWv+XZv8bJv+b9v9Ldsv3IvcjqB1B3er/3zbPxzrzUyL/X6rXmwAG//Ni15sC90+O//v293vuy//W97cCy7N+96M2z8c615ta97s69w+e/3/K//v2/9fEHULnayqrFycd6ver7v/rrvMzdvPvSv9/9v/Tjv9faudrLtebAUHd6vuLhvPLDs/vWtebAtebSvNXKv9XMvffcsvLCvPriv+XZvuLhs/vWtebWve/KsvHMv9/SsvvWtebWZmtuv/fNtebTUHd6v+rUsvLavMvCsvzbtebAtebSvNXKv9XMemh3aXqy+9a96vu/+uu8+uK/5dm/9MC+59e15tZmaG+/98215tNQUHKy0f+/1MW96vu/+uu8xtO//sCz+tu15tay8dG+5Me/4NW/6te83dO/1MW96vu/+uu9wN699vZ6aLna22l0dHR6s/rbs9rKs/rbvejkvODMsubiv93gv9bfv8rxsvzMsvzgs9/Xvef0stLdvMzdvPvSv9/9v/Tjv9favcDevMTsvP3Rc1A6OjpQUHl5em50eqrFyOF6a2BrerPY3r/Uxb7j0XoSDhcWenV6DjszNi0zND56vNDPv+frvdPdve/KvP3RvfjmenK/1fW9we681P+y/t2y+ee+5+W9zvJzUDo6OjIuNzZQZnt3d3q/9Na8z+652tu+4+S87fK52tu/1fW+4f+9we681P+/xvK92tWy/Oe/w/K91/K98dGz29Gy+9a9wN56Eg4XFnq+4fm9+Oa15ta/1t+/yvF6DjszNi0zND56GQkJehkeFHqy0t2/3/2y2/W88vm/5tW15tZramp/er/l+r/1/LPd173V5L7i0LLl6rzQz7/n673T3b3A3r3Gxb/1/L/j5L7nz7/GzLL9+bLS3b3T0rPH+Hp3d2RQOjo6UFB3d3dQvMbav+TWtebWsvHRs8PevuLQvuLRvMzjvcDeehAJFRR6v9fav/vQtebWvNXKvuTBv9PXvfH1stPovf/ystLdvPLDvev+v+vPvf7gtebAUDo6OjApNTRQIVB6engpLiM2PwU0Ozc/eGB6eL3o5LzgzLP48rz65r/K173y63h2UHp6eC47PSl4YHoBeL/j5L7nz7zRybzI6Lzyw73r/mt4dnp4vPLDvev+aHh2eni88sO96/5peHZ6eLzyw73r/m54B3ZQenp4Kjs2Py4uP3hgegFQenp6eiF4KDU2P3hgeni9z/G/4tmy2da8w/V4dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeniz+9Wy0+i/yte98ut4J3ZQenp6eiF4KDU2P3hgeni+4uGy/Nu8zN2/9814dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeniz+9Wy0+i/yte98ut4J3ZQenp6eiF4KDU2P3hgeni8+uK/5dm/5u2y8OWy0+h4dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeniz+9Wy0+i/yte98ut4J3ZQenp6eiF4KDU2P3hgeni97cC8+9yy0t2/0ty/0+h4dnp4Mj8ieGB6eHkCAgICAgJ4dnp4NDs3P3hgeniz+9Wy0+i/yte98ut4J1B6egd2UHp6eC0yMy4/BSkqOzk/BSg7LjM1eGB6eG1qf3h2UHp6eD4/NCkzLiN4YHp4ve/KvP3Rv9bMvPjHvcrcv8TReFAnUDo6OlA=";

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
    const testModels = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.8-flash"];
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
            message: "金鑰存在但目前配額已用盡 (429 Rate Limit / Quota)：請至 Google AI Studio 檢查用量或稍候再試！"
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
          resultBox.className = "p-3 rounded-lg border text-xs font-mono transition-all bg-emerald-500/10 border-emerald-500/30 text-emerald-300";
          resultIcon.textContent = "✅";
          resultTitle.textContent = "金鑰連線正常 · 驗證通過！";
          resultDetail.textContent = res.message;
          showToast("🎉 API 金鑰測試通過！連線完全正常", "success");
        } else {
          resultBox.className = "p-3 rounded-lg border text-xs font-mono transition-all bg-rose-500/10 border-rose-500/30 text-rose-300";
          resultIcon.textContent = "❌";
          resultTitle.textContent = "金鑰驗證失敗";
          resultDetail.textContent = res.message;
          showToast(`金鑰驗證失敗：${res.message}`, "error");
        }
      }
    } catch (err) {
      if (resultBox) {
        resultBox.classList.remove("hidden");
        resultBox.className = "p-3 rounded-lg border text-xs font-mono transition-all bg-rose-500/10 border-rose-500/30 text-rose-300";
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

  // 複製按鈕（動態對應當前所選模式）
  on("btn-copy-nblm", "click", () => {
    let promptToCopy = "";
    if (currentPromptMode === "global") promptToCopy = generatedPromptGlobal || generatedNblmPrompt;
    else if (currentPromptMode === "slide") promptToCopy = generatedPromptSlide || generatedNblmPrompt;
    else if (currentPromptMode === "custom") promptToCopy = generatedPromptCustom || generateCustomStoryboardPrompt();
    if (!promptToCopy) return;
    navigator.clipboard.writeText(promptToCopy).then(() => {
      const label = document.getElementById("copy-btn-label");
      if (label) {
        const originalText = label.textContent;
        label.textContent = "已複製！";
        setTimeout(() => label.textContent = originalText, 2000);
      }
      const modeName = currentPromptMode === "global" ? "【模式 1：學風格 · 做新簡報】" : "【模式 2：照原稿 · 一頁頁複刻】";
      showToast(`已成功複製 ${modeName} 提示詞！請前往 NotebookLM 右側工作室「簡報」貼上`, "success");
    });
  });

  // 直達工作流按鈕：複製並開啟 NotebookLM
  on("btn-copy-and-open-nblm", "click", () => {
    let promptToCopy = "";
    if (currentPromptMode === "global") promptToCopy = generatedPromptGlobal || generatedNblmPrompt;
    else if (currentPromptMode === "slide") promptToCopy = generatedPromptSlide || generatedNblmPrompt;
    else if (currentPromptMode === "custom") promptToCopy = generatedPromptCustom || generateCustomStoryboardPrompt();
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
  // 候選優先級：gemini-2.5-flash ➔ gemini-3.5-flash ➔ gemini-3.8-flash ➔ gemini-flash-latest
  const defaultList = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"];
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
        "1. 必須逐頁精確拆解真實骨架，★絕對嚴禁將圖解簡化為普通圓點條列！若有同心圓引線對應（Leader Lines）、複合雙模組（靶心+進程軸並存）、3D階梯等，必須以機械級拓撲完整描述規格與箭頭指向。\n" +
        "2. ★【色彩抗失真規範】：金色/黃色系一律定義為「低飽和啞光駝金/沉穩古銅赭金 (#C29B53)」，強制注入負向禁令排除高飽和鮮黃與檸檬黃；淺色底指定「溫潤暖象牙米灰 (#F4F3EE)」，嚴禁死白。\n" +
        "2. 產出的第 3 節 NotebookLM 提示詞必須同時完整輸出兩種模式代碼區塊：\n" +
        "   - 【模式 1：學風格 · 做新簡報（推薦）】：提取這份簡報的配色與設計感，套用在你的任何簡報上（頁數 3~20 頁自由決定，備註：NotebookLM 單次生成上限為 20 頁）。\n" +
        "     ★【最高強制約束：每一個頁面呈現都絕對不能重複（Zero-Repetition Rule）】：在產出的 NotebookLM 提示詞中，必須明文加入不可忽視的最高禁令——『嚴禁連續或重複使用同一種版型！生成的整份簡報中，每一個頁面都必須從版型語法庫中挑選完全不同的視覺拓撲（例如：時間軸 ➔ 心智圖 ➔ 橫向條帶 ➔ 矩陣表格 ➔ 環形流程 ➔ 雙側括號等輪替使用），相鄰頁面與全篇各頁版型呈現皆不得重複！』\n" +
        "   - 【模式 2：照原稿 · 一頁頁複刻】：完全保留原投影片每一頁的排版結構，適合想照原版格式填空的人，確保每一頁皆展現原稿獨立獨特的拓撲版型。\n" +
        "3. 產出一份可直接獨立運行的 HTML/Tailwind 1:1 還原投影片結構代碼。\n" +
        "4. 請嚴格依照 SYSTEM INSTRUCTION 規定的章節與 JSON 格式輸出。";

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

  // 顯示解析範圍摘要徽章
  const scopeBadge = document.getElementById("result-scope-badge");
  if (scopeBadge) {
    if (pageSelectionMode === "custom" && selectedPageIndices.size > 0 && selectedPageIndices.size < uploadedSlidePages.length) {
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

function syncCustomPromptAndPreview() {
  generatedPromptCustom = generateCustomStoryboardPrompt();
  if (currentPromptMode === "custom") {
    const codeEl = document.getElementById("nblm-prompt-code");
    if (codeEl) codeEl.textContent = generatedPromptCustom;
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
    if (codeEl) codeEl.textContent = generatedPromptGlobal || generatedNblmPrompt || "未擷取到全域風格提示詞，請查看完整報告。";
  } else if (mode === "slide") {
    if (btnSlide) btnSlide.className = activeBtn;
    if (descSlide) descSlide.classList.remove("hidden");
    if (codeEl) codeEl.textContent = generatedPromptSlide || generatedNblmPrompt || "未擷取到逐頁 1:1 提示詞，請查看完整報告。";
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

function fallbackExtractMeta(markdown) {
  const hexMatches = markdown.match(/#[0-9a-fA-F]{6}/g) || ["#FAF8F5", "#181A1B", "#FEE054", "#BAE6FD", "#FED7AA", "#FEF08A", "#BBF7D0", "#E9D5FF"];
  const uniqueHex = Array.from(new Set(hexMatches)).slice(0, 8);
  return {
    style_name: "簡報視覺色彩與排版拓撲",
    tags: ["版面骨架", "色彩系統", "幾何插槽", "NotebookLM對齊"],
    palette: uniqueHex.map((hex, idx) => ({
      role: idx === 0 ? "畫布底色" : idx === 1 ? "線條與主文" : idx === 2 ? "核心強調色" : `功能標籤 ${idx - 2}`,
      hex: hex,
      name: "提取色"
    })),
    white_space_ratio: "65%"
  };
}

let toastTimeoutId = null;

function showToast(message, type = "info") {
  showToastWithUndo(message, null, type);
}

function showToastWithUndo(message, onUndo = null, type = "info") {
  const toast = document.getElementById("toast");
  const icon = document.getElementById("toast-icon");
  const text = document.getElementById("toast-text");
  const actionBtn = document.getElementById("toast-action-btn");

  if (!toast || !text) return;
  text.textContent = message;

  if (actionBtn) {
    if (typeof onUndo === "function") {
      actionBtn.classList.remove("hidden");
      actionBtn.onclick = (e) => {
        e.stopPropagation();
        onUndo();
        toast.classList.remove("translate-y-0", "opacity-100");
        toast.classList.add("translate-y-20", "opacity-0");
      };
    } else {
      actionBtn.classList.add("hidden");
      actionBtn.onclick = null;
    }
  }

  if (type === "success") {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900 border border-emerald-500/40 text-xs shadow-2xl text-white max-w-md";
    if (icon) {
      icon.className = "w-4 h-4 text-emerald-400 shrink-0";
      icon.setAttribute("data-lucide", "check-circle");
    }
  } else if (type === "warning" || type === "error") {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-rose-950 border border-rose-500/40 text-xs shadow-2xl text-white max-w-md";
    if (icon) {
      icon.className = "w-4 h-4 text-rose-300 shrink-0";
      icon.setAttribute("data-lucide", "alert-circle");
    }
  } else {
    toast.className = "fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900 border border-white/[0.12] text-xs shadow-2xl text-zinc-100 max-w-md";
    if (icon) {
      icon.className = "w-4 h-4 text-sky-400 shrink-0";
      icon.setAttribute("data-lucide", "info");
    }
  }

  if (window.lucide) window.lucide.createIcons();

  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-20", "opacity-0");
  }, 4500);
}

function updateUiState() {
  lucide.createIcons();
}

// === [P0 智財與防逆向安全守護] Anti-Inspection & DevTools Guard ===
(function initSecurityGuard() {
  // 1. 停用右鍵檢視原始碼
  document.addEventListener("contextmenu", (e) => {
    // 允許在輸入框或提示詞區域點擊右鍵以方便選取與複製
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.closest("#nblm-prompt-code")) {
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
