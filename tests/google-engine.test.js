// 离线单元测试：mock 全局 fetch，验证 engines/google.js 的解析、分块、错误处理逻辑。
// 运行：node tests/google-engine.test.js（不访问网络，不依赖 Chrome API）
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'engines', 'google.js'), 'utf8');
const context = { URLSearchParams, setTimeout, clearTimeout, console, fetch: null, AbortController, Response, URL, Error, Promise, Array, Math, String, Number, JSON, Map };
vm.createContext(context);
vm.runInContext(source, context);

let fetchCalls = [];
let fetchImpl = null;
context.fetch = (...args) => { fetchCalls.push(args); return fetchImpl(...args); };

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

(async () => {
  // 1. 正常响应：多个片段按顺序拼接 + 请求参数正确
  fetchImpl = async () => new Response(JSON.stringify([
    [["你好", "Hello", null, null], ["，世界", ", world", null, null]], null, "en"
  ]), { status: 200 });
  fetchCalls = [];
  const r1 = await context.googleTranslate(["Hello, world"], { targetLang: "简体中文" });
  check("多片段按顺序拼接", r1[0] === "你好，世界", JSON.stringify(r1));
  const [url, init] = fetchCalls[0];
  check("请求地址为 translate_a/single", String(url).includes("translate_a/single"), String(url));
  const params = new URLSearchParams(init.body);
  check("client=gtx", params.get("client") === "gtx");
  check("sl 默认 auto（自动检测）", params.get("sl") === "auto", params.get("sl"));
  check("tl 默认 zh-CN", params.get("tl") === "zh-CN", params.get("tl"));
  check("dt=t", params.get("dt") === "t");
  check("q 正确编码", params.get("q") === "Hello, world", params.get("q"));
  check("不携带任何凭据头", !init.headers.Authorization && !init.headers["X-Goog-Api-Key"], JSON.stringify(init.headers));

  // 2. 特殊字符（引号、&、emoji、换行、URL）安全编码
  const tricky = 'He said "a & b" <tag> 🙂\nSee https://example.com/x?q=1&z=2';
  fetchImpl = async () => new Response(JSON.stringify([[[tricky + "!", tricky, null, null]], null, "en"]), { status: 200 });
  const r2 = await context.googleTranslate([tricky], { targetLang: "简体中文" });
  check("特殊字符安全编码并返回译文", r2[0] === tricky + "!", JSON.stringify(r2[0]).slice(0, 80));

  // 3. 长文本分块：>1200 字符触发多个请求，按顺序拼接
  fetchCalls = [];
  const long = ("The quick brown fox jumps over the lazy dog. ".repeat(40) + "\n") + "x".repeat(200);
  let calls = 0;
  fetchImpl = async () => { calls++; return new Response(JSON.stringify([[["第" + calls + "段", "chunk" + calls, null, null]], null, "en"]), { status: 200 }); };
  const r3 = await context.googleTranslate([long], {});
  check("长文本触发分块（多个请求）", calls > 1, `calls=${calls}`);
  check("分块译文按顺序拼接", r3[0] === Array.from({ length: calls }, (_, i) => `第${i + 1}段`).join(""), r3[0]);

  // 4. 空译文报错
  fetchImpl = async () => new Response(JSON.stringify([[["", "text", null, null]], null, "en"]), { status: 200 });
  try { await context.googleTranslate(["text"], {}); check("空译文报错", false); }
  catch (e) { check("空译文报错", /空译文/.test(e.message), e.message); }

  // 5. 结构异常响应报错（非 JSON / 缺少片段）
  fetchImpl = async () => new Response("<html>captcha</html>", { status: 200 });
  try { await context.googleTranslate(["text"], {}); check("非 JSON 响应报错", false); }
  catch (e) { check("非 JSON 响应报错", /无法解析/.test(e.message), e.message); }
  fetchImpl = async () => new Response(JSON.stringify([[], null, "en"]), { status: 200 });
  try { await context.googleTranslate(["text"], {}); check("缺少片段结构报错", false); }
  catch (e) { check("缺少片段结构报错", /结构异常/.test(e.message), e.message); }

  // 6. HTTP 403 明确报错、不重试
  fetchCalls = [];
  fetchImpl = async () => new Response("", { status: 403 });
  try { await context.googleTranslate(["text"], {}); check("HTTP 403 报错且不重试", false); }
  catch (e) { check("HTTP 403 报错且不重试", /403/.test(e.message) && fetchCalls.length === 1, `${e.message} calls=${fetchCalls.length}`); }

  // 7. HTTP 429：重试一次后仍失败则报错
  fetchCalls = [];
  fetchImpl = async () => new Response("", { status: 429 });
  try { await context.googleTranslate(["text"], {}); check("HTTP 429 重试一次后报错", false); }
  catch (e) { check("HTTP 429 重试一次后报错", /429/.test(e.message) && fetchCalls.length === 2, `${e.message} calls=${fetchCalls.length}`); }

  // 8. HTTP 5xx：重试一次后成功
  fetchCalls = [];
  let first = true;
  fetchImpl = async () => {
    if (first) { first = false; return new Response("", { status: 502 }); }
    return new Response(JSON.stringify([[["恢复成功", "text", null, null]], null, "en"]), { status: 200 });
  };
  const r8 = await context.googleTranslate(["text"], {});
  check("HTTP 5xx 重试一次后成功", r8[0] === "恢复成功" && fetchCalls.length === 2, `calls=${fetchCalls.length}`);

  // 9. 网络错误：重试一次后仍失败则报错
  fetchCalls = [];
  fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
  try { await context.googleTranslate(["text"], {}); check("网络错误重试一次后报错", false); }
  catch (e) { check("网络错误重试一次后报错", /无法连接/.test(e.message) && fetchCalls.length === 2, `${e.message} calls=${fetchCalls.length}`); }

  // 10. 超时：AbortError 转换为明确提示（默认 15 秒）
  fetchImpl = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
    });
  });
  const t0 = Date.now();
  try { await context.googleTranslate(["text"], {}); check("超时报错", false); }
  catch (e) {
    const elapsed = Date.now() - t0;
    check("超时报错", /超时/.test(e.message) && elapsed >= 14000, `${e.message} elapsed=${elapsed}ms`);
  }

  // 11. 多文本并发限制：5 段文本时最多 2 个并发
  fetchCalls = [];
  let inFlight = 0, maxInFlight = 0;
  fetchImpl = async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 30));
    inFlight--;
    return new Response(JSON.stringify([[["译" + fetchCalls.length, "t", null, null]], null, "en"]), { status: 200 });
  };
  const r11 = await context.googleTranslate(["a", "b", "c", "d", "e"], {});
  check("多文本返回数量一致", r11.length === 5 && r11.every(t => t.startsWith("译")), JSON.stringify(r11));
  check("并发限制为 2", maxInFlight <= 2, `maxInFlight=${maxInFlight}`);

  // 12. 语言代码映射
  fetchCalls = [];
  fetchImpl = async () => new Response(JSON.stringify([[["ok", "t", null, null]], null, "en"]), { status: 200 });
  await context.googleTranslate(["t"], { sourceLang: "英语", targetLang: "日语" });
  const p12 = new URLSearchParams(fetchCalls[0][1].body);
  check("源/目标语言映射为语言代码", p12.get("sl") === "en" && p12.get("tl") === "ja", `${p12.get("sl")}/${p12.get("tl")}`);

  // 13. 空白文本不发起请求，返回空串
  fetchCalls = [];
  const r13 = await context.googleTranslate(["   "], {});
  check("空白文本不请求且返回空串", fetchCalls.length === 0 && r13[0] === "", `calls=${fetchCalls.length}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
