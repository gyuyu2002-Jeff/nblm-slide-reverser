const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    clear: () => { throw new Error("Unrelated browser data must not be cleared"); }
  };
}

for (const directory of [".", "static"]) {
  const source = readFileSync(`${directory}/app.js`, "utf8");
  const html = readFileSync(`${directory}/index.html`, "utf8");
  const start = source.indexOf("function getApiKey(");
  const end = source.indexOf("function initApiKeyStatus(", start);
  assert.ok(start >= 0 && end > start, "API key functions must be present");

  function app(local = storage(), session = storage(), fields = {}) {
    const context = vm.createContext({
      localStorage: local,
      sessionStorage: session,
      currentProvider: "gemini",
      modalSelectedProvider: "openai",
      modalApiKey: null,
      PROVIDER_CONFIG: { gemini: {}, openai: { name: "OpenAI" }, anthropic: {} },
      document: { getElementById: id => fields[id] ?? null },
      initProvider() {}, initApiKeyStatus() {}, setupEventListeners() {},
      updateUiState() {}, checkFirstTimeVisitor() {}, loadDynamicGuardrails() {},
      switchProvider() {}, closeOnboardingModal() {}, showToast() {}
    });
    const run = code => vm.runInContext(code, context, { timeout: 100 });
    run(source.slice(start, end));
    return { run, local, session };
  }

  function click(app, id) {
    const prefix = `  on("${id}", "click", () => {`;
    const start = source.indexOf(prefix);
    const end = source.indexOf("\n  });", start);
    assert.ok(start >= 0 && end > start, `${id} must have a click handler`);
    app.run(`(() => {${source.slice(start + prefix.length, end)}\n})()`);
  }

  test(`${directory}: startup removes only legacy API keys and preserves session data`, () => {
    const old = Object.fromEntries(["gemini", "openai", "anthropic"].map(p => [`${p}_api_key`, "dummy-old-key"]));
    const appState = app(storage({ ...old, active_provider: "openai", crm_notes: "keep-notes", saved_styles: "keep-styles" }), storage({ gemini_api_key: "dummy-session-key" }));
    const ready = source.match(/document.addEventListener\("DOMContentLoaded", \(\) => \{([\s\S]*?)\n\}\);/);
    assert.ok(ready, "Startup handler must be present");
    appState.run(ready[1]);
    for (const provider of ["gemini", "openai", "anthropic"]) {
      assert.equal(appState.local.getItem(`${provider}_api_key`), null);
    }
    assert.equal(appState.local.getItem("active_provider"), "openai");
    assert.equal(appState.local.getItem("crm_notes"), "keep-notes");
    assert.equal(appState.local.getItem("saved_styles"), "keep-styles");
    assert.equal(appState.run("getApiKey()"), "dummy-session-key");
  });

  test(`${directory}: legacy permanent keys are never read as active keys`, () => {
    const appState = app(storage({ gemini_api_key: "dummy-old-key" }));
    assert.equal(appState.run("getApiKey()"), "");
  });

  test(`${directory}: onboarding and settings both save only to the current session`, () => {
    const appState = app(storage(), storage(), {
      "input-onboarding-key": { value: "  dummy-onboarding-key  ", dataset: {} },
      "input-api-key": { value: "  dummy-settings-key  ", dataset: {} }
    });
    click(appState, "btn-save-onboarding-key");
    click(appState, "btn-save-key");
    assert.equal(appState.session.getItem("gemini_api_key"), "dummy-onboarding-key");
    assert.equal(appState.session.getItem("openai_api_key"), "dummy-settings-key");
    assert.equal(appState.local.getItem("gemini_api_key"), null);
    assert.equal(appState.local.getItem("openai_api_key"), null);
  });

  test(`${directory}: reload keeps a key while a separate empty session has none`, () => {
    const local = storage();
    const session = storage();
    app(local, session).run('setApiKey("anthropic", "dummy-session-key")');
    assert.equal(app(local, session).run('getApiKey("anthropic")'), "dummy-session-key");
    assert.equal(app(local, storage()).run('getApiKey("anthropic")'), "");
  });

  test(`${directory}: clearing a provider leaves other keys and browser data intact`, () => {
    const appState = app(storage({ crm_notes: "keep-notes" }), storage({ openai_api_key: "dummy-remove", gemini_api_key: "dummy-keep" }), {
      "input-api-key": { value: "masked-key", dataset: { masked: "true" } }
    });
    click(appState, "btn-clear-key");
    assert.equal(appState.run('getApiKey("openai")'), "");
    assert.equal(appState.run('getApiKey("gemini")'), "dummy-keep");
    assert.equal(appState.local.getItem("crm_notes"), "keep-notes");
  });

  test(`${directory}: settings offer session storage with accurate reload and restore text`, () => {
    assert.doesNotMatch(html, /id="check-session-only"/);
    assert.doesNotMatch(source, /check-session-only/);
    assert.match(html, /重新整理不用重填/);
    assert.match(html, /還原分頁時可能/);
    assert.match(html, /id="btn-clear-key"/);
  });
}
