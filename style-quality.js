/* Structured source evidence is the single input for both prompt modes. */
(function (root) {
  'use strict';
  const list = value => Array.isArray(value) ? value : [];
  const text = value => typeof value === 'string' ? value.trim() : '';
  const pageId = value => {
    const match = String(value ?? '').match(/^(?:P\.?\s*)?([1-9]\d*)$/i);
    return match ? `P.${Number(match[1])}` : '';
  };
  const hex = value => /^#[0-9a-f]{6}$/i.test(text(value)) ? text(value).toUpperCase() : '';
  const luminance = value => {
    const rgb = hex(value).slice(1).match(/../g);
    if (!rgb) return null;
    const linear = rgb.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  };

  // Read complete JSON objects even when a Markdown closing fence is absent.
  // This does not repair JSON syntax or accept a truncated object.
  function metadataBlocks(markdown) {
    const source = typeof markdown === 'string' ? markdown : '';
    const markers = /```json\s*/gi;
    const blocks = [];
    let marker;
    while ((marker = markers.exec(source))) {
      const start = markers.lastIndex;
      if (source[start] !== '{') continue;
      let depth = 0, quoted = false, escaped = false;
      for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') quoted = false;
          continue;
        }
        if (c === '"') quoted = true;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') depth--;
        if (depth === 0) {
          let end = i + 1;
          const fence = source.slice(end).match(/^\s*```(?=\s|$)/);
          if (fence) end += fence[0].length;
          try { blocks.push({ value: JSON.parse(source.slice(start, i + 1)), start: marker.index, end }); }
          catch (_) {}
          markers.lastIndex = end;
          break;
        }
      }
    }
    return blocks;
  }

  function inspect(profile, context = {}) {
    const issues = [];
    const issue = (code, message, page = '') => issues.push({ code, message, page });
    const expected = list(context.source_pages).map(pageId);
    if (!expected.length || expected.some(p => !p) || new Set(expected).size !== expected.length) {
      issue('source_scope', '缺少可核對的實際來源頁範圍，請重新分析原稿。');
    }
    const layouts = list(profile?.layouts);
    const ids = new Set();
    for (const layout of layouts) {
      if (!layout || !/^[A-Z]$/.test(layout.id) || ids.has(layout.id)) {
        issue('layout_id', '版型代號無效或重複。'); continue;
      }
      ids.add(layout.id);
      if (!text(layout.name) || !text(layout.description)) issue('layout_description', `版型 ${layout.id} 缺少名稱或配置描述。`);
      const sources = list(layout.source_pages).map(pageId);
      if (!sources.length || sources.some(p => !expected.includes(p)) || new Set(sources).size !== sources.length) issue('layout_source', `版型 ${layout.id} 缺少來源，或引用未分析頁面。`);
    }
    if (!layouts.length) issue('layouts_missing', '沒有可用版型，請重新分析或補齊規格。');
    for (const rule of list(profile?.rules)) {
      if (!rule || !text(rule.property) || !text(rule.value) || !text(rule.scope) || !list(rule.source_pages).length || list(rule.source_pages).map(pageId).some(p => !expected.includes(p))) {
        issue('rule_source', '風格規則缺少適用範圍、來源，或引用未分析頁面。');
      }
    }
    const pages = list(profile?.pages);
    const seen = new Set();
    for (const page of pages) {
      const id = pageId(page?.source_page);
      if (!id || !expected.includes(id)) { issue('unknown_page', '逐頁規格包含未分析或無效頁碼。', id); continue; }
      if (seen.has(id)) issue('duplicate_page', `${id} 重複出現在逐頁規格中。`, id);
      seen.add(id);
      const layout = layouts.find(l => l && l.id === page.layout_id);
      if (!layout) issue('page_layout', `${id} 引用不存在的版型。`, id);
      else if (!list(layout.source_pages).map(pageId).includes(id)) issue('layout_mapping', `${id} 與版型 ${layout.id} 的來源頁對應不一致。`, id);
      if (!['light', 'dark', 'mixed'].includes(page.background)) issue('background_unknown', `${id} 尚未辨認主要背景明暗。`, id);
      if (!text(page.background_description)) issue('background_scope', `${id} 缺少背景範圍說明（含局部照片／頁腳）。`, id);
      if (!hex(page.background_color) || !hex(page.text_color)) issue('page_colors', `${id} 缺少有效的背景與主文字色。`, id);
      if (!text(page.material)) issue('material_missing', `${id} 缺少圖像材質說明。`, id);
      const bg = luminance(page.background_color), fg = luminance(page.text_color);
      if (bg !== null && fg !== null && (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) < 3) {
        issue('text_contrast', `${id} 背景與文字估計色對比偏低，請核對。`, id);
      }
      if ((page.background === 'light' && bg !== null && bg < .35) || (page.background === 'dark' && bg !== null && bg > .35)) {
        issue('background_color', `${id} 背景明暗與估計色碼矛盾。`, id);
      }
      const sample = list(context.pixel_evidence).find(p => pageId(p.source_page) === id);
      const mismatch = sample && ((sample.lightRatio >= .65 && page.background === 'dark') || (sample.darkRatio >= .65 && page.background === 'light'));
      const confirmed = context.confirmations?.[id];
      const signature = JSON.stringify([page.background, page.background_description, page.background_color]);
      if (mismatch && !(confirmed?.signature === signature && text(confirmed.reason))) {
        issue('pixel_conflict', `${id} 背景判斷與像素取樣不符，請看原稿修正，或記錄照片／局部區域造成差異的原因。`, id);
      }
    }
    for (const layout of layouts.filter(l => l && /^[A-Z]$/.test(l.id))) {
      if (list(layout.source_pages).some(id => !pages.some(p => p && pageId(p.source_page) === pageId(id) && p.layout_id === layout.id))) {
        issue('layout_mapping', `版型 ${layout.id} 的來源頁與逐頁指定不一致。`);
      }
    }
    for (const id of expected) if (id && !seen.has(id)) issue('missing_page', `${id} 缺少逐頁規格。`, id);
    return { ready: issues.length === 0, issues };
  }

  function compile(profile, context) {
    const quality = inspect(profile, context);
    if (!quality.ready) return { globalPrompt: '', slidePrompt: '', quality };
    const pages = [...profile.pages].sort((a, b) => Number(pageId(a.source_page).slice(2)) - Number(pageId(b.source_page).slice(2)));
    const layouts = [...profile.layouts].sort((a, b) => {
      const first = l => Math.min(...l.source_pages.map(p => Number(pageId(p).slice(2))));
      return first(a) - first(b) || a.id.localeCompare(b.id);
    });
    const canonical = new Map(layouts.map((l, i) => [l.id, String.fromCharCode(65 + i)]));
    const pageStyle = p => `背景：${p.background_description}（${hex(p.background_color)}）；主文字：${hex(p.text_color)}；圖像材質：${p.material}`;
    const rules = list(profile.rules).filter(r => r && text(r.property) && text(r.value) && text(r.scope) && !/背景|文字色|字色/.test(r.property));
    const base = `【任務宣告】\n依來源筆記建立 16:9 簡報，使用台灣繁體中文。以下色碼是影像估計，版型與色碼只作設計指令，不印在畫面上。\n【內容與排版】\n品牌、事實與聯絡資料只取自新內容，不移植參考公司的商標、署名或 QR Code。來源圖像的具體物件僅作觀察紀錄，輸出時只借用材質、線條與構圖；圖像主體必須換成新主題相關的產品或物件。除非新內容明確提供已核對的 QR Code 圖檔，否則不生成 QR Code，該位置改放產品圖或留白。不捏造數字。標題與正文分區，保留間距；標題過長先縮短，不自行新增英文副標或括號英譯；僅保留來源中必要的型號、單位與專有名稱。內容過長拆頁，允許相近頁型重複，不強制固定字數或留白率。\n【來源風格規格】\n`;
    const library = layouts.map(l => {
      const instances = pages.filter(p => p.layout_id === l.id);
      const specs = [...new Set(instances.map(pageStyle))];
      return `- 版型 ${canonical.get(l.id)}：${l.name}。${l.description}\n  ${specs.join('\n  ')}\n  來源：${instances.map(p => pageId(p.source_page)).join('、')}`;
    }).join('\n');
    const extra = rules.map(r => `- ${r.property}：${r.value}；僅適用：${r.scope}。`).join('\n');
    const palette = list(context.palette).filter(c => c && hex(c.hex) && text(c.role)).map(c => `${text(c.role)}：${hex(c.hex)}`).join('；');
    const paletteNote = palette ? `\n【色彩用途候選】\n${palette}。僅在所述用途使用，主畫布與文字以各頁規格為準。\n` : '';
    const globalPrompt = base + library + (extra ? '\n' + extra : '') + paletteNote + '\n【使用方式】\n依新內容選擇適合的版型與節點數，不把封面材質或局部裝飾套到所有內頁。';
    const slidePrompt = base + (extra ? extra + '\n' : '') + paletteNote + '【逐頁參考】\n' + pages.map((p, i) => {
      const layout = layouts.find(l => l.id === p.layout_id);
      return `第 ${i + 1} 頁（來源 ${pageId(p.source_page)}；版型 ${canonical.get(p.layout_id)}：${layout.name}）\n${layout.description}\n${pageStyle(p)}。`;
    }).join('\n');
    return { globalPrompt, slidePrompt, quality, layoutIds: Object.fromEntries(canonical) };
  }
  const api = { inspect, compile, pageId, metadataBlocks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StyleQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
