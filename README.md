# LinguaFlow AI（MVP 0.1.0）

Chrome / Edge Manifest V3 浏览器扩展：使用用户自行配置的 OpenAI 兼容 Chat Completions API 做网页双语翻译、选中文本翻译和段落悬停翻译。

## 当前功能

- 一键翻译当前网页正文段落，译文显示在原文下方；列表项与表格单元格的译文追加在条目内部末尾，以避免破坏列表和表格结构。
- 显示 / 隐藏已插入的译文。
- 选中网页文本后弹出翻译浮层。
- 鼠标移动到合适的正文段落时出现“译”按钮，点击后翻译该段。
- 自定义 API Base URL、API Key、模型名称、源语言、目标语言和翻译风格。
- 首次使用时单独授权模型 API 域名；不在安装时请求所有网站权限。

## 安装（开发者模式）

1. 下载并解压项目 ZIP。
2. Chrome 打开 `chrome://extensions/`，Edge 打开 `edge://extensions/`。
3. 打开“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本仓库的根目录（即包含 `manifest.json` 的目录）。
5. 点击扩展图标，打开“翻译设置”。
6. 填写 API Base URL（例如 `https://api.openai.com/v1`）、API Key 和模型名称，保存。
7. 点击“授权 API 域名”，在浏览器权限提示中确认。
8. 点击“测试 API”，确认返回译文。
9. 打开普通 HTTP/HTTPS 网页，点击扩展图标并选择“翻译当前网页”。

## API 设置说明

- Base URL 可填 API 根地址（例如 `https://api.openai.com/v1`）或以 `/chat/completions` 结尾的完整端点。
- 程序自动请求 `{Base URL}/chat/completions`；若 Base URL 已以 `/chat/completions` 结尾则直接使用，不会重复追加。
- 供应商需要支持 OpenAI 风格的 `POST /chat/completions`、Bearer Key 认证和 `choices[0].message.content` 返回格式。
- 某些供应商可能不支持 `temperature` 参数，或要求特定请求头；如遇此类情况，需要在后续版本加入供应商兼容选项。

## 安全与隐私

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
│   ├── background.js   # API 请求、提示词、结果校验
│   ├── content.js     # 网页段落识别、双语展示、选中/悬停交互
│   ├── content.css    # 网页翻译样式
│   ├── popup.html/js   # 扩展弹出面板
│   ├── options.html/js # API 配置、域名授权、API 测试
│   └── ui.css
└── tests/
    └── manual-test-plan.md
```

## 已知限制

- 暂不支持浏览器内部页面（`chrome://`、`edge://`）、Chrome Web Store 页面、PDF 内置查看器、跨域 iframe、部分特殊网页应用。
- 网页识别采用通用 DOM 规则，不保证覆盖每个网站；正文中较长的列表项也可能被识别。
- 页面翻译逐批处理，每批最多 8 段，单次消息最多 20 段；超长网页会多次请求，可能产生 API 费用。
- 选中文本弹窗在选择文字后触发；页面自身的选中交互可能与其冲突。
- 目前没有翻译缓存持久化、取消请求、增量翻译、术语表或模型自动发现；模型 API 请求超过 90 秒未返回会按超时失败处理。
- 不支持流式输出。

## Agent 开发约束

请先阅读 `AGENTS.md`（如果存在）和本 README。改动前先说明影响文件与测试方式；不得将 API Key 写入源码、日志、测试样例或 Git；不得引入远程执行代码；保持 Manifest V3；优先最小变更；每次完成后执行可用的静态检查并更新已知限制。不得擅自增加云端账号、遥测或付费系统。
