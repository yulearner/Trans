// Google 免费翻译引擎适配层（LinguaFlow AI 0.2.0）。
//
// 实现方式：调用 Google 网页版翻译（translate.googleapis.com/translate_a/single）
// 的非官方接口。该接口不是 Google 官方公开 API，可能变化、限流或停止服务，
// 也不承诺任何配额或永久可用性。本文件只发送完成翻译所必需的文本与语言参数，
// 不携带 AI API Key 或任何凭据；请求由扩展 Service Worker 发起，不在网页上下文执行。
// 返回内容仅作为纯文本使用，不解析 HTML、不执行脚本；不做任何验证码绕过或
// 反爬规避；响应不做永久缓存。

const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const GOOGLE_CHUNK_LIMIT = 1200;  // 单个请求的文本长度上限（字符），避免请求体过大。
const GOOGLE_CONCURRENCY = 2;     // 分段请求的最大并发数，降低触发限流的概率。
const GOOGLE_TIMEOUT_MS = 15000;  // 单个请求超时时间。
const GOOGLE_MAX_RETRIES = 1;     // 仅对网络错误 / HTTP 429 / 5xx 重试一次，避免无限请求。

// 设置页使用中文语言名，Google 接口需要语言代码。
const GOOGLE_LANG_CODES = {
  "自动检测": "auto",
  "中文": "zh-CN",
  "简体中文": "zh-CN",
  "繁体中文": "zh-TW",
  "英语": "en",
  "日语": "ja",
  "韩语": "ko",
  "法语": "fr",
  "德语": "de",
  "西班牙语": "es"
};

function googleLangCode(name, fallback) {
  return GOOGLE_LANG_CODES[String(name || "").trim()] || fallback;
}

// 长文本分块：优先在换行处切分，其次在句末标点处切分，避免从词中间截断。
function googleSplitChunks(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf("\n") + 1;
    if (cut < limit * 0.3) {
      const sentenceEnd = Math.max(
        window.lastIndexOf("。"), window.lastIndexOf(". "),
        window.lastIndexOf("！"), window.lastIndexOf("! "),
        window.lastIndexOf("？"), window.lastIndexOf("? ")
      );
      if (sentenceEnd + 1 >= limit * 0.3) cut = sentenceEnd + 1;
    }
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// 请求单个文本块并解析响应。
// 响应结构（非官方、当前观测）：[[["译文","原文",null,null,...],...],...,["检测到的语言",...]]
// 译文 = data[0] 中各片段按出现顺序拼接的结果。
async function googleFetchChunk(chunk, sourceCode, targetCode) {
  // 使用 URLSearchParams 构建参数确保正确编码；采用 POST 表单提交而不是 GET，
  // 避免长文本（URL 编码后中文每字符约膨胀 9 倍）超出 URL 长度限制。
  const params = new URLSearchParams({ client: "gtx", sl: sourceCode, tl: targetCode, dt: "t", q: chunk });
  let lastError = null;
  for (let attempt = 0; attempt <= GOOGLE_MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 800));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(GOOGLE_TRANSLATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: params.toString(),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      lastError = error?.name === "AbortError"
        ? new Error("Google 翻译请求超时（15 秒无响应）。请检查网络后重试。")
        : new Error(`无法连接 Google 翻译服务：${error?.message || "网络错误"}。请检查网络；如持续失败，可在设置中点击“授权 Google 翻译域名”后重试。`);
      continue; // 网络错误重试一次
    }
    clearTimeout(timer);
    if (response.ok) {
      let data;
      try { data = await response.json(); }
      catch { throw new Error("Google 翻译返回了无法解析的响应（非 JSON）。非官方接口可能已变化。"); }
      const segments = Array.isArray(data?.[0]) ? data[0] : null;
      if (!segments || !segments.length) throw new Error("Google 翻译返回的响应结构异常（缺少译文片段）。非官方接口可能已变化。");
      const translation = segments
        .map(segment => (Array.isArray(segment) && typeof segment[0] === "string") ? segment[0] : "")
        .join("");
      if (!translation.trim()) throw new Error("Google 翻译返回了空译文，请重试。");
      return translation;
    }
    if (response.status === 429) {
      lastError = new Error("Google 翻译请求过于频繁或触发限流（HTTP 429）。请稍后再试。");
      continue; // 限流时稍候重试一次
    }
    if (response.status >= 500) {
      lastError = new Error(`Google 翻译服务端错误（HTTP ${response.status}）。请稍后再试。`);
      continue; // 5xx 重试一次
    }
    if (response.status === 403) throw new Error("Google 翻译拒绝了请求（HTTP 403），可能是访问受限或接口已变化。");
    throw new Error(`Google 翻译请求失败（HTTP ${response.status}）。`);
  }
  throw lastError || new Error("Google 翻译请求失败。");
}

// 统一入口：与 AI 引擎保持相同的 texts[] -> translations[] 接口约定。
// 引擎选择由 background.js 的分发层处理；本函数失败时直接抛错，
// 绝不静默回退到 AI 引擎，也绝不调用 AI API。
async function googleTranslate(texts, options = {}) {
  const sourceCode = googleLangCode(options.sourceLang, "auto");
  const targetCode = googleLangCode(options.targetLang, "zh-CN");
  const results = new Array(texts.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < texts.length) {
      const index = nextIndex++;
      const text = texts[index];
      if (typeof text !== "string" || !text.trim()) { results[index] = ""; continue; }
      const chunks = googleSplitChunks(text, GOOGLE_CHUNK_LIMIT);
      const parts = [];
      for (const chunk of chunks) parts.push(await googleFetchChunk(chunk, sourceCode, targetCode));
      results[index] = parts.join("");
    }
  }
  const workerCount = Math.min(GOOGLE_CONCURRENCY, Math.max(texts.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}