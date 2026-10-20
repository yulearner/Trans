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
  const lfUiSelector = '[data-lf-ui="hover-button"], [data-lf-ui="tooltip"]';

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
    return new Promise(resolve => chrome.runtime.sendMessage({ type: 'LF_TRANSLATE', texts }, response => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(response || { ok: false, error: '没有收到翻译服务响应。' });
    }));
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
  function makeTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div'); tooltip.className = 'lf-selection-tooltip'; tooltip.setAttribute('data-lf-ui','tooltip'); tooltip.hidden = true;
    const label = document.createElement('div'); label.className = 'lf-tooltip-label'; label.textContent = 'LinguaFlow AI';
    const content = document.createElement('div'); content.className = 'lf-tooltip-content'; content.textContent = '正在翻译…';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label','关闭'); close.addEventListener('click', () => tooltip.hidden = true);
    tooltip.append(label, close, content); tooltip._content = content; document.documentElement.appendChild(tooltip); return tooltip;
  }
  async function translateSelection() {
    const seq = ++selectionSeq;
    const selection = window.getSelection(); const text = selection?.toString().trim();
    if (!text || text.length > 1800) return;
    const rect = selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const tip = makeTooltip(); tip.hidden = false; tip._content.textContent = '正在翻译…';
    tip.style.left = `${Math.max(8, Math.min((rect?.left || 8), window.innerWidth - 330))}px`;
    tip.style.top = `${Math.max(8, Math.min((rect?.bottom || 8) + window.scrollY + 8, window.scrollY + window.innerHeight - 160))}px`;
    const response = await sendTranslation([text]);
    if (!tip.isConnected || tip.hidden || seq !== selectionSeq) return;
    tip._content.textContent = response.ok ? response.translations[0] : `翻译失败：${response.error}`;
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
      // Clearing the selection by clicking elsewhere should also dismiss the tooltip.
      else if (tooltip) tooltip.hidden = true;
    }, 350);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && tooltip) tooltip.hidden = true; });
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
