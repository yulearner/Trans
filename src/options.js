const defaults = { engine: 'google', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', sourceLang: '自动检测', targetLang: '简体中文', style: '自然、准确、适合技术阅读', temperature: 0.2 };
const $ = id => document.getElementById(id);
function setStatus(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function normalizedBase() {
  const value = $('baseUrl').value.trim().replace(/\/+$/, '');
  if (!value) throw new Error('请先填写 API Base URL。');
  let url;
  try { url = new URL(value); } catch { throw new Error('API Base URL 不是有效的网址。'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS。');
  if (url.username || url.password) throw new Error('API 地址中不能包含用户名或密码。');
  return { value, origin: url.origin };
}
// 引擎切换 UI：Google 模式下弱化（禁用）AI 专用配置，但不删除任何已保存的值；
// 切回 AI 模式后字段恢复可编辑，且仍显示之前保存的内容。
function updateEngineUI() {
  const google = $('engine').value === 'google';
  $('aiSettings').classList.toggle('dimmed', google);
  $('aiSettings').querySelectorAll('input').forEach(input => { input.disabled = google; });
  $('googleNotice').hidden = !google;
  $('engineHint').textContent = google
    ? '无需 API Key 即可使用；AI 配置区域已停用，已保存的配置不会被删除。'
    : '使用你配置的 [OI] 兼容 Chat Completions API（POST {Base URL}/chat/completions）。';
  $('grantPermission').hidden = google;
  $('grantGoogle').hidden = !google;
}
// 读取 background 解析后的当前引擎（与实际翻译使用的引擎保持一致，
// 包括“老用户默认 AI、新用户默认 Google”的兼容规则）。
async function resolvedEngine() {
  const result = await chrome.runtime.sendMessage({ type: 'LF_GET_SETTINGS_STATUS' });
  return result?.engine;
}
async function load() {
  const settings = { ...defaults, ...(await chrome.storage.local.get(defaults)) };
  const engine = await resolvedEngine();
  if (engine) settings.engine = engine;
  for (const key of Object.keys(defaults)) if ($(key)) $(key).value = settings[key] ?? defaults[key];
  updateEngineUI();
  setStatus(settings.engine === 'google'
    ? (settings.apiKey ? '已加载本地设置：当前使用 Google 免费翻译（已保存的 AI 配置保留）。' : '当前使用 Google 免费翻译，无需配置即可使用。')
    : (settings.apiKey ? '已加载本地设置：当前使用 AI 大模型翻译。' : '请填写 API Key、模型名称，并授权 API 域名。'));
}
$('engine').addEventListener('change', updateEngineUI);
$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const engine = $('engine').value;
    // 源语言 / 目标语言为两种引擎共用，始终保存。
    const shared = { engine, sourceLang: $('sourceLang').value, targetLang: $('targetLang').value };
    if (engine === 'ai') {
      const base = normalizedBase();
      const values = { ...shared, baseUrl: base.value, apiKey: $('apiKey').value.trim(), model: $('model').value.trim(), style: $('style').value.trim() || defaults.style, temperature: 0.2 };
      if (!values.model) throw new Error('模型名称不能为空。');
      await chrome.storage.local.set(values);
      setStatus('设置已保存。接下来请点击“授权 API 域名”，然后测试翻译。');
    } else {
      // Google 模式不写入 AI 字段：已保存的 AI 配置原样保留，随时可切回。
      await chrome.storage.local.set(shared);
      setStatus('已保存：当前使用 Google 免费翻译。可直接使用；如翻译失败，可尝试“授权 Google 翻译域名”。');
    }
  } catch (e) { setStatus(e.message || '保存失败。', true); }
});
$('grantPermission').addEventListener('click', async () => {
  try {
    const base = normalizedBase();
    // Request both http and https origins for the same host: MV3 host
    // permissions are per-origin (scheme included), and API gateways commonly
    // redirect http -> https. Granting only one scheme makes the redirected
    // request fail with an opaque "Failed to fetch".
    const host = url_hostname(base.origin);
    const patterns = [`http://${host}/*`, `https://${host}/*`];
    const granted = await chrome.permissions.request({ origins: patterns });
    setStatus(granted ? `已授权访问 http/https://${host}` : '你拒绝了域名授权。未授权时扩展无法请求该 API。', !granted);
  } catch (e) { setStatus(e.message || '域名授权失败。', true); }
});
function url_hostname(origin) {
  try { return new URL(origin).host; } catch { return origin.replace(/^https?:\/\//, '').replace(/\/.*$/, ''); }
}
$('grantGoogle').addEventListener('click', async () => {
  try {
    const granted = await chrome.permissions.request({ origins: ['https://translate.googleapis.com/*'] });
    setStatus(granted
      ? '已授权访问 https://translate.googleapis.com。'
      : '你拒绝了授权。扩展仍会尝试直接请求 Google 翻译；如持续失败请重新授权。', !granted);
  } catch (e) { setStatus(e.message || '域名授权失败。', true); }
});
$('testApi').addEventListener('click', async () => {
  try {
    const formEngine = $('engine').value;
    const savedEngine = await resolvedEngine();
    if (savedEngine !== formEngine) throw new Error('表单中的引擎与已保存设置不一致，请先点击“保存设置”。');
    if (formEngine === 'ai') {
      const base = normalizedBase();
      const settings = { ...defaults, ...(await chrome.storage.local.get(defaults)) };
      if (!settings.apiKey) throw new Error('请先保存 API Key。');
      if (!settings.model) throw new Error('请先保存模型名称。');
      // The request is made by the background worker using the *saved* baseUrl, so
      // permission must be checked against the saved origin; a mismatch with the
      // form value would otherwise produce misleading test results.
      const savedBase = String(settings.baseUrl || '').trim().replace(/\/+$/, '');
      if (savedBase !== base.value) throw new Error('表单中的 Base URL 与已保存设置不一致，请先点击“保存设置”。');
      const host = url_hostname(base.origin);
      const granted = await chrome.permissions.contains({ origins: [`https://${host}/*`] }) ||
        await chrome.permissions.contains({ origins: [`http://${host}/*`] });
      if (!granted) throw new Error('请先点击“授权 API 域名”。');
    }
    setStatus(formEngine === 'google' ? '正在测试 Google 翻译…' : '正在测试 API…');
    const response = await chrome.runtime.sendMessage({ type: 'LF_TRANSLATE', texts: ['Translate this sentence into Simplified Chinese: Hello, world.'] });
    if (!response?.ok) throw new Error(response?.error || '翻译测试失败。');
    setStatus(`翻译测试成功：${response.translations[0]}`);
  } catch (e) { setStatus(e.message || '翻译测试失败。', true); }
});
load().catch(e => setStatus(e.message, true));
