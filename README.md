# LinguaFlow AI（MVP 0.2.0）

Chrome / Edge Manifest V3 浏览器扩展：支持两种可随时切换的翻译引擎——Google 免费翻译（无需 API Key，基于 Google 网页版翻译的非官方接口）与用户自行配置的 OpenAI 兼容 Chat Completions API——做网页双语翻译、选中文本翻译和段落悬停翻译。

## 当前功能

- 两种并列可切换的翻译引擎：Google 免费翻译（无需 API Key）与 AI 大模型翻译（自定义 OpenAI 兼容 API）；可在设置页或 Popup 中切换，选择持久保存，切换失败时明确报错、不静默回退。
- Google 引擎使用 translate.googleapis.com 的非官方网页接口（不是 Google 官方 API），可能变化、限流或停止服务；只发送待翻译文本与语言参数，不携带 AI API Key。
- 一键翻译当前网页正文段落，译文显示在原文下方；列表项与表格单元格的译文追加在条目内部末尾，以避免破坏列表和表格结构。
- 显示 / 隐藏已插入的译文。
- 选中网页文本后弹出翻译浮层；浮层带“固定”按钮（× 关闭旁）：固定后点击页面其他位置浮层自动收起，但在原选区旁保留一个“文A”小方框，点击它即可重新展开之前的译文；再次选中相同文本也会直接显示之前的译文，不再重复请求（译文缓存仅保存在当前页面内存中，刷新后失效，不持久化）。
- 鼠标移动到合适的正文段落时出现“译”按钮，点击后翻译该段。
- 自定义 API Base URL、API Key、模型名称、源语言、目标语言和翻译风格。
- 首次使用时单独授权模型 API 域名；不在安装时请求所有网站权限。

## 安装（开发者模式）

1. 下载并解压项目 ZIP。
2. Chrome 打开 `chrome://extensions/`，Edge 打开 `edge://extensions/`。
3. 打开“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本仓库的根目录（即包含 `manifest.json` 的目录）。
5. 点击扩展图标，打开“翻译设置”，选择默认翻译引擎。
6. Google 免费翻译：无需任何配置，保存后可直接使用；如遇网络失败可点击“授权 Google 翻译域名”后重试。
7. AI 大模型翻译：填写 API Base URL（例如 `https://api.openai.com/v1`）、API Key 和模型名称，保存；点击“授权 API 域名”，在浏览器权限提示中确认。
8. 点击“测试翻译”，确认返回译文。
9. 打开普通 HTTP/HTTPS 网页，点击扩展图标并选择“翻译当前网页”。

## 翻译引擎说明

- **Google 免费翻译**：调用 `https://translate.googleapis.com/translate_a/single`（`client=gtx`）非官方网页接口；目标语言使用设置中的目标语言（默认简体中文），源语言支持自动检测。该接口不是 Google 官方公开 API，不承诺配额或稳定性，可能变化、限流（HTTP 429）或停止服务；失败时明确报错，不伪造结果，也不静默回退到 AI 引擎。长文本按约 1200 字符分段（优先在换行/句末切分），最多 2 个并发请求，网络错误 / 429 / 5xx 仅自动重试一次。
- **AI 大模型翻译**：沿用原有 [OI] 兼容 Chat Completions 实现，配置方式完全不变；选择 Google 引擎时不会调用 AI API。
- 引擎选择保存在 `chrome.storage.local`；从未选择过引擎但已保存过 API Key 的老用户默认保持 AI 引擎，全新用户默认 Google。
- 切换引擎后，已插入页面的译文不会自动重译，也不会重复插入；刷新页面或翻译新内容时使用当前引擎。同一段文本只调用当前选中的引擎。

## API 设置说明

- Base URL 可填 API 根地址（例如 `https://api.openai.com/v1`）或以 `/chat/completions` 结尾的完整端点。
- 程序自动请求 `{Base URL}/chat/completions`；若 Base URL 已以 `/chat/completions` 结尾则直接使用，不会重复追加。
- 供应商需要支持 OpenAI 风格的 `POST /chat/completions`、Bearer Key 认证和 `choices[0].message.content` 返回格式。
- 某些供应商可能不支持 `temperature` 参数，或要求特定请求头；如遇此类情况，需要在后续版本加入供应商兼容选项。

## 安全与隐私

- Google 模式下，待翻译文本会发送到 Google 的服务端（translate.googleapis.com）；该请求不携带 AI API Key 或任何凭据。AI 模式下文本只发送给你配置的 API 服务，不会发送到 Google。
- Google 引擎使用非官方网页接口，本项目不将其宣传为 Google 官方免费 API，也不承诺其稳定性、配额或永久可用性。
- API Key 保存在 `chrome.storage.local` 中；本地存储不是硬件密钥库。拥有本机账户访问权或扩展调试权限的人可能有机会读取它。
- 翻译文本会发送到用户填写的 API 服务。不要翻译密码、令牌、私密邮件或其他敏感内容。
- 扩展只在用户触发翻译时发送文本，不自动上传浏览历史。
- API 域名通过可选 host permission 按需授权，而不是安装时申请所有网站访问权限。
- 项目不包含统计、遥测、远程脚本或广告。
- 本项目是个人开发 MVP，尚未完成安全审计；不要用于高度敏感场景。

## 目录结构

```text
.
├── manifest.json
├── README.md
├── src/
│   ├── background.js   # 引擎分发层 + AI（[OI] 兼容）请求、提示词、结果校验
│   ├── engines/
│   │   └── google.js   # Google 免费翻译引擎（非官方网页接口）
│   ├── content.js     # 网页段落识别、双语展示、选中/悬停交互
│   ├── content.css    # 网页翻译样式
│   ├── popup.html/js   # 扩展弹出面板
│   ├── options.html/js # API 配置、域名授权、API 测试
│   └── ui.css
└── tests/
    ├── manual-test-plan.md
    └── google-engine.test.js  # Google 引擎离线单元测试（node tests/google-engine.test.js）
```

## 已知限制

- Google 引擎依赖 Google 网页版翻译的非官方接口，可能变化、限流（HTTP 429）或停止服务；不支持翻译风格、术语表等 AI 引擎能力，超长段落按约 1200 字符分块翻译，分块边界可能影响句间衔接。
- Google 引擎对每个段落单独发起请求，超长网页会触发较多请求，可能被限流；被限流时会提示稍后重试。
- 切换引擎不会自动重译已显示的译文，也不会删除它们；刷新页面后重新翻译即可。
- 暂不支持浏览器内部页面（`chrome://`、`edge://`）、Chrome Web Store 页面、PDF 内置查看器、跨域 iframe、部分特殊网页应用。
- 网页识别采用通用 DOM 规则，不保证覆盖每个网站；正文中较长的列表项也可能被识别。
- 页面翻译逐批处理，每批最多 8 段，单次消息最多 20 段；超长网页会多次请求，可能产生 API 费用。
- 选中文本弹窗在选择文字后触发；页面自身的选中交互可能与其冲突。
- 目前没有翻译缓存持久化、取消请求、增量翻译、术语表或模型自动发现；模型 API 请求超过 90 秒未返回会按超时失败处理。
- 不支持流式输出。

## Agent 开发约束

请先阅读 `AGENTS.md`（如果存在）和本 README。改动前先说明影响文件与测试方式；不得将 API Key 写入源码、日志、测试样例或 Git；不得引入远程执行代码；保持 Manifest V3；优先最小变更；每次完成后执行可用的静态检查并更新已知限制。不得擅自增加云端账号、遥测或付费系统。
