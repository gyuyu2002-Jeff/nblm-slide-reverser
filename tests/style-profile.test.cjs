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
    { property: '強調色', value: '#5649EC', scope: '目錄選取項及內容框線', source_pages: ['P.17'], evidence: '物件取值' },
    { property: '容器', value: '直角、細框、無陰影', scope: '內容卡片', source_pages: ['P.17'], evidence: '影像估計' },
    { property: '字體', value: '無襯線黑體', scope: '全篇', source_pages: ['P.17'], evidence: '影像估計' },
  ],
  pages: [{source_page:'P.17', layout_id:'D', background:'light', background_description:'白底主畫布，深色細頁腳', background_color:'#FFFFFF', text_color:'#111111', material:'線性圖示'}],
  layouts: [{ id: 'D', name: '三欄原稿卡片', description: '三欄直角紫色細框，照片在上方', source_pages: ['P.17'] }],
};
const report = '## 3. 📋 NotebookLM 專用簡報提示詞\n### 模式 1\n```markdown\n【任務宣告】：紫色風格\n```\n### 模式 2\n```markdown\n【任務宣告】：逐頁版型\n```\n## 4. HTML\n```json\n' + JSON.stringify({ style_name: '原稿', palette: [], design_profile: profile }) + '\n```';

function context() {
  const elements = new Map();
  const element = () => {
    const classes = new Set();
    return { textContent: '', innerHTML: '', children: [], listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, replaceChildren() { this.children = []; }, classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }, toggle() {},
    }, appendChild(child) { this.children.push(child); }, querySelectorAll: () => [], querySelector: () => null };
  };
  const ctx = {
    console: { log() {}, warn() {} }, localStorage: { getItem: () => null },
    document: { addEventListener() {}, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll: () => [], createElement: element },
    StyleQuality: require('../style-quality.js'), structuredClone,
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
  vm.runInContext('currentPromptMode = "custom"; renderAnalysisResult({ markdown_report: report, analysis_context: {source_pages:["P.17"]} });', ctx);
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
  vm.runInContext('renderAnalysisResult({ markdown_report: report, analysis_context: {source_pages:["P.17"]} }); savedStylesCache = [{ id: "old", title: "舊收藏", globalPrompt: "【任務宣告】：使用 #123456 冷色風格", tags: [], palette: [] }]; loadSavedStyleIntoWorkspace("old"); switchPromptMode("custom");', ctx);
  const prompt = vm.runInContext('generatedPromptCustom', ctx);
  assert.match(prompt, /待核對/);
  assert.match(vm.runInContext('savedStylesCache[0].globalPrompt', ctx), /#123456/);
  assert.doesNotMatch(prompt, /#5649EC|駝金/);
  assert.equal(vm.runInContext('currentDesignProfile.rules.length', ctx), 0);
});

test('saved profile survives mode switching without selecting hardcoded fallback layout D', () => {
  const ctx = context();
  ctx.savedProfile = { ...profile, pages:profile.pages.map(p=>({...p,layout_id:'Q'})), layouts: [{ ...profile.layouts[0], id: 'Q' }] };
  vm.runInContext('savedStylesCache = [{ id: "new", title: "新收藏", designProfile: savedProfile, analysisContext: {source_pages:["P.17"]}, globalPrompt: "【任務宣告】：global", slidePrompt: "【任務宣告】：slide", tags: [], palette: [] }]; loadSavedStyleIntoWorkspace("new"); switchPromptMode("slide"); switchPromptMode("global"); switchPromptMode("custom");', ctx);
  assert.match(vm.runInContext('generatedPromptCustom', ctx), /版型 A/);
  assert.match(vm.runInContext('generatedPromptCustom', ctx), /#5649EC/);
});

test('saved slides retain source page labels and discard unrelated uploaded files', () => {
  const ctx = context();
  vm.runInContext(`
    renderThumbnails = () => {};
    selectedFiles = [{ name: 'previous.pdf' }];
    savedStylesCache = [{ id: 'saved', title: 'saved', tags: [], palette: [],
      slides: [{ page: 3, image: '' }, { page: 31, image: '' }] }];
    loadSavedStyleIntoWorkspace('saved');
  `, ctx);
  assert.equal(vm.runInContext('selectedFiles.length', ctx), 0);
  assert.deepEqual(Array.from(vm.runInContext('getActiveComparisonSlides().map(p => p.originalPage)', ctx)), [3, 31]);
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
    extractImageEvidence = async () => ({ colors: [], lightRatio: null, darkRatio: null }); callOpenAiDirectly = capturePages;
  `, ctx);
  assert.equal(ctx.document.getElementById('custom-pages-controls').classList.contains('hidden'), true);
  await vm.runInContext('handleStartAnalyze()', ctx);
  assert.equal(ctx.document.getElementById('custom-pages-controls').classList.contains('hidden'), false);
  assert.match(ctx.document.getElementById('btn-mode-custom-pages').className, /active/);
  assert.doesNotMatch(ctx.document.getElementById('btn-mode-all-pages').className, /active/);
  assert.equal(received.length, 30);
  assert.equal(received.at(-1).page, 40);
});

test('backend rejections are shown once without duplicate browser provider requests', async () => {
  for (const status of [400, 401, 429, 503]) {
    const ctx = context();
    const messages = [];
    let directCalls = 0;
    ctx.window.location = { hostname: 'localhost', protocol: 'http:' };
    ctx.setTimeout = callback => callback();
    ctx.console.error = () => {};
    ctx.FormData = class { append() {} };
    ctx.fetch = async () => ({ ok: false, status, json: async () => ({ detail: 'provider currently busy' }) });
    ctx.captureToast = message => messages.push(message);
    ctx.directCall = async () => { directCalls++; return {}; };
    vm.runInContext(`
      uploadedSlidePages = [{ page: 1, image: 'data:image/png;base64,AA==' }];
      selectedFiles = [{ name: 'uploaded.png' }];
      currentProvider = 'openai'; getApiKey = () => 'test-placeholder';
      _systemInstruction = 'test'; startProgressPipeline = () => {};
      completeProgressPipeline = () => {}; stopProgressPipeline = () => {};
      renderAnalysisResult = () => {}; showToast = captureToast;
      extractImageEvidence = async () => ({ colors: [], lightRatio: null, darkRatio: null }); callOpenAiDirectly = directCall;
    `, ctx);
    await vm.runInContext('handleStartAnalyze()', ctx);
    assert.equal(directCalls, 0, `HTTP ${status} must not call provider again`);
    assert.ok(messages.includes('provider currently busy'));
  }
});

test('valid model hex values normalize with a hash while CSS injection stays rejected', () => {
  const ctx = context();
  ctx.palette = [{ hex: '4c5bf8', role: 'accent' }, { hex: '#ffffff' }, { hex: 'fff' }, { hex: '123456; color:red' }];
  const result = vm.runInContext('safeSavedPalette(palette)', ctx);
  assert.equal(result.length, 2);
  assert.equal(result[0].hex, '#4C5BF8');
  assert.equal(result[1].hex, '#FFFFFF');
});

test('legacy static entry ships the same public assets and rules as the root entry', () => {
  for (const name of ['app.js', 'index.html', 'style.css', 'style-quality.js', 'guardrails.json', 'favicon.svg', 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png']) {
    assert.deepEqual(fs.readFileSync(path.join(root, 'static', name)), fs.readFileSync(path.join(root, name)), name);
  }
});

test('browser pixel evidence measures bright and dark images before prompt generation', async () => {
  for (const [channel, expectedLight, expectedDark] of [[255, 1, 0], [0, 0, 1]]) {
    const ctx = context();
    ctx.Image = class { set src(_value) { this.onload(); } };
    ctx.document.createElement = () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([channel, channel, channel, 255]) }) }) });
    const evidence = await vm.runInContext('extractImageEvidence("data:image/png;base64,test", 5)', ctx);
    assert.equal(evidence.lightRatio, expectedLight);
    assert.equal(evidence.darkRatio, expectedDark);
    assert.equal(evidence.colors.length, 1);
  }
});

test('missing local API and network failures retain browser-only analysis', async () => {
  for (const status of [null, 404, 405, 501]) {
    const ctx = context();
    let directCalls = 0;
    ctx.window.location = { hostname: 'localhost', protocol: 'http:' };
    ctx.setTimeout = callback => callback();
    ctx.console.error = error => { throw error; };
    ctx.FormData = class { append() {} };
    ctx.fetch = async () => { if (status === null) throw new TypeError('Failed to fetch'); return { ok: false, status }; };
    ctx.directCall = async () => { directCalls++; return {}; };
    vm.runInContext(`
      uploadedSlidePages = [{ page: 1, image: 'data:image/png;base64,AA==' }];
      selectedFiles = [{ name: 'uploaded.png' }];
      currentProvider = 'openai'; getApiKey = () => 'test-placeholder';
      _systemInstruction = 'test'; startProgressPipeline = () => {};
      completeProgressPipeline = () => {}; stopProgressPipeline = () => {};
      renderAnalysisResult = () => {}; extractImageEvidence = async () => ({ colors: [], lightRatio: null, darkRatio: null });
      callOpenAiDirectly = directCall;
    `, ctx);
    await vm.runInContext('handleStartAnalyze()', ctx);
    assert.equal(directCalls, 1, `unavailable local API ${status} should fall back`);
  }
});

test('saved images without original files use direct analysis instead of an empty backend request', async () => {
  const ctx = context();
  let backendCalls = 0;
  let directCalls = 0;
  ctx.window.location = { hostname: 'localhost', protocol: 'http:' };
  ctx.setTimeout = callback => callback();
  ctx.console.error = error => { throw error; };
  ctx.fetch = async () => { backendCalls++; return { ok: false, status: 400, json: async () => ({ detail: 'no files' }) }; };
  ctx.FormData = class { append() {} };
  ctx.directCall = async () => { directCalls++; return {}; };
  vm.runInContext(`
    uploadedSlidePages = [{ page: 31, image: 'data:image/png;base64,AA==' }];
    selectedFiles = [];
    currentProvider = 'openai'; getApiKey = () => 'test-placeholder';
    _systemInstruction = 'test'; startProgressPipeline = () => {};
    completeProgressPipeline = () => {}; stopProgressPipeline = () => {};
    renderAnalysisResult = () => {}; extractImageEvidence = async () => ({ colors: [], lightRatio: null, darkRatio: null });
    callOpenAiDirectly = directCall;
  `, ctx);
  await vm.runInContext('handleStartAnalyze()', ctx);
  assert.equal(backendCalls, 0);
  assert.equal(directCalls, 1);
});

test('malformed imported arrays stay blocked without crashing the correction panel',()=>{
  const ctx=context();
  vm.runInContext(`currentRawProfile={layouts:[{id:'A',name:'bad',source_pages:{}}],pages:{}};currentAnalysisContext={source_pages:{}};refreshQuality();renderQualityPanel();`,ctx);
  assert.equal(vm.runInContext('currentQuality.ready',ctx),false);
  assert.equal(ctx.document.getElementById('btn-copy-nblm').disabled,true);
});
test('an asynchronous save preserves its own profile and cannot steal the newly opened record',async()=>{
  const ctx=context();
  // Restore the production save function overridden by the general DOM harness.
  vm.runInContext(source.slice(source.indexOf('async function handlePostAnalysisSave('),source.indexOf('function updateSaveToolbarButtonState(')),ctx);
  let release;
  ctx.compression=new Promise(resolve=>release=resolve);
  ctx.saved=[];
  vm.runInContext(`
    getActiveComparisonSlides=()=>[{originalPage:17,image:'image'}];
    compressSlideImageForSave=()=>compression;
    saveStyleRecordToStorage=async record=>saved.push(record);
    currentRawProfile={name:'first'};currentAnalysisContext={source_pages:['P.17']};
    generatedPromptGlobal='first prompt';
    pending=handlePostAnalysisSave({}, {style_name:'first'}, []);
    analysisRevision++;currentActiveStyleId='second';currentRawProfile={name:'second'};generatedPromptGlobal='second prompt';
  `,ctx);
  release('compressed');await ctx.pending;
  assert.equal(ctx.saved[0].designProfile.name,'first');
  assert.equal(ctx.saved[0].globalPrompt,'first prompt');
  assert.equal(vm.runInContext('currentActiveStyleId',ctx),'second');
});
test('a pending correction is discarded if the user opens another record while save is pending',async()=>{
  const ctx=context();
  vm.runInContext('renderAnalysisResult({markdown_report:report,analysis_context:{source_pages:["P.17"]}})',ctx);
  let release;ctx.pending=new Promise(resolve=>release=resolve);
  vm.runInContext('currentPendingSave=pending',ctx);
  const panel=ctx.document.getElementById('quality-panel');
  const apply=panel.children.at(-1).children.at(-1);
  const completion=apply.listeners.click();
  vm.runInContext('analysisRevision++;currentRawProfile={name:"second"}',ctx);
  release();await completion;
  assert.equal(vm.runInContext('currentRawProfile.name',ctx),'second');
});

test('a complete JSON block missing only its closing fence is recovered, but truncated JSON is not',()=>{
  const ctx=context();ctx.complete='```json\n'+JSON.stringify({style_name:'EOF',palette:[],design_profile:profile});
  assert.equal(vm.runInContext('fallbackExtractMeta(complete).design_profile.pages.length',ctx),1);
  ctx.truncated=ctx.complete.slice(0,-3);
  assert.equal(vm.runInContext('fallbackExtractMeta(truncated).design_profile',ctx),undefined);
});

test('metadata can appear before or after the readable report without leaking JSON into it',()=>{
  const ctx=context();ctx.meta='```json\n'+JSON.stringify({design_profile:profile})+'\n```';
  assert.equal(ctx.stripTrailingMetaJson(ctx.meta+'\nReport'),'Report');
  assert.equal(ctx.stripTrailingMetaJson('Report\n'+ctx.meta),'Report');
});

test('five-page demo satisfies the same source gate and enables copying',()=>{
  const ctx=context();
  vm.runInContext('renderAnalysisResult(DEMO_ANALYSIS_DATA)',ctx);
  assert.equal(vm.runInContext('currentQuality.ready',ctx),true);
  assert.equal(vm.runInContext('currentRawProfile.pages.length',ctx),5);
  assert.equal(ctx.document.getElementById('btn-copy-nblm').disabled,false);
});
test('saved quick-copy rejects invalid and legacy records and recompiles valid records',async()=>{
  const ctx=context();const writes=[];ctx.navigator={clipboard:{writeText:async s=>writes.push(s)}};
  ctx.valid={designProfile:profile,analysisContext:{source_pages:['P.17']},globalPrompt:'forged prompt',palette:[]};
  for(const expression of ['copySavedStylePrompt({globalPrompt:"old unverified"})','copySavedStylePrompt({...valid,analysisContext:{source_pages:["P.99"]}})']) await vm.runInContext(expression,ctx);
  assert.equal(writes.length,0);
  await vm.runInContext('copySavedStylePrompt(valid)',ctx);
  assert.equal(writes.length,1);assert.match(writes[0],/三欄原稿卡片/);assert.doesNotMatch(writes[0],/forged/);
});
test('saving all analyzed thumbnails preserves a fifteenth non-contiguous source page',async()=>{
  const ctx=context();
  vm.runInContext(source.slice(source.indexOf('async function handlePostAnalysisSave('),source.indexOf('function updateSaveToolbarButtonState(')),ctx);
  ctx.saved=[];
  vm.runInContext(`getActiveComparisonSlides=()=>Array.from({length:15},(_,i)=>({originalPage:(i+1)*2,image:'img'}));
    compressSlideImageForSave=async img=>img;saveStyleRecordToStorage=async r=>saved.push(r);
    updateSaveToolbarButtonState=()=>{};renderSavedStylesList=()=>{};renderThumbnails=()=>{};`,ctx);
  await vm.runInContext('handlePostAnalysisSave({}, {}, [])',ctx);
  assert.equal(ctx.saved[0].slides.length,15);assert.equal(ctx.saved[0].slides.at(-1).page,30);
  ctx.item=ctx.saved[0];vm.runInContext('savedStylesCache=[item];loadSavedStyleIntoWorkspace(item.id)',ctx);
  assert.equal(vm.runInContext('uploadedSlidePages.length',ctx),15);
  assert.equal(vm.runInContext('uploadedSlidePages.at(-1).page',ctx),30);
});
test('legacy image pages restore editable source scope and no-image records clear stale slides',()=>{
  const ctx=context();vm.runInContext('renderThumbnails=()=>{};savedStylesCache=[{id:"legacy",slides:[{page:17,image:""}]},{id:"empty"}];loadSavedStyleIntoWorkspace("legacy")',ctx);
  assert.deepEqual(Array.from(vm.runInContext('currentAnalysisContext.source_pages',ctx)),['P.17']);
  const details=ctx.document.getElementById('quality-panel').children.at(-1);
  assert.ok(details.children.some(e=>e.textContent==='版型 A 名稱'));
  vm.runInContext('loadSavedStyleIntoWorkspace("empty")',ctx);
  assert.equal(vm.runInContext('uploadedSlidePages.length',ctx),0);
});
test('leading complete JSON without a closing fence is read without consuming the following report',()=>{
  const ctx=context();const data={style_name:'lead',palette:[],design_profile:profile};
  ctx.leading='```json\n'+JSON.stringify(data)+'\n## 1. Evidence\n```markdown\nPrompt\n```';
  assert.equal(ctx.fallbackExtractMeta(ctx.leading).style_name,'lead');
  assert.match(ctx.stripTrailingMetaJson(ctx.leading),/^## 1. Evidence/);
  assert.match(ctx.stripTrailingMetaJson(ctx.leading),/```markdown/);
});

test('a user can repair a missing layout using the blank editor without an API request',async()=>{
  const ctx=context();vm.runInContext('currentRawProfile={};currentAnalysisContext={source_pages:["P.4"]};refreshQuality();renderQualityPanel()',ctx);
  const details=ctx.document.getElementById('quality-panel').children.at(-1);
  const set=(parent,label,value)=>{parent.children.find(e=>e.textContent===label).children[0].value=value;};
  set(details,'版型 A 名稱','手動原稿版型');set(details,'版型 A 配置','左文右圖');
  const row=details.children.find(e=>e.className==='quality-page-row');
  set(row,'版型','A');set(row,'主要背景','light');set(row,'背景範圍（含照片／頁腳）','白底主畫布');
  set(row,'背景估計色 #RRGGBB','#FFFFFF');set(row,'主文字估計色 #RRGGBB','#111111');set(row,'圖像材質','照片');
  await details.children.at(-1).listeners.click();
  assert.equal(vm.runInContext('currentQuality.ready',ctx),true);
  assert.match(vm.runInContext('generatedPromptGlobal',ctx),/手動原稿版型/);
});

test('saved quick-copy does not silently switch custom stories to the global prompt',async()=>{
  const ctx=context();const writes=[],notices=[];ctx.navigator={clipboard:{writeText:async s=>writes.push(s)}};ctx.notices=notices;
  ctx.item={designProfile:profile,analysisContext:{source_pages:['P.17']},palette:[]};
  vm.runInContext('currentPromptMode="custom";showToast=message=>notices.push(message)',ctx);
  await vm.runInContext('copySavedStylePrompt(item)',ctx);
  assert.equal(writes.length,0);assert.match(notices[0],/自訂故事板/);
});
test('adding a second layout preserves draft fields and assigns separate source pages without API calls',async()=>{
  const ctx=context();vm.runInContext('currentRawProfile={};currentAnalysisContext={source_pages:["P.1","P.9"]};refreshQuality();renderQualityPanel()',ctx);
  const details=ctx.document.getElementById('quality-panel').children.at(-1);
  const set=(parent,label,value)=>{parent.children.find(e=>e.textContent===label).children[0].value=value;};
  set(details,'版型 A 名稱','封面草稿');set(details,'版型 A 配置','左標題右圖');
  details.children.find(e=>e.textContent==='＋新增版型').listeners.click();
  const extra=details.children.find(e=>e.children.some(c=>c.textContent==='版型 B 名稱'));
  set(extra,'版型 B 名稱','四欄內頁');set(extra,'版型 B 配置','四欄圖示與條列');
  const rows=details.children.filter(e=>e.className==='quality-page-row');
  rows.forEach((row,i)=>{set(row,'版型',i?'B':'A');set(row,'主要背景','light');set(row,'背景範圍（含照片／頁腳）','白底');set(row,'背景估計色 #RRGGBB','#FFFFFF');set(row,'主文字估計色 #RRGGBB','#111111');set(row,'圖像材質','照片');});
  await details.children.at(-1).listeners.click();
  assert.equal(vm.runInContext('currentQuality.ready',ctx),true);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(currentRawProfile.layouts.map(l=>[l.id,l.name,l.source_pages]))',ctx)),[['A','封面草稿',['P.1']],['B','四欄內頁',['P.9']]]);
});


test('Gemini auto analysis and connection test reach the validated model before unavailable legacy models', async () => {
  const ctx = context();
  const calls = [];
  ctx.performance = { now: () => 0 };
  ctx.fetch = async (url) => {
    const model = url.match(/models\/([^:]+):/)[1];
    calls.push(model);
    return model === 'gemini-3.5-flash-lite'
      ? { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: report }] } }] }) }
      : { ok: false, status: 404, json: async () => ({ error: { message: 'model not found' } }) };
  };
  vm.runInContext('getEffectiveSystemInstruction = () => "test";', ctx);
  const result = await vm.runInContext('callGeminiDirectly("test-placeholder", "auto", [], "analyze")', ctx);
  assert.equal(result.model_used, 'gemini-3.5-flash-lite');
  const connection = await vm.runInContext('testApiKeyConnection("gemini", "test-placeholder")', ctx);
  assert.equal(connection.ok, true);
  assert.equal(connection.model, result.model_used);
  assert.deepEqual(calls, ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite']);
});
