# Web Notes

网页标注 Chrome 浏览器扩展 —— 高亮划线、Markdown 笔记、跨设备同步。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README_EN.md) | [中文](README.md)

<img src="src/assets/icons/icon128.png" width="64" height="64" alt="Web Notes icon">

> **本项目全部由 AI 辅助构建。** 代码可自由修改，有问题欢迎提 [Issue](https://github.com/lhh-pi/web-notes/issues)（但我比较懒，不一定修 😅），更推荐用 AI 工具自己动手，想要什么功能自己加~

## 目录

- [功能特性](#功能特性)
- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [同步与备份](#同步与备份)
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
- **暗色模式**：侧边栏和气泡 UI 支持 dark/light 主题，首次启动跟随系统偏好，手动切换持久化
- **多设备同步**：通过 File System Access API 将数据同步到单个 JSON 文件，配合 OneDrive / iCloud 等云盘实现跨设备同步。支持手动/自动两种模式（**推荐手动模式**）
- **导出/导入**：支持导出全部笔记为 JSON 文件备份，也支持从 JSON 文件导入合并（newer-wins 策略）

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
│  │ • 气泡 UI    │   │ • 搜索面板│   │ • 消息路由     │  │
│  │ • 锚定计算   │   │ • 页面管理│   │ • 广播通知     │  │
│  └──────┬───────┘   └─────┬─────┘   └───────┬────────┘  │
│         │                 │                  │           │
│         │    chrome.runtime.sendMessage      │           │
│         └─────────────────┬──────────────────┘           │
│                           │                              │
│                    ┌──────▼──────┐                       │
│                    │   db.ts     │                       │
│                    │  IndexedDB  │ ← 浏览器原生数据库      │
│                    └──────┬──────┘                       │
│                           │                              │
│                    ┌──────▼──────┐                       │
│                    │  sync.ts    │ ← 可选，文件同步        │
│                    │ File System │                       │
│                    │ Access API  │                       │
│                    └──────┬──────┘                       │
└───────────────────────────┼──────────────────────────────┘
                            │ 用户选择的文件
                            ▼
                 ~/OneDrive/web-notes.json
                            │
                 OneDrive 客户端自动同步
                            │
                            ▼
                      另一台电脑
```

### 数据流

- **Content Script → Background → IndexedDB**：高亮的创建、更新、删除通过 background worker 统一写入，保证数据一致性
- **Sidebar → IndexedDB (直接)**：搜索、页面列表、删除等查询和管理操作直接从侧边栏访问 IndexedDB
- **sync.ts → JSON 文件**：自动模式下每次数据变更自动写回；手动模式下用户点击按钮触发

### 零依赖运行

扩展完全自包含，不需要 Python、不需要 conda、不需要任何外部服务。用户安装扩展后即可开始标注。同步功能可选，需要用户选择一个 JSON 文件存储位置（如 OneDrive 目录）。

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
│   │   ├── index.ts              #     入口：标签切换、主题、同步控制
│   │   ├── note_list.ts          #     当前页面笔记列表 (含 broken)
│   │   ├── page_list.ts          #     全部页面列表 (域名分组/删除)
│   │   └── search_panel.ts       #     全文搜索面板
│   ├── background/               #   Service Worker
│   │   └── index.ts              #     消息路由 + 右键菜单
│   ├── shared/                   #   共享模块
│   │   ├── types.ts              #     TypeScript 类型定义
│   │   ├── db.ts                 #     IndexedDB 存储层 (CRUD + 搜索 + 导出)
│   │   └── sync.ts               #     File System API 同步层 (自动/手动/导入导出)
│   ├── assets/                   #   静态资源
│   │   └── icons/                #     扩展图标 (16/48/128 px)
│   └── styles/                   #   样式表
│       ├── highlight.css         #     高亮颜色 & 气泡 UI & Preview 样式
│       └── sidebar.css           #     侧边栏样式 (含暗色模式 CSS Variables)
├── scripts/                      # 辅助脚本
│   └── generate_icons.py         #   图标生成 (Pillow)
├── manifest.json                 # Chrome MV3 清单
├── package.json                  # npm 依赖 & 脚本
├── tsconfig.json                 # TypeScript 编译配置
├── vite.config.ts                # Vite + crxjs 插件配置
├── .gitignore
├── CLAUDE.md                     # AI 开发规范
├── README.md                     # 本文件
└── README_EN.md                  # 英文版
```

## 环境要求

| 组件 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 18 | 构建 Chrome 扩展 |
| npm | ≥ 9 | 包管理 |
| Chrome / Edge | ≥ 114 | 支持 Side Panel API；同步功能需要 ≥ 86（File System Access API） |

> **没有 Node.js？** 推荐通过 [nvm](https://github.com/nvm-sh/nvm) 安装，或从 [nodejs.org](https://nodejs.org/) 下载安装包。

**不再需要 Python / conda / 任何后端服务。** 扩展完全自包含。

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/lhh-pi/web-notes
cd note
```

### 2. 安装依赖

```bash
npm install
```

`package.json` 中的依赖（`node_modules/` 已 gitignore，每个用户需自行安装）：

| 包名 | 版本 | 类型 | 用途 |
|------|------|------|------|
| `marked` | ^18.0.5 | 运行时 | Markdown 渲染（气泡预览） |
| `@crxjs/vite-plugin` | ^2.0.0-beta.28 | 开发 | Chrome 扩展 Vite 打包插件 |
| `@types/chrome` | ^0.0.268 | 开发 | Chrome API TypeScript 类型定义 |
| `typescript` | ^5.4.0 | 开发 | TypeScript 编译 + 类型检查 |
| `vite` | ^5.4.0 | 开发 | 构建工具 (bundler) |
| `vitest` | ^1.6.0 | 开发 | 单元测试框架 |

### 3. 构建扩展

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

### 4. 加载扩展到 Chrome

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目中的 `dist/` 目录
5. 扩展图标出现在工具栏，右键可固定

### 5. 开始使用

打开任意网页，选中文字 → 右键 → **Highlight**，即可创建第一条标注。

侧边栏打开方式：点击 Chrome 工具栏的 Web Notes 图标。

## 同步与备份

> **推荐使用手动同步模式。** 由于 Chrome 的 File System Access API 限制，自动模式无法持久保留文件写入权限，闲置一段时间后会频繁提示重新授权。手动模式下数据同样安全存储在 IndexedDB 中，打开侧边栏点击一次按钮即可完成同步。

### 手动同步（推荐）

Sync 选择 **Manual** → 点击 **Choose file** → 在 OneDrive / iCloud 目录中选择或创建 `web-notes.json` → 需要同步时点击 **↻ Sync now**。每次点击都会双向合并（newer-wins），不会丢数据。

### 自动同步

Sync 选择 **Auto** → 同样的方式选择文件。每次标注、修改、删除时自动写入 JSON 文件。**注意：闲置一段时间后写入权限可能丢失，页面顶部会出现提示横幅，需在侧边栏中重新授权或切换为手动模式。**

### 导出/导入 JSON（手动备份）

- **↓ Export JSON**：下载 `web-notes-YYYY-MM-DD.json` 到本地
- **↑ Import JSON**：选择之前导出的 JSON 文件，合并到当前数据库（newer-wins 策略，不会覆盖较新的笔记）

### 同步 JSON 文件格式

```json
{
  "version": 1,
  "exported_at": "2026-06-30T10:00:00Z",
  "domains": {
    "example.com": {
      "pages": [
        {
          "url": "https://example.com/article",
          "title": "文章标题",
          "highlights": [
            {
              "id": "a1b2c3d4",
              "text": "被高亮的原文文本",
              "color": "yellow",
              "note": "Markdown 格式的笔记内容",
              "anchor": {
                "text": "被高亮的原文文本",
                "prefix": "前文上下文（最多100字符）",
                "suffix": "后文上下文（最多100字符）",
                "xpath": "/html/body/div/p[2]/text()[1]",
                "offset": 42,
                "endXpath": "",
                "endOffset": 0
              },
              "created": "2026-06-29T10:30:00Z",
              "updated": "2026-06-30T14:20:00Z"
            }
          ]
        }
      ]
    }
  }
}
```

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
# 开发模式（带 HMR）
npm run dev

# 类型检查 + 构建
npm run build

# 运行测试
npm run test
```

### 代码规范

详见 [CLAUDE.md](CLAUDE.md)。

**TypeScript：**
- `const` / `let`，禁止 `var`
- 所有函数/类/接口必须有 JSDoc
- 所有参数和返回值必须标注类型，禁止 `any`
- `async/await`，禁止回调嵌套
- 文件名：`snake_case`，类名：`PascalCase`，函数/变量：`camelCase`

### 扩展指南

| 需求 | 操作 |
|------|------|
| **新增高亮颜色** | 1. 在 `src/shared/types.ts` 的 `HighlightColor` 中添加新色值<br>2. 在 `src/styles/highlight.css` 中补充 CSS 类 |
| **新增数据操作** | 1. 在 `src/shared/db.ts` 添加方法<br>2. 如需同步，确保调用 `sync.maybeSync()` |
| **新增侧边栏面板** | 1. 在 `src/sidebar/` 下新建组件文件<br>2. 在 `src/sidebar/index.ts` 中注册<br>3. 在 `src/sidebar/index.html` 中添加标签和面板元素 |
| **新增消息类型** | 1. 在 `src/shared/types.ts` 添加消息类型<br>2. 在 `src/background/index.ts` 添加消息路由 case |
| **重新生成图标** | `cd scripts && python generate_icons.py` |

## 常见问题

### 右键菜单不显示？

1. 检查扩展是否已加载：`chrome://extensions/` → 确认 "Web Notes" 已启用
2. 右键菜单仅在**选中文字**时显示，无法在 `chrome://` 或 `chrome-extension://` 页面使用

### 高亮刷新后消失？

1. 数据存储在浏览器 IndexedDB 中，刷新页面时会自动恢复
2. 如果页面内容变化较大，所有三级恢复均失败，高亮会被标记为 broken（侧边栏可见笔记内容）
3. 检查浏览器控制台（F12 → Console）查看日志

### 跨设备同步不生效？

1. 确认已在两台设备上都选择了同一个云盘目录下的 `web-notes.json`
2. 确认云盘客户端（OneDrive 等）正在运行且已同步
3. 如使用手动同步模式，确认已点击 "Sync now" 按钮

### 自动同步为什么频繁提示权限丢失？

这是 Chrome 的 File System Access API 安全限制，暂时无法解决。Chrome 不允许扩展在后台持久保留文件写入权限，闲置一段时间后权限会自动回收。**推荐改用 Manual（手动）模式**，数据存 IndexedDB 中不会丢失，打开侧边栏点击一下即可同步。

### 同步文件被移动或删除？

如果同步 JSON 文件被移动或删除，下次同步会失败。重新点击 **Choose (Change)** 选择文件即可恢复。

### 如何备份数据？

1. **同步备份**：开启同步后，OneDrive 目录中始终有一份 `web-notes.json`
2. **手动备份**：侧边栏点击 **↓ Export JSON** 下载

## 许可证

MIT License
