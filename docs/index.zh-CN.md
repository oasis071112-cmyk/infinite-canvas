# IonAiLabs无限画布文档索引

本文件是面向 AI 的文档地图，用户可见正文位于 `docs/content/docs/`。

## 建议入口

- `overview/quick-start.zh-CN.mdx`：启动完整前端与 Node API。
- `overview/features.zh-CN.mdx`：当前产品能力与数据边界。
- `overview/docker.zh-CN.mdx`：生产 Compose、Nginx、SQLite、备份与出站流量说明。
- `development/local-development.zh-CN.mdx`：源码开发方式。
- `canvas/`：画布操作与快捷键。
- `progress/pending-test.zh-CN.mdx`：已实现但待人工验收的变化。
- `progress/todo.zh-CN.mdx`：后续事项。
- `support/security.zh-CN.mdx`：漏洞提交与安全边界。

## 当前架构

浏览器 IndexedDB 保存画布项目、生成和导入媒体、音频、素材及完整生成历史；AI 请求只访问同域 `/api`。Node 服务在 SQLite 保存匿名会话、AES-256-GCM 加密的 OpenAI 兼容渠道、模型分配和不含提示词的调用摘要。不支持 WebDAV、原生 Gemini、原生火山方舟或自定义请求脚本。
