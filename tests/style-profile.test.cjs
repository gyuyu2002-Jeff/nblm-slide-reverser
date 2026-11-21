const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'guardrails.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const profile = {
  rules: [
    { property: '強調色', value: '#5649EC', scope: '目錄選取項及內容框線', source_pages: ['P.8', 'P.17'], evidence: '物件取值' },
    { property: '容器', value: '直角、細框、無陰影', scope: '內容卡片', source_pages: ['P.17'], evidence: '影像估計' },
    { property: '字體', value: '無襯線黑體', scope: '全篇', source_pages: ['P.1'], evidence: '影像估計' },
  ],
  layouts: [{ id: 'D', name: '三欄原稿卡片', description: '三欄直角紫色細框，照片在上方', source_pages: ['P.17'] }],
};
const report = '## 3. 📋 NotebookLM 專用簡報提示詞\n### 模式 1\n```markdown\n【任務宣告】：紫色風格\n```\n### 模式 2\n```markdown\n【任務宣告】：逐頁版型\n```\n## 4. HTML\n```json\n' + JSON.stringify({ style_name: '原稿', palette: [], design_profile: profile }) + '\n```';

function context() {
  const elements = new Map();
  const element = () => {
    const classes = new Set();
    return { textContent: '', innerHTML: '', children: [], classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }, toggle() {},
    }, appendChild(child) { this.children.push(child); }, querySelectorAll: () => [], querySelector: () => null };
  };
  const ctx = {
    console: { log() {}, warn() {} }, localStorage: { getItem: () => null },
    document: { addEventListener() {}, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll: () => [], createElement: element },
    window: {}, setInterval() {}, setTimeout() {}, marked: { parse: x => x }, DOMPurify: { sanitize: x => x }, lucide: { createIcons() {} },
    fetch: async () => ({ ok: true, json: async () => config }), report,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  vm.runInContext('updateComparisonView = () => {}; switchResultTab = () => {}; renderColorPalette = () => {}; renderCustomStoryboardUI = () => {}; handlePostAnalysisSave = () => {}; showToast = () => {};', ctx);
  return ctx;
}

test('custom mode uses newly analyzed profile and source layouts, including when already active', () => {
  const ctx = context();
  vm.runInContext('currentPromptMode = "custom"; renderAnalysisResult({ markdown_report: report });', ctx);
  const prompt = vm.runInContext('generatedPromptCustom', ctx);
  assert.match(prompt, /#5649EC/);
  assert.match(prompt, /直角、細框、無陰影/);
  assert.match(prompt, /無襯線黑體/);
  assert.match(prompt, /P\.17/);
  assert.doesNotMatch(prompt, /C29B53|駝金|九十天|95%/);
  assert.match(ctx.document.getElementById('design-profile-evidence').textContent, /物件取值/);
});

test('loading another saved style clears stale profile; legacy styles keep their own prompt', () => {
  const ctx = context();
  vm.runInContext('renderAnalysisResult({ markdown_report: report }); savedStylesCache = [{ id: "old", title: "舊收藏", globalPrompt: "【任務宣告】：使用 #123456 冷色風格", tags: [], palette: [] }]; loadSavedStyleIntoWorkspace("old"); switchPromptMode("custom");', ctx);
  const prompt = vm.runInContext('generatedPromptCustom', ctx);
  assert.match(prompt, /#123456/);
  assert.doesNotMatch(prompt, /#5649EC|駝金/);
  assert.equal(vm.runInContext('currentDesignProfile.rules.length', ctx), 0);
});

test('saved profile survives mode switching without selecting hardcoded fallback layout D', () => {
  const ctx = context();
  ctx.savedProfile = { ...profile, layouts: [{ ...profile.layouts[0], id: 'Q' }] };
  vm.runInContext('savedStylesCache = [{ id: "new", title: "新收藏", designProfile: savedProfile, globalPrompt: "【任務宣告】：global", slidePrompt: "【任務宣告】：slide", tags: [], palette: [] }]; loadSavedStyleIntoWorkspace("new"); switchPromptMode("slide"); switchPromptMode("global"); switchPromptMode("custom");', ctx);
  assert.match(vm.runInContext('generatedPromptCustom', ctx), /版型 Q/);
  assert.match(vm.runInContext('generatedPromptCustom', ctx), /#5649EC/);
});

test('representative selection includes the final page, keeps order and does not duplicate pages', () => {
  const ctx = context();
  for (const length of [1, 8, 30, 31, 150]) {
    ctx.pages = Array.from({ length }, (_, i) => ({ page: i + 1 }));
    const result = vm.runInContext('selectAnalysisPages(pages)', ctx);
    assert.equal(result.length, Math.min(length, 30));
    assert.equal(result[0].page, 1);
    assert.equal(result.at(-1).page, length);
    assert.equal(new Set(result).size, result.length);
  }
});

test('unknown analysis does not invent a palette or measured whitespace', () => {
  const ctx = context();
  const meta = vm.runInContext('fallbackExtractMeta("尚無可辨識規格")', ctx);
  assert.equal(meta.palette.length, 0);
  assert.equal(meta.white_space_ratio, '未量測');
});

test('invalid layout IDs are rejected and dynamic text is HTML escaped', () => {
  const ctx = context();
  ctx.unsafe = { layouts: [{ id: '\"><img>', name: 'bad', description: 'bad' }], rules: [null, {}] };
  assert.equal(vm.runInContext('normalizeDesignProfile(unsafe).layouts.length', ctx), 0);
  assert.equal(vm.runInContext('normalizeDesignProfile(unsafe).rules.length', ctx), 0);
  assert.equal(vm.runInContext('escapeStoryboardText(\'<img src=x onerror="boom">\')', ctx), '&lt;img src=x onerror=&quot;boom&quot;&gt;');
});

test('shared rules are loaded before use, with explicit failure instead of old-style fallback', async () => {
  const ctx = context();
  assert.throws(() => vm.runInContext('getEffectiveSystemInstruction()', ctx), /尚未載入/);
  assert.equal(await vm.runInContext('loadDynamicGuardrails()', ctx), true);
  const instruction = vm.runInContext('getEffectiveSystemInstruction()', ctx);
  assert.equal(instruction, config.system_instruction + '\n' + config.rules.map(r => r.rule).join('\n'));
  const failed = context();
  failed.fetch = async () => ({ ok: false });
  assert.equal(await vm.runInContext('loadDynamicGuardrails()', failed), false);
  assert.throws(() => vm.runInContext('getEffectiveSystemInstruction()', failed), /尚未載入/);
});

test('OpenAI request includes every selected image and source labels', async () => {
  const ctx = context();
  await vm.runInContext('loadDynamicGuardrails()', ctx);
  let payload;
  ctx.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: report } }] }) };
  };
  ctx.pages = Array.from({ length: 8 }, (_, i) => ({ page: i + 1, image: 'data:image/png;base64,AA==' }));
  await vm.runInContext('callOpenAiDirectly("mock-key", "test-model", pages, "test")', ctx);
  const content = payload.messages[1].content;
  assert.equal(content.filter(p => p.type === 'image_url').length, 8);
  assert.ok(content.some(p => p.type === 'text' && p.text.includes('P.8')));
});

test('storage migration never appends guessed visual rules to new or legacy prompts', () => {
  const ctx = context();
  for (const record of [
    { schemaVersion: 2, designProfile: profile, title: '黑板主題', globalPrompt: '維持 #5649EC 單色', slidePrompt: '矩形框' },
    { title: '筆記本', globalPrompt: '既有提示詞', slidePrompt: '原本內容' },
  ]) {
    ctx.record = record;
    const before = JSON.stringify(record);
    vm.runInContext('upgradeSavedStyleRecord(record)', ctx);
    assert.equal(JSON.stringify(record), before);
  }
});

test('saved cards and modal treat imported metadata as text, reject CSS and image URL injection', () => {
  const ctx = context();
  ctx.record = { id: 'unsafe', title: '<img src=x onerror="boom">', dateLabel: '<svg onload="boom">',
    coverImage: 'x" onerror="boom', pageCount: '<img src=x>',
    palette: [{ hex: '#123456', role: '" onmouseover="boom' }, { hex: 'red;" onmouseover="boom' }] };
  vm.runInContext('savedStylesCache = [record]; renderSavedStylesList(); openSaveStyleModal("unsafe");', ctx);
  const html = ctx.document.getElementById('saved-styles-list').children[0].innerHTML;
  assert.doesNotMatch(html, /<img src=x|<svg onload|onerror="boom"|onmouseover="boom"/);
  assert.match(html, /&lt;img/);
  assert.match(html, /#123456/);
  assert.doesNotMatch(ctx.document.getElementById('save-modal-swatches').innerHTML, /onmouseover|red;/);
  assert.equal(ctx.document.getElementById('save-modal-preview-img').src, '');
});

test('oversized PDF is rejected with the page-limit message and cannot contaminate later uploads', async () => {
  const ctx = context();
  let requests = 0;
  const messages = [];
  ctx.window.location = { hostname: 'localhost' };
  ctx.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve({ numPages: 151 }) }) };
  ctx.file = { name: 'oversize.pdf', arrayBuffer: async () => new ArrayBuffer(0) };
  ctx.fetch = async () => { requests++; return { ok: false }; };
  ctx.FormData = class { append() {} };
  ctx.captureToast = message => messages.push(message);
  vm.runInContext('showToast = captureToast; renderThumbnails = () => {};', ctx);
  await vm.runInContext('handleFilesAdded([file])', ctx);
  assert.equal(requests, 0);
  assert.equal(vm.runInContext('selectedFiles.length', ctx), 0);
  assert.ok(messages.some(message => message.includes('150')));
});

test('rejected PPTX shows backend detail and is removed from subsequent analysis inputs', async () => {
  const ctx = context();
  const messages = [];
  ctx.window.location = { hostname: 'localhost' };
  ctx.file = { name: 'oversize.pptx' };
  ctx.fetch = async () => ({ ok: false, json: async () => ({ detail: 'PPTX 超過 150 頁，請先拆分檔案。' }) });
  ctx.FormData = class { append() {} };
  ctx.captureToast = message => messages.push(message);
  vm.runInContext('showToast = captureToast; renderThumbnails = () => {};', ctx);
  await vm.runInContext('handleFilesAdded([file])', ctx);
  assert.equal(vm.runInContext('selectedFiles.length', ctx), 0);
  assert.ok(messages.some(message => message.includes('150')));
  assert.ok(!messages.some(message => message.includes('純靜態')));
});

test('automatic sampling switches visible controls from all pages to the actual custom selection', async () => {
  const ctx = context();
  ctx.window.location = { hostname: 'example.github.io', protocol: 'https:' };
  ctx.setTimeout = callback => callback();
  ctx.console.error = error => { throw error; };
  let received;
  ctx.capturePages = (_key, _model, pages) => { received = pages; return {}; };
  vm.runInContext(`
    uploadedSlidePages = Array.from({ length: 40 }, (_, i) => ({ page: i + 1, image: '' }));
    pageSelectionMode = 'all'; updatePageSelectionModeUI();
    currentProvider = 'openai'; getApiKey = () => 'test-placeholder';
    _systemInstruction = 'test'; startProgressPipeline = () => {};
    completeProgressPipeline = () => {}; stopProgressPipeline = () => {};
    renderThumbnails = () => {}; renderAnalysisResult = () => {};
    extractDominantColorsFromImage = async () => []; callOpenAiDirectly = capturePages;
  `, ctx);
  assert.equal(ctx.document.getElementById('custom-pages-controls').classList.contains('hidden'), true);
  await vm.runInContext('handleStartAnalyze()', ctx);
  assert.equal(ctx.document.getElementById('custom-pages-controls').classList.contains('hidden'), false);
  assert.match(ctx.document.getElementById('btn-mode-custom-pages').className, /active/);
  assert.doesNotMatch(ctx.document.getElementById('btn-mode-all-pages').className, /active/);
  assert.equal(received.length, 30);
  assert.equal(received.at(-1).page, 40);
});
