# Web Notes

网页标注 Chrome 浏览器扩展 —— 高亮划线、Markdown 笔记、跨设备同步。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)


[English](README_EN.md) | [中文](README.md)

<img src="src/assets/icons/icon128.png" width="64" height="64" alt="Web Notes icon">

> **本项目全部由 AI 辅助构建。** 代码可自由修改，有问题欢迎提 [Issue](<your-repo-url>/issues)（但我比较懒，不一定修 😅），更推荐用 AI 工具自己动手，想要什么功能自己加~

## 目录

- [功能特性](#功能特性)
- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [后端自启动](#后端自启动)
- [API 端点](#api-端点)
- [存储格式](#存储格式)
- [使用指南](#使用指南)
- [高亮恢复策略](#高亮恢复策略)
- [开发指南](#开发指南)
- [常见问题](#常见问题)

## 功能特性

- **高亮划线**：选中文字 → 右键上下文菜单，支持 4 色高亮（黄 / 绿 / 蓝 / 红），三种右键模式（纯高亮、高亮并添加笔记、选择颜色）
- **Markdown 笔记**：点击高亮区域弹出编辑气泡，支持 Markdown 实时预览（Edit / Preview 标签切换）
- **智能恢复**：三级降级锚定策略（XPath+offset → 上下文模糊匹配 → 纯文本兜底），页面小幅更新不丢失高亮
- **Broken 检测**：无法恢复的高亮在侧边栏灰色显示并标记 "Page changed" 徽章，笔记内容仍可查看
- **侧边栏管理**：三标签布局
  - **This Page**：当前页面所有高亮，支持点击跳转到高亮位置
  - **All Notes**：所有页面按域名分组，可展开折叠，支持标题/URL 筛选、新标签页打开、单页/整域名删除
  - **Search**：跨网站全文搜索（300ms 防抖 + Enter 即时搜索），匹配高亮文本、笔记内容、页面标题和 URL
- **暗色模式**：侧边栏和气泡 UI 支持 dark/light 主题，首次启动跟随系统偏好，手动切换持久化到 `chrome.storage.local`
- **多设备同步**：笔记存储路径通过 `.env` 文件独立配置（相对路径），配合 OneDrive 等云盘自动跨设备同步
- **系统服务**：Python 后端支持 systemd 自启动，日志按天按设备轮转清理

## 系统架构

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Extension (TypeScript + Vite)                    │
│                                                          │
│  ┌──────────────┐   ┌───────────┐   ┌────────────────┐  │
│  │ Content      │   │ Sidebar   │   │ Background     │  │
│  │ Script       │   │ (Side     │   │ Service Worker │  │
│  │ (网页注入)    │   │  Panel)   │   │ (消息路由)      │  │
│  │              │   │           │   │                │  │
│  │ • 高亮渲染   │   │ • 笔记列表│   │ • 右键菜单注册  │  │
│  │ • 气泡 UI    │   │ • 搜索面板│   │ • API 代理     │  │
│  │ • 锚定计算   │   │ • 页面管理│   │ • 广播通知     │  │
│  └──────┬───────┘   └─────┬─────┘   └───────┬────────┘  │
│         │                 │                  │           │
│         └────────┬────────┘                  │           │
│                  │ chrome.runtime.sendMessage │           │
│                  └────────────────────────────┘           │
│                              │                            │
└──────────────────────────────┼────────────────────────────┘
                               │ HTTP (localhost:2463)
                               ▼
┌──────────────────────────────────────────────────────────┐
│  Python Backend (FastAPI + Uvicorn)                      │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ server.py│  │storage.py│  │search.py │  │export.py│  │
│  │ (路由)    │  │ (JSON CRUD)│ │ (全文搜索)│  │ (MD导出) │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
│                              │                            │
│                    ┌─────────▼─────────┐                  │
│                    │  $NOTE_STORAGE/   │                  │
│                    │  (JSON 文件存储)   │                  │
│                    └───────────────────┘                  │
└──────────────────────────────────────────────────────────┘
```

### 消息通信

- **Content Script ↔ Background Worker**：`chrome.runtime.sendMessage`
- **Sidebar → Background Worker**：`chrome.runtime.sendMessage`
- **Sidebar → Python Backend**：部分查询类请求（搜索、页面列表）直接从侧边栏通过 `shared/api.ts` 发起 HTTP 请求
- **Background Worker → Python Backend**：HTTP 请求通过 `shared/api.ts` 统一封装

## 项目结构

```
note/
├── src/                          # Chrome 扩展源码 (TypeScript)
│   ├── content/                  #   内容脚本 (注入网页)
│   │   ├── index.ts              #     入口：消息处理、创建/恢复高亮
│   │   ├── highlighter.ts        #     高亮渲染 & DOM 恢复 (Range API)
│   │   ├── popup_bubble.ts       #     弹出编辑气泡 (Markdown 编辑/预览)
│   │   └── anchor.ts             #     文本锚定计算 & 三级恢复策略
│   ├── sidebar/                  #   侧边栏 UI (Side Panel)
│   │   ├── index.html            #     HTML 模板
│   │   ├── index.ts              #     入口：标签切换、主题、加载
│   │   ├── note_list.ts          #     当前页面笔记列表 (含 broken)
│   │   ├── page_list.ts          #     全部页面列表 (域名分组/删除)
│   │   └── search_panel.ts       #     全文搜索面板
│   ├── background/               #   Service Worker
│   │   └── index.ts              #     消息路由 + 右键菜单 + API 代理
│   ├── shared/                   #   共享模块
│   │   ├── types.ts              #     TypeScript 类型定义
│   │   └── api.ts                #     Python 后端 HTTP 客户端
│   ├── assets/                   #   静态资源
│   │   └── icons/                #     扩展图标 (16/48/128 px)
│   └── styles/                   #   样式表
│       ├── highlight.css         #     高亮颜色 & 气泡 UI & Preview 样式
│       └── sidebar.css           #     侧边栏样式 (含暗色模式 CSS Variables)
├── scripts/                      # 辅助脚本
│   └── generate_icons.py         #   图标生成 (Pillow)
├── backend/                      # Python 本地后端
│   ├── server.py                 #   FastAPI 入口 + 10 个路由
│   ├── storage.py                #   JSON 文件 CRUD + .index.json 索引
│   ├── search.py                 #   全文搜索 (评分排序)
│   ├── export.py                 #   Markdown 导出
│   ├── models.py                 #   Pydantic v2 数据模型 (8 个类)
│   ├── config.py                 #   配置管理 (读取 config.json + .env)
│   ├── run.sh                    #   启动/安装/卸载脚本
│   └── requirements.txt          #   Python 依赖
├── tests/                        # 测试
│   └── backend/
│       └── test_storage.py       #   存储层单元测试 (pytest)
├── manifest.json                 # Chrome MV3 清单
├── config.json                   # 共享配置：host + port
├── package.json                  # npm 依赖 & 脚本
├── tsconfig.json                 # TypeScript 编译配置
├── vite.config.ts                # Vite + crxjs 插件配置
├── .env.example                  # 私有配置模板
├── .gitignore
├── CLAUDE.md                     # AI 开发规范
└── README.md                     # 本文件
```

## 环境要求

| 组件 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 18 | 构建 Chrome 扩展 |
| npm | ≥ 9 | 包管理 |
| Python | 3.12 | 后端服务 |
| Conda | miniconda3 / anaconda3 | 虚拟环境管理（推荐） |
| Chrome | ≥ 114 | 支持 Side Panel API |

> **没有 Node.js？** 推荐通过 [nvm](https://github.com/nvm-sh/nvm) 安装
> 或从 [nodejs.org](https://nodejs.org/) 下载安装包。
>
> **没有 Conda？** 推荐 [miniconda3](https://docs.conda.io/en/latest/miniconda.html)：
> 也可以不用 conda，直接用系统 Python 3.12 + venv + pip。

## 快速开始

### 1. 克隆仓库

```bash
git clone <your-repo-url>
cd note
```

### 2. 安装 Node.js 依赖

```bash
npm install
```

`package.json` 中的依赖（`node_modules/` 已 gitignore，每个用户需通过以上命令自行安装）：

| 包名 | 版本 | 类型 | 用途 |
|------|------|------|------|
| `marked` | ^18.0.5 | 运行时 | Markdown 渲染（气泡预览） |
| `@crxjs/vite-plugin` | ^2.0.0-beta.28 | 开发 | Chrome 扩展 Vite 打包插件 |
| `@types/chrome` | ^0.0.268 | 开发 | Chrome API TypeScript 类型定义 |
| `typescript` | ^5.4.0 | 开发 | TypeScript 编译 + 类型检查 |
| `vite` | ^5.4.0 | 开发 | 构建工具 (bundler) |
| `vitest` | ^1.6.0 | 开发 | 单元测试框架 |

### 3. 创建 Python 虚拟环境并安装依赖

```bash
# 创建 conda 环境
conda create -n note python=3.12 -y
conda activate note

# 安装 Python 依赖
pip install -r backend/requirements.txt
```

`backend/requirements.txt` 包含：

| 包名 | 最低版本 | 用途 |
|------|----------|------|
| `fastapi` | 0.109.0 | HTTP API 框架 |
| `uvicorn[standard]` | 0.27.0 | ASGI 服务器（含 uvloop/http2） |
| `pydantic` | 2.5.0 | 数据校验和序列化 |
| `python-dotenv` | 1.0.0 | 加载 .env 环境变量 |

### 4. 配置存储路径

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```bash
# 笔记存储路径（相对项目根目录）
# 指向云盘目录可实现多设备自动同步
NOTE_STORAGE_PATH=../../3_datas/web_notes
```

> **多设备配置**：所有设备使用相同的相对路径写法，`.env` 文件不会被 Git 追踪（已在 `.gitignore` 中），每台设备独立配置。

### 5. 构建扩展

```bash
npm run build
```

> **说明**：`dist/` 目录已加入 `.gitignore`，用户需自行构建。这确保每次构建使用最新的依赖和配置。

构建产物输出到 `dist/` 目录，包含：
- `manifest.json` — Chrome 扩展清单
- `assets/` — 打包后的 JS/CSS bundle（带 hash 文件名和 sourcemap）
- `src/sidebar/index.html` — 侧边栏页面
- `src/styles/highlight.css` — 高亮样式
- `src/assets/icons/` — 扩展图标

### 6. 加载扩展到 Chrome

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目中的 `dist/` 目录
5. 扩展图标出现在工具栏，右键可固定

### 7. 启动后端

```bash
./backend/run.sh
```

启动成功后访问健康检查：

```bash
curl http://127.0.0.1:2463/api/health
# {"status":"ok","storage_path":"/path/to/notes","storage_exists":true}
```

> **提示**：首次启动会自动创建存储目录。如需开机自启，见[后端自启动](#后端自启动)。

### 8. 开始使用

打开任意网页，选中文字 → 右键 → **Highlight**，即可创建第一条标注。

侧边栏可通过以下方式打开：
- 点击 Chrome 工具栏的 Web Notes 图标
- 快捷键：`Ctrl+Shift+S`（可在 `chrome://extensions/shortcuts` 自定义）

## 配置说明

### config.json — 服务器配置

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 2463
  }
}
```

Python 后端通过 `json.load()` 读取，TypeScript 扩展通过 `import` 编译时内联。**修改端口后需重启后端 + 重新构建扩展**（`npm run build`）。

### .env — 私有配置

```bash
NOTE_STORAGE_PATH=../../3_datas/web_notes
```

- **路径类型**：相对路径，基于项目根目录（`note/`）解析
- **不使用绝对路径的原因**：跨设备时用户主目录不同，相对路径配合云盘目录树保持一致
- **默认值**：如果不配置，后端会在启动时报错

## 后端自启动

`backend/run.sh` 提供三种运行模式：

### 直接启动

```bash
./backend/run.sh
```

后台运行，日志写入 `logs/backend-<hostname>-<date>.log`。自动清理：当天设备日志保留，其他设备日志超过 7 天删除。

### 安装 systemd 服务（开机自启）

```bash
./backend/run.sh --install
```

功能：
1. 创建 `/etc/systemd/system/note-sync.service`
2. 服务配置：`Restart=always`，崩溃 10 秒后自动重启
3. 自动检测项目路径和 conda 位置
4. 执行 `systemctl enable` 设为开机自启
5. 立即 `systemctl restart` 启动服务

查看服务状态：

```bash
systemctl status note-sync
```

查看日志：

```bash
journalctl -u note-sync -f        # 实时跟踪
tail -f logs/backend-*.log         # 文件日志
```

### 卸载服务

```bash
./backend/run.sh --uninstall
```

停止服务、禁用自启、删除 service 文件。

## API 端点

所有 API 通过 `http://127.0.0.1:2463/api/` 访问。

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| `GET` | `/api/notes` | `url` (query, required) | 查询指定页面的所有笔记 |
| `POST` | `/api/notes` | JSON body: `CreateHighlightRequest` | 创建或替换一条高亮 |
| `PATCH` | `/api/notes/<id>` | `url` (query), JSON body: `{note?, color?}` | 更新高亮的笔记或颜色 |
| `DELETE` | `/api/notes/<id>` | `url` (query) | 删除一条高亮 |
| `GET` | `/api/search` | `q` (query, required, min_length=1) | 全文搜索（匹配文本/笔记/标题/URL） |
| `GET` | `/api/domains` | — | 列出所有有笔记的域名 |
| `GET` | `/api/pages` | — | 列出所有页面（含高亮数、更新时间） |
| `DELETE` | `/api/pages` | `url` (query) | 删除某 URL 的全部笔记 |
| `GET` | `/api/export` | `domain` (query, optional) | 导出笔记为 Markdown 文件下载 |
| `GET` | `/api/health` | — | 健康检查 |

### 请求/响应模型

完整的数据模型定义在 [src/shared/types.ts](src/shared/types.ts)（TypeScript）和 [backend/models.py](backend/models.py)（Pydantic），两者字段保持一致。

<details>
<summary>点击展开核心模型示例</summary>

**CreateHighlightRequest**（创建高亮）：

```json
{
  "url": "https://example.com/article",
  "title": "文章标题",
  "domain": "example.com",
  "text": "被选中的文字",
  "color": "yellow",
  "note": "可选的 Markdown 笔记",
  "anchor": {
    "text": "被选中的文字",
    "prefix": "前面100个字符...",
    "suffix": "后面100个字符...",
    "xpath": "/html/body/div/p[2]/text()[1]",
    "offset": 42,
    "endXpath": "",
    "endOffset": 0
  }
}
```

**SearchResult**（搜索结果）：

```json
{
  "url": "https://example.com/article",
  "title": "文章标题",
  "domain": "example.com",
  "highlight_id": "a1b2c3d4",
  "match_text": "匹配到的高亮原文",
  "note": "笔记内容",
  "context": "包含搜索关键词的上下文片段..."
}
```

</details>

## 存储格式

```
$NOTE_STORAGE_PATH/
├── .index.json                          # 全局索引
├── example.com/
│   ├── example-com-article-slug.json    # 页面笔记文件
│   └── example-com-another-slug.json
└── github.com/
    └── github-com-some-page-slug.json
```

### 页面 JSON 结构

每个页面一个 JSON 文件，文件名由 URL 路径规范化生成（非字母数字字符替换为 `-`，最长 200 字符）。

```json
{
  "url": "https://example.com/article",
  "title": "文章标题",
  "domain": "example.com",
  "created": "2026-06-29T10:30:00Z",
  "updated": "2026-06-29T14:20:00Z",
  "highlights": [
    {
      "id": "a1b2c3d4",
      "text": "被高亮的原文文本",
      "color": "yellow",
      "note": "Markdown 格式的笔记内容\n\n- [x] 已完成的 todo\n- [ ] 未完成",
      "anchor": {
        "text": "被高亮的原文文本",
        "prefix": "前文上下文（最多100字符）",
        "suffix": "后文上下文（最多100字符）",
        "xpath": "/html/body/div/p[2]/text()[1]",
        "offset": 42,
        "endXpath": "",
        "endOffset": 0
      },
      "created": "2026-06-29T10:30:00Z"
    }
  ]
}
```

### 全局索引 (`.index.json`)

```json
{
  "https://example.com/article": {
    "title": "文章标题",
    "domain": "example.com",
    "updated": "2026-06-29T14:20:00Z",
    "highlight_count": 5
  }
}
```

### 数据安全

- 所有文件写入采用 **原子写**：先写 `.tmp` 临时文件，成功后 `os.replace` 重命名，避免并发读写数据损坏
- 所有文件使用 **UTF-8** 编码
- 页面高亮全部删除后自动清理 JSON 文件，域名目录为空时自动清理目录

## 使用指南

### 创建高亮

1. 在网页上选中任意文字
2. 右键打开上下文菜单
3. 选择标注模式：
   - **Highlight** — 纯高亮（黄色），不做笔记
   - **Highlight & Add Note** — 高亮并自动弹出笔记编辑气泡
   - **Highlight (choose color)** → 选择颜色 — 指定颜色高亮

### 编辑笔记

- 点击页面上的高亮区域 → 弹出编辑气泡
- 在文本框中输入 Markdown 内容 → **800ms 防抖自动保存**
- **Edit** / **Preview** 标签切换实时渲染预览
- 颜色色块可随时切换，不会关闭气泡
- **Save & Close** 手动保存退出；直接关闭气泡也会触发自动保存
- **Delete** 按钮需二次确认，防止误删

### 管理笔记

侧边栏三个标签：

| 标签 | 功能 |
|------|------|
| **This Page** | 当前页面所有高亮列表，显示颜色条、引用文本、笔记预览、时间。支持点击 "Go to highlight" 滚动到高亮位置。Broken 高亮灰色显示并标注 "Page changed"。 |
| **All Notes** | 所有页面按域名分组。点击域名展开/折叠页面列表。支持标题/URL 筛选输入框。每页显示高亮数、更新时间。点击 "Open" 在新标签页打开。支持单页删除和整域名删除。 |
| **Search** | 搜索所有笔记。匹配高亮原文、笔记内容、页面标题和 URL。显示上下文片段。点击结果跳转到对应页面。 |

## 高亮恢复策略

每次页面加载时，扩展尝试恢复所有高亮。使用三级降级策略：

| 级别 | 策略 | 适用场景 |
|------|------|----------|
| **Tier 1** | XPath + 字符偏移量 | 页面 DOM 完全未变 — 精确恢复 |
| **Tier 2** | 前缀 + 后缀上下文模糊匹配 | DOM 有微小变化（如广告加载） |
| **Tier 3** | 纯文本匹配 (`innerText`) | DOM 结构大幅变化 — 兜底恢复 |
| **失败** | 标记为 Broken | 完全无法匹配（页面内容彻底改变） |

### Broken 高亮处理

- 侧边栏灰色显示，原文加删除线
- 显示橙色 "Page changed" 标签
- 笔记内容**仍然可以完整查看**
- 如果未来页面恢复，高亮也会自动恢复

## 开发指南

### 本地开发

```bash
# 开发模式（带 HMR，仅限侧边栏和 popup）
npm run dev

# 类型检查 + 构建
npm run build

# 运行测试
npm run test

# 测试监听模式
npm run test:watch
```

### 代码规范

详见 [CLAUDE.md](CLAUDE.md)。

**TypeScript：**
- `const` / `let`，禁止 `var`
- 所有函数/类/接口必须有 JSDoc
- 所有参数和返回值必须标注类型，禁止 `any`
- `async/await`，禁止回调嵌套
- 文件名：`snake_case`，类名：`PascalCase`，函数/变量：`camelCase`
- Chrome API 调用统一通过 `shared/api.ts` 封装

**Python：**
- PEP 8，4 空格缩进，88 字符行宽
- Google 风格 docstring（Args / Returns / Raises）
- 所有函数使用类型标注，禁止 `Any`
- Pydantic 模型定义请求/响应结构

### 扩展指南

| 需求 | 操作 |
|------|------|
| **新增高亮颜色** | 1. 在 `src/shared/types.ts` 的 `HighlightColor` 中添加新色值<br>2. 在 `backend/models.py` 的 `HighlightColor` 枚举中添加对应值<br>3. 在 `src/styles/highlight.css` 中补充 CSS 类 |
| **新增 API 端点** | 1. 在 `backend/server.py` 添加路由<br>2. 在 `src/shared/api.ts` 添加客户端方法<br>3. 在 `src/shared/types.ts` 添加消息类型<br>4. 在 `src/background/index.ts` 添加消息路由 case |
| **新增侧边栏面板** | 1. 在 `src/sidebar/` 下新建组件文件<br>2. 在 `src/sidebar/index.ts` 中注册<br>3. 在 `src/sidebar/index.html` 中添加标签和面板元素 |
| **修改端口** | 1. 编辑 `config.json`<br>2. 更新 `manifest.json` 的 `host_permissions`<br>3. 重启后端 + 重新 `npm run build` |
| **重新生成图标** | `cd scripts && python generate_icons.py` |

## 常见问题

### 右键菜单不显示？

1. 确认后端正在运行：`curl http://127.0.0.1:2463/api/health`
2. 检查扩展是否已加载：`chrome://extensions/` → 确认 "Web Notes" 已启用
3. 右键菜单仅在**选中文字**时显示，无法在 `chrome://` 或 `chrome-extension://` 页面使用

### 高亮刷新后消失？

可能原因：
1. 后端未运行 — 高亮数据保存在后端，刷新时重新从后端加载
2. 页面内容变化较大 — 所有三级恢复均失败，高亮被标记为 broken（侧边栏可见）
3. 检查浏览器控制台（F12 → Console）和后端日志（`logs/` 目录）

### 跨设备同步不生效？

1. 确认所有设备的 `.env` 中 `NOTE_STORAGE_PATH` 指向同一个云盘目录
2. 确认云盘客户端（OneDrive 等）正在运行且已同步
3. 本项目不做网络同步，完全依赖云盘客户端的文件同步能力

### 如何更换端口？

1. 编辑 `config.json` 修改端口
2. 编辑 `manifest.json`，在 `host_permissions` 中添加新端口
3. 重启后端：`systemctl restart note-sync`（或重新运行 `./backend/run.sh`）
4. 重新构建扩展：`npm run build`
5. 在 `chrome://extensions/` 刷新扩展

### 后端启动报错 "ModuleNotFoundError: No module named 'backend'"？

确认从**项目根目录**启动：

```bash
cd /path/to/note
python -m backend.server
```

不要进入 `backend/` 子目录后运行。

## 许可证

MIT License
