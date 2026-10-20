# LinguaFlow AI Agent 约束

## 项目目标
维护一个个人自用的 Chrome/Edge Manifest V3 AI 网页翻译扩展。首要目标是可运行、权限最小化、API Key 不泄露。

## 当前技术约束
- 原生 JavaScript + Manifest V3；不引入构建工具，除非用户明确同意。
- API 格式：OpenAI-compatible Chat Completions (`POST {baseUrl}/chat/completions`)。
- Base URL、模型名、Key 都由用户在 Options 页面配置。
- API 请求仅由扩展 service worker 发起；网页 content script 不直接读取 Key。
- 仅在用户触发翻译时发送网页文本。

## 不允许
- 不得把 API Key、token、Cookie 或个人文本写入源码、日志或 Git。
- 不得引入遥测、广告、远程脚本、eval 或下载后执行代码。
- 不得默认请求所有网站的持续访问权限；API 域名需按需授权。
- 不得在未经确认时增加登录、云端后端、数据库或付费系统。
- 不得将模型输出作为 HTML 注入；译文必须使用 `textContent`。

## 每次改动流程
1. 阅读 README 与相关源码，先列出计划。
2. 做最小变更，保持现有文件职责。
3. 检查 `manifest.json` JSON 语法、脚本语法和消息协议。
4. 运行可用测试；浏览器行为需按手动测试清单验证。
5. 更新 README 的功能和限制，不声称未实际验证的功能已通过。
