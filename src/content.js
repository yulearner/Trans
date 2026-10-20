(() => {
  if (window.__linguaFlowInitialized) return;
  window.__linguaFlowInitialized = true;
  const translated = new Map();
  let translationsVisible = true;
  let tooltip;
  let hoverButton;
  let hoveredParagraph;
  let selectionTimer;
  let selectionSeq = 0;
  let pageTranslationPromise = null;
  const lfUiSelector = '[data-lf-ui="hover-button"], [data-lf-ui="tooltip"], [data-lf-ui="pin-badge"]';

  const excluded = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','BUTTON','SELECT','OPTION','CODE','PRE','SVG','CANVAS','IFRAME']);
  // Read paragraph text while ignoring our own injected UI nodes: translations of
  // list items and table cells are appended inside the element, and must never be
  // sent back to the API as part of the source text.
  function paragraphText(el) {
    if (!el.querySelector('[data-lf-ui]')) return (el.innerText || '').trim();
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[data-lf-ui]').forEach(node => node.remove());
    return (clone.textContent || '').trim();
  }
  function eligible(el) {
    if (!(el instanceof HTMLElement) || excluded.has(el.tagName)) return false;
    if (el.closest('[data-lf-ui], [contenteditable="true"], nav, header, footer, aside')) return false;
    const text = paragraphText(el);
    if (text.length < 35 || text.length > 4500) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 10) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  function collectParagraphs() {
    const candidates = [...document.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, td, th')].filter(eligible);
    // Avoid translating nested duplicates by dropping nodes whose text substantially duplicates a parent candidate.
    const unique = [];
    const seen = new Set();
    for (const el of candidates) {
      const text = paragraphText(el);
      if (seen.has(text)) continue;
      seen.add(text);
      unique.push({ el, text });
    }
    return unique;
  }
  function ensureTranslationNode(el) {
    // For table cells and list items, inserting after the element would place a
    // <div> directly inside <tr>/<ul>, which is invalid HTML and can break page
    // layout, so the translation is appended inside the element instead. The node
    // is tracked on el.__lfNode so page re-renders cannot leave duplicate or
    // orphaned translation nodes behind.
    const inline = el.tagName === 'TD' || el.tagName === 'TH' || el.tagName === 'LI';
    let node = el.__lfNode;
    if (node) {
      const placed = inline ? node.parentElement === el
        : (node.parentElement === el.parentElement && node.previousElementSibling === el);
      if (!node.isConnected || !node.classList.contains('lf-translation') || !placed) {
        node.remove();
        node = null;
      }
    }
    if (!node) {
      node = document.createElement('div');
      node.className = 'lf-translation';
      node.setAttribute('data-lf-ui', 'translation');
      node.setAttribute('aria-label', 'AI 翻译');
      if (inline) el.appendChild(node);
      else el.insertAdjacentElement('afterend', node);
      el.__lfNode = node;
    }
    node.hidden = !translationsVisible;
    return node;
  }
  function showTranslation(el, text, translation) {
    const node = ensureTranslationNode(el);
    node.textContent = translation;
    node.hidden = !translationsVisible;
    // Store the clean text (excluding our UI) so dedup comparisons stay consistent.
    translated.set(el, { text: paragraphText(el), translation });
  }
  function sendTranslation(texts) {
    // 扩展在 chrome://extensions 被重新加载/更新后，旧页面上残留的 content script
    // 会持有失效的 chrome.runtime（context invalidated）。此时刷新页面即可恢复；
    // 这里检测后返回友好错误，而不是抛出未捕获的异常。
    if (!chrome.runtime?.id) return Promise.resolve({ ok: false, error: '扩展已更新或重新加载，请刷新本页面后重试。' });
    return new Promise(resolve => chrome.runtime.sendMessage({ type: 'LF_TRANSLATE', texts }, response => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(response || { ok: false, error: '没有收到翻译服务响应。' });
    })).catch(() => Promise.resolve({ ok: false, error: '扩展已更新或重新加载，请刷新本页面后重试。' }));
  }
  async function translatePage() {
    // Serialize page translations so repeated clicks cannot trigger duplicate API requests.
    if (pageTranslationPromise) return pageTranslationPromise;
    const run = async () => {
      const items = collectParagraphs().filter(item => !translated.has(item.el) || translated.get(item.el).text !== item.text);
      if (!items.length) {
        if (translated.size) return { ok: true, count: translated.size, cached: true };
        return { ok: false, error: '没有找到适合翻译的正文段落。' };
      }
      const batches = [];
      // Keep batches small to limit token usage and avoid provider context limits.
      for (let i = 0; i < items.length; i += 8) batches.push(items.slice(i, i + 8));
      let done = 0;
      for (const batch of batches) {
        const response = await sendTranslation(batch.map(x => x.text));
        if (!response.ok) return { ok: false, error: response.error };
        response.translations.forEach((translation, i) => showTranslation(batch[i].el, batch[i].text, translation));
        done += batch.length;
      }
      return { ok: true, count: done };
    };
    pageTranslationPromise = run();
    try {
      return await pageTranslationPromise;
    } finally {
      pageTranslationPromise = null;
    }
  }
  function toggleTranslations() {
    translationsVisible = !translationsVisible;
    document.querySelectorAll('.lf-translation').forEach(node => node.hidden = !translationsVisible);
    return translationsVisible;
  }
  const selectionCache = new Map(); // 选区译文缓存：相同文本直接显示之前的翻译，不再重复请求（仅本次页面会话内存，不持久化）
  const pinnedTips = new Set(); // 当前处于“固定”状态的浮层；外部点击 / Escape 时统一收起为“文A”小方框
  // 固定浮层被自动隐藏后，在原选区旁显示一个“文A”小方框；点击它重新展开之前的译文。
  function showPinBadge(tip) {
    if (!tip._badge) {
      const badge = document.createElement('button');
      badge.type = 'button'; badge.className = 'lf-pin-badge'; badge.textContent = '文A';
      badge.title = '查看之前固定的译文'; badge.setAttribute('data-lf-ui', 'pin-badge');
      badge.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        badge.hidden = true;
        tip.hidden = false; // 重新展示之前缓存的译文文本
      });
      document.documentElement.appendChild(badge); tip._badge = badge;
    }
    const a = tip._anchor || { x: window.scrollX + 16, y: window.scrollY + 16 };
    tip._badge.style.left = `${Math.max(4, Math.min(a.x, window.scrollX + window.innerWidth - 30))}px`;
    tip._badge.style.top = `${Math.max(window.scrollY + 4, a.y)}px`;
    tip._badge.hidden = false;
  }
  // 统一的“收起浮层”：普通浮层直接隐藏；固定浮层隐藏的同时在原选区旁留下“文A”小方框。
  function dismissTooltip(tip) {
    if (!tip) return;
    tip.hidden = true;
    if (tip.dataset.pinned) showPinBadge(tip);
  }
  // 收起当前所有可见的浮层（普通浮层 + 固定浮层），用于“点击浮层外部”和 Escape。
  function dismissAllTooltips() {
    dismissTooltip(tooltip);
    pinnedTips.forEach(tip => { if (tip.isConnected && !tip.hidden) dismissTooltip(tip); });
  }
  function makeTooltip() {
    if (tooltip) return tooltip;
    const tip = document.createElement('div'); tip.className = 'lf-selection-tooltip'; tip.setAttribute('data-lf-ui','tooltip'); tip.hidden = true;
    const label = document.createElement('div'); label.className = 'lf-tooltip-label'; label.textContent = 'LinguaFlow AI';
    const content = document.createElement('div'); content.className = 'lf-tooltip-content'; content.textContent = '正在翻译…';
    const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'lf-tooltip-pin'; pin.textContent = '📌'; pin.setAttribute('aria-label','固定浮层'); pin.title = '固定：点击页面其他位置时浮层收起，但在原文旁保留“文A”小方框，点击它即可重新查看之前的译文；再次选中相同文本也会直接显示之前的翻译。';
    pin.addEventListener('click', () => {
      if (tip.dataset.pinned) { // 再点一次 = 取消固定，移除小方框
        tip.dataset.pinned = ''; tip.classList.remove('lf-pinned'); pin.textContent = '📌'; pin.setAttribute('aria-label','固定浮层');
        pinnedTips.delete(tip);
        if (tip._badge) tip._badge.remove(); tip._badge = null;
        if (!tooltip) tooltip = tip; // 没有其他浮层时复用它
        return;
      }
      tip.dataset.pinned = '1'; tip.classList.add('lf-pinned'); pin.textContent = '📍'; pin.setAttribute('aria-label','取消固定');
      pinnedTips.add(tip);
      if (tooltip === tip) tooltip = null;
    });
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label','关闭');
    close.addEventListener('click', () => { tip.remove(); pinnedTips.delete(tip); if (tip._badge) tip._badge.remove(); if (tooltip === tip) tooltip = null; });
    tip.append(label, pin, close, content); tip._content = content;
    document.documentElement.appendChild(tip); tooltip = tip; return tooltip;
  }
  async function translateSelection() {
    const seq = ++selectionSeq;
    const selection = window.getSelection(); const text = selection?.toString().trim();
    if (!text || text.length > 1800) return;
    const rect = selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    dismissTooltip(tooltip); // 收起上一个浮层（固定浮层收起后在原处留下“文A”小方框）
    const tip = makeTooltip(); tip.hidden = false; tip._content.textContent = '正在翻译…';
    tip._anchor = { x: (rect?.right || 8) + window.scrollX + 4, y: (rect?.top || 8) + window.scrollY + 2 }; // “文A”小方框的定位锚点
    tip.style.left = `${Math.max(8, Math.min((rect?.left || 8), window.innerWidth - 330))}px`;
    tip.style.top = `${Math.max(8, Math.min((rect?.bottom || 8) + window.scrollY + 8, window.scrollY + window.innerHeight - 160))}px`;
    const cached = selectionCache.get(text);
    if (cached !== undefined) { tip._content.textContent = cached; return; }
    const response = await sendTranslation([text]);
    if (!tip.isConnected || tip.hidden || seq !== selectionSeq) return;
    if (response.ok) { selectionCache.set(text, response.translations[0]); tip._content.textContent = response.translations[0]; }
    else tip._content.textContent = `翻译失败：${response.error}`;
  }
  function makeHoverButton() {
    if (hoverButton) return hoverButton;
    hoverButton = document.createElement('button'); hoverButton.className = 'lf-hover-button'; hoverButton.type = 'button'; hoverButton.textContent = '译'; hoverButton.title = '翻译此段'; hoverButton.setAttribute('data-lf-ui','hover-button');
    hoverButton.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      const el = hoveredParagraph; if (!el) return;
      const text = paragraphText(el);
      hoverButton.textContent = '…'; hoverButton.disabled = true;
      try {
        const response = await sendTranslation([text]);
        if (response.ok) showTranslation(el, text, response.translations[0]);
        else { const tip = makeTooltip(); tip.hidden = false; tip._content.textContent = response.error; }
      } finally { hoverButton.textContent = '译'; hoverButton.disabled = false; }
    });
    document.documentElement.appendChild(hoverButton); return hoverButton;
  }
  document.addEventListener('mousemove', event => {
    // Movement over our own hover button / tooltip keeps the current state;
    // treating them as "outside the paragraph" would hide the button before the user can click it.
    if (event.target instanceof Element && event.target.closest(lfUiSelector)) return;
    const target = event.target instanceof Element ? event.target.closest('p, li, blockquote, h1, h2, h3, h4, td, th') : null;
    if (!target || !eligible(target)) { if (hoverButton) hoverButton.hidden = true; hoveredParagraph = null; return; }
    hoveredParagraph = target; const btn = makeHoverButton(); const rect = target.getBoundingClientRect();
    btn.style.left = `${Math.max(4, Math.min(rect.right + window.scrollX - 28, window.scrollX + window.innerWidth - 34))}px`;
    btn.style.top = `${Math.max(window.scrollY + 4, rect.top + window.scrollY)}px`; btn.hidden = false;
  }, { passive: true });
  document.addEventListener('mouseup', event => {
    // Clicks on our own UI (hover button, tooltip close button) must not re-trigger
    // selection translation or reopen a tooltip the user just closed.
    if (event.target instanceof Element && event.target.closest(lfUiSelector)) return;
    clearTimeout(selectionTimer); selectionTimer = setTimeout(() => {
      const text = window.getSelection()?.toString().trim();
      if (text) translateSelection();
      // Clearing the selection by clicking elsewhere should also dismiss the tooltip;
      // pinned tooltips collapse to a small "文A" badge next to the original text.
      else dismissAllTooltips();
    }, 350);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') dismissAllTooltips(); });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'LF_TRANSLATE_PAGE') {
      translatePage()
        .then(result => sendResponse(result || { ok: false, error: '翻译未返回结果。' }))
        .catch(error => sendResponse({ ok: false, error: error?.message || '翻译过程发生错误。' }));
      return true;
    }
    if (message?.type === 'LF_TOGGLE_TRANSLATIONS') { sendResponse({ visible: toggleTranslations() }); }
  });
})();
