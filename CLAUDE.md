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
- Chrome API 调用统一通过 `shared/api.ts` 封装，禁止在组件中直接调用 `chrome.*` API

### Python

- 遵循 PEP 8，4 空格缩进，88 字符行宽限制，snake_case / PascalCase / UPPER_CASE 命名
- 所有公开函数、类、方法必须有 docstring（Google 风格：Args / Returns / Raises）
- 关键功能块前加一行简要注释说明意图，不注释自明代码
- 所有函数使用类型标注，禁止 `Any`
- 使用 f-string 格式化字符串
- 异常捕获使用具体类型，禁止裸 `except:`
- 使用 `with` 上下文管理器管理文件/网络资源
- 使用 Pydantic 模型定义请求/响应结构，禁止裸字典传递

## 核心约束

- **存储路径相对化**：`NOTE_STORAGE_PATH` 使用相对路径（相对项目根目录），`backend/config.py` 自动解析为绝对路径，一份配置适配所有设备
- **云盘同步依赖外部**：跨设备同步依赖云盘客户端自动同步，Python 后端仅做本地文件 I/O
- **编码处理**：所有文件读写使用 UTF-8 编码
- **网络请求**：扩展与 Python 后端之间的 HTTP 请求必须 try-catch，后端不可用时侧边栏显示离线提示
- **高亮安全**：Content Script 操作 DOM 时使用 `Range` API，不得修改网页原有结构（只包裹 `<mark>` 标签）
- **Token 安全**：如需登录凭证，必须从 `.env` 读取，禁止硬编码，禁止提交到 Git

## 测试规范

- 禁止在单测中发起真实网络请求或操作真实 DOM，必须使用 Mock 或 fixture
- 前端测试：Vitest，Mock Chrome API
- 后端测试：pytest，Mock 文件系统
- 新增 API 端点时，在 `tests/backend/` 下同步添加测试
- 新增前端组件时，在 `tests/content/` 下同步添加测试

## 开发流程

- 每次修改功能后，更新 README.md（记录最新功能、环境依赖、用法示例，不保留变更历史）

## 扩展方式

- **新增高亮颜色**：在 `shared/types.ts` 的 `HighlightColor` 联合类型中添加新色值，在 `styles/highlight.css` 中补充对应 CSS 类
- **新增 API 端点**：在 `backend/server.py` 添加路由，在 `shared/api.ts` 添加对应客户端方法，在 `shared/types.ts` 添加消息类型
- **新增侧边栏面板**：在 `sidebar/` 下新建组件文件，在 `index.ts` 中注册，在 `index.html` 中添加对应标签和面板
- **前后端类型同步**：TypeScript 类型（`shared/types.ts`）需与 Pydantic 模型（`backend/models.py`）保持字段名和语义一致
