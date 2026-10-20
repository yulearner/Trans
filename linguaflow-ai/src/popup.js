const statusEl = document.getElementById('status');
function status(text, error = false) { statusEl.textContent = text; statusEl.classList.toggle('error', error); }
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
chrome.runtime.sendMessage({ type: 'LF_GET_SETTINGS_STATUS' }, result => {
  if (chrome.runtime.lastError) return;
  if (result && !result.configured) status('请先打开“翻译设置”填写 API Key 和模型。');
});
