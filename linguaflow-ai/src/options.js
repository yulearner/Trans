const defaults = { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', sourceLang: '自动检测', targetLang: '简体中文', style: '自然、准确、适合技术阅读', temperature: 0.2 };
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
async function load() {
  const settings = { ...defaults, ...(await chrome.storage.local.get(defaults)) };
  for (const key of Object.keys(defaults)) if ($(key)) $(key).value = settings[key] ?? defaults[key];
  setStatus(settings.apiKey ? '已加载本地设置。' : '请填写 API Key、模型名称，并授权 API 域名。');
}
$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const base = normalizedBase();
    const values = { baseUrl: base.value, apiKey: $('apiKey').value.trim(), model: $('model').value.trim(), sourceLang: $('sourceLang').value, targetLang: $('targetLang').value, style: $('style').value.trim() || defaults.style, temperature: 0.2 };
    if (!values.model) throw new Error('模型名称不能为空。');
    await chrome.storage.local.set(values);
    setStatus('设置已保存。接下来请点击“授权 API 域名”，然后测试 API。');
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
$('testApi').addEventListener('click', async () => {
  try {
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
    setStatus('正在测试 API…');
    const response = await chrome.runtime.sendMessage({ type: 'LF_TRANSLATE', texts: ['Translate this sentence into Simplified Chinese: Hello, world.'] });
    if (!response?.ok) throw new Error(response?.error || 'API 测试失败。');
    setStatus(`API 测试成功：${response.translations[0]}`);
  } catch (e) { setStatus(e.message || 'API 测试失败。', true); }
});
load().catch(e => setStatus(e.message, true));
