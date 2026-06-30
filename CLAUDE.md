# Web Notes — Development Guide

## 代码风格

### TypeScript

- 使用 `const` / `let`，禁止 `var`
- 所有函数、类、接口必须有 JSDoc 注释
- 所有函数参数和返回值必须有类型标注，禁止 `any`
- 使用 `async/await` 处理异步，禁止回调嵌套
- 异常捕获使用具体错误类型，禁止裸 `catch`
- 使用模板字符串格式化
- 文件名：snake_case（如 `popup_bubble.ts`），类名 PascalCase，函数/变量 camelCase
- 数据操作通过 `shared/db.ts` 封装（IndexedDB），同步操作通过 `shared/sync.ts` 封装（File System Access API）

## 核心约束

- **存储为浏览器原生 IndexedDB**：数据存储在浏览器内置数据库，无需外部服务
- **文件同步可选**：sync.ts 通过 File System Access API（Chrome 86+）将数据镜像到 JSON 文件，配合云盘客户端实现跨设备同步
- **编码处理**：所有文件读写使用 UTF-8 编码
- **高亮安全**：Content Script 操作 DOM 时使用 `Range` API，不得修改网页原有结构（只包裹 `<mark>` 标签）
- **Token 安全**：如需登录凭证，必须从 `.env` 读取，禁止硬编码，禁止提交到 Git

## 测试规范

- 禁止在单测中发起真实网络请求或操作真实 DOM，必须使用 Mock 或 fixture
- 前端测试：Vitest，Mock Chrome API
- 新增前端组件时，在 `tests/content/` 下同步添加测试

## 开发流程

- 每次修改功能后，更新 README.md（记录最新功能、环境依赖、用法示例，不保留变更历史）

## 扩展方式

- **新增高亮颜色**：在 `shared/types.ts` 的 `HighlightColor` 联合类型中添加新色值，在 `styles/highlight.css` 中补充对应 CSS 类
- **新增数据操作**：在 `shared/db.ts` 添加 IndexedDB 操作方法；如需触发同步，调用 `sync.maybeSync()`
- **新增侧边栏面板**：在 `sidebar/` 下新建组件文件，在 `index.ts` 中注册，在 `index.html` 中添加对应标签和面板
- **新增消息类型**：在 `shared/types.ts` 的 `ContentMessage` / `BackgroundMessage` 中添加新类型，在 `background/index.ts` 的 `handleMessage` 中添加对应 case
- **同步功能**：所有写入操作后调用 `sync.maybeSync()`，该函数仅在 auto 模式下执行实际同步
