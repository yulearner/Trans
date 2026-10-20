const statusEl = document.getElementById('status');
function status(text, error = false) { statusEl.textContent = text; statusEl.classList.toggle('error', error); }
let currentEngine = null;
function refreshEngineUI() {
  const google = currentEngine === 'google';
  document.getElementById('engineName').textContent = google ? '当前引擎：Google 免费翻译' : '当前引擎：AI 大模型翻译';
  document.getElementById('switchEngine').textContent = google ? '切换为 AI 大模型' : '切换为 Google 免费';
}
async function loadEngine() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'LF_GET_SETTINGS_STATUS' });
    if (!result) return;
    currentEngine = result.engine;
    refreshEngineUI();
    if (result.configured) status('就绪。点击“翻译当前网页”开始。');
    else status('当前引擎为 AI 大模型翻译，请先打开“翻译设置”填写 API Key 和模型。');
  } catch { /* background 暂不可用时保留默认提示 */ }
}
// 快速切换引擎：只写入用户选择，切换失败时明确报错，绝不静默回退到另一个引擎。
// 已插入页面的译文不会因切换被删除或重复插入；再次翻译新内容时使用新引擎。
document.getElementById('switchEngine').addEventListener('click', async () => {
  if (!currentEngine) return;
  const next = currentEngine === 'google' ? 'ai' : 'google';
  try {
    await chrome.storage.local.set({ engine: next });
    currentEngine = next;
    refreshEngineUI();
    status(next === 'google'
      ? '已切换到 Google 免费翻译（无需 API Key）。'
      : '已切换到 AI 大模型翻译。如尚未配置 API，请打开“翻译设置”。');
  } catch (e) { status(`切换引擎失败：${e.message || '未知错误'}`, true); }
});
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('此页面无法注入扩展。请在普通 HTTP/HTTPS 网页中使用。');
  return tab;
}
async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/content.css'] });
}
document.getElementById('translatePage').addEventListener('click', async () => {
  status('正在读取网页…');
  try {
    const tab = await activeTab();
    await inject(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'LF_TRANSLATE_PAGE' });
    status(result?.ok ? `已完成：翻译 ${result.count} 个段落。` : (result?.error || '翻译失败。'), !result?.ok);
  } catch (e) { status(e.message || '操作失败。', true); }
});
document.getElementById('togglePage').addEventListener('click', async () => {
  try {
    const tab = await activeTab(); await inject(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'LF_TOGGLE_TRANSLATIONS' });
    status(result?.visible ? '译文已显示。' : '译文已隐藏。');
  } catch (e) { status(e.message || '操作失败。', true); }
});
document.getElementById('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
loadEngine();
