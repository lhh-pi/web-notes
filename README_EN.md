# Web Notes

A Chrome browser extension for web page annotation — highlight text, take Markdown notes, and sync across devices.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README_EN.md) | [中文](README.md)

<img src="src/assets/icons/icon128.png" width="64" height="64" alt="Web Notes icon">

> **This project is entirely built with AI assistance.** Feel free to modify the code. [Issues](https://github.com/lhh-pi/web-notes/issues) are welcome (but I'm lazy and may not fix them 😅) — it's way more fun to use AI tools and build whatever features you want yourself!

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Sync & Backup](#sync--backup)
- [Usage Guide](#usage-guide)
- [Highlight Recovery Strategy](#highlight-recovery-strategy)
- [Development](#development)
- [FAQ](#faq)

## Features

- **Text Highlighting**: Select text → right-click context menu, 4 colors (yellow / green / blue / red), three modes (highlight only, highlight + note, choose color)
- **Markdown Notes**: Click any highlight to open an inline editing bubble with live Markdown preview (Edit / Preview tabs), interactive checkboxes, and 800ms debounced auto-save
- **Smart Recovery**: Three-tier anchor strategy (XPath+offset → context fuzzy match → text-only fallback) ensures highlights survive minor page changes
- **Broken Detection**: Highlights that can't be restored appear greyed out in the sidebar with a "Page changed" badge; note content remains fully readable
- **Sidebar Management**: Three-tab layout
  - **This Page**: all highlights on the current page, with "Go to highlight" scroll button
  - **All Notes**: all pages grouped by domain, expandable/collapsible, filter by title/URL, open in new tab, delete single pages or entire domains
  - **Search**: cross-site full-text search (300ms debounce + Enter for instant search), matches highlight text, note content, page title, and URL
- **Dark Mode**: sidebar and bubble UI support dark/light theme, follows system `prefers-color-scheme` on first launch, manual toggle persisted
- **Multi-Device Sync**: sync data to a single JSON file via File System Access API. Works with OneDrive, iCloud, or any cloud drive for cross-device sync. Supports manual and automatic modes (**manual recommended**)
- **Export/Import**: export all notes as a JSON file for backup; import from a JSON file with newer-wins merge strategy

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Extension (TypeScript + Vite)                    │
│                                                          │
│  ┌──────────────┐   ┌───────────┐   ┌────────────────┐  │
│  │ Content      │   │ Sidebar   │   │ Background     │  │
│  │ Script       │   │ (Side     │   │ Service Worker │  │
│  │ (injected)   │   │  Panel)   │   │ (msg routing)  │  │
│  │              │   │           │   │                │  │
│  │ • highlight  │   │ • notes   │   │ • context menu │  │
│  │ • bubble UI  │   │ • search  │   │ • msg routing  │  │
│  │ • anchoring  │   │ • pages   │   │ • broadcasting │  │
│  └──────┬───────┘   └─────┬─────┘   └───────┬────────┘  │
│         │                 │                  │           │
│         │    chrome.runtime.sendMessage      │           │
│         └─────────────────┬──────────────────┘           │
│                           │                              │
│                    ┌──────▼──────┐                       │
│                    │   db.ts     │                       │
│                    │  IndexedDB  │ ← browser-native DB   │
│                    └──────┬──────┘                       │
│                           │                              │
│                    ┌──────▼──────┐                       │
│                    │  sync.ts    │ ← optional, file sync │
│                    │ File System │                       │
│                    │ Access API  │                       │
│                    └──────┬──────┘                       │
└───────────────────────────┼──────────────────────────────┘
                            │ user-selected file
                            ▼
                 ~/OneDrive/web-notes.json
                            │
                 OneDrive client auto-syncs
                            │
                            ▼
                     another computer
```

### Data Flow

- **Content Script → Background → IndexedDB**: highlight create/update/delete go through the background worker for consistency
- **Sidebar → IndexedDB (direct)**: search, page listing, deletion are accessed directly from the sidebar
- **sync.ts → JSON file**: in auto mode, every data change triggers a write; in manual mode, only on button click

### Zero Dependencies at Runtime

The extension is fully self-contained. No Python, no conda, no external services needed. Install and start annotating immediately. Sync is optional — just select a JSON file location (e.g., inside a OneDrive folder).

## Project Structure

```
note/
├── src/                          # Chrome extension source (TypeScript)
│   ├── content/                  #   Content scripts (injected into pages)
│   │   ├── index.ts              #     Entry: message handling, highlight create/restore
│   │   ├── highlighter.ts        #     Highlight rendering & DOM restoration (Range API)
│   │   ├── popup_bubble.ts       #     Inline editing bubble (Markdown editor/preview)
│   │   └── anchor.ts             #     Text anchor computation & 3-tier recovery
│   ├── sidebar/                  #   Side panel UI
│   │   ├── index.html            #     HTML template
│   │   ├── index.ts              #     Entry: tab switching, theme, sync controls
│   │   ├── note_list.ts          #     Current page notes list (with broken badge)
│   │   ├── page_list.ts          #     All pages list (domain grouping, delete)
│   │   └── search_panel.ts       #     Full-text search panel
│   ├── background/               #   Service Worker
│   │   └── index.ts              #     Message routing + context menu
│   ├── shared/                   #   Shared modules
│   │   ├── types.ts              #     TypeScript type definitions
│   │   ├── db.ts                 #     IndexedDB storage layer (CRUD + search + export)
│   │   └── sync.ts               #     File System API sync layer (auto/manual/import/export)
│   ├── assets/                   #   Static assets
│   │   └── icons/                #     Extension icons (16/48/128 px)
│   └── styles/                   #   Stylesheets
│       ├── highlight.css         #     Highlight colors & bubble UI & preview
│       └── sidebar.css           #     Sidebar styles (CSS Variables, dark mode)
├── scripts/                      # Utility scripts
│   └── generate_icons.py         #   Icon generator (Pillow)
├── manifest.json                 # Chrome MV3 manifest
├── package.json                  # npm dependencies & scripts
├── tsconfig.json                 # TypeScript compiler config
├── vite.config.ts                # Vite + crxjs plugin config
├── .gitignore
├── CLAUDE.md                     # AI dev guidelines
├── README.md                     # Chinese version
└── README_EN.md                  # This file (English)
```

## Requirements

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | ≥ 18 | For building the extension |
| npm | ≥ 9 | Package management |
| Chrome / Edge | ≥ 114 | Required for Side Panel API; sync requires ≥ 86 (File System Access API) |

> **Don't have Node.js?** Install via [nvm](https://github.com/nvm-sh/nvm) or download from [nodejs.org](https://nodejs.org/).

**No Python, conda, or any backend service required.** The extension is fully self-contained.

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/lhh-pi/web-notes
cd note
```

### 2. Install Dependencies

```bash
npm install
```

Dependencies declared in `package.json` (`node_modules/` is gitignored — each user must install via the above command):

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `marked` | ^18.0.5 | Runtime | Markdown rendering (bubble preview) |
| `@crxjs/vite-plugin` | ^2.0.0-beta.28 | Dev | Chrome extension Vite bundling plugin |
| `@types/chrome` | ^0.0.268 | Dev | Chrome API TypeScript type definitions |
| `typescript` | ^5.4.0 | Dev | TypeScript compilation + type checking |
| `vite` | ^5.4.0 | Dev | Build tool (bundler) |
| `vitest` | ^1.6.0 | Dev | Unit test framework |

### 3. Build the Extension

```bash
npm run build
```

Build output goes to `dist/`.

### 4. Load the Extension in Chrome

1. Open Chrome, navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `dist/` directory in this project
5. The Web Notes icon appears in the toolbar — right-click to pin it

### 5. Start Using

Open any web page, select some text, right-click → **Highlight**, and you've created your first annotation.

To open the sidebar: click the Web Notes icon in the Chrome toolbar.

## Sync & Backup

> **Manual sync is recommended.** Due to Chrome's File System Access API limitations, Auto mode cannot persistently retain file write permissions. After a period of inactivity, the permission is revoked and you will be prompted to re-authorize. Manual mode keeps your data safely in IndexedDB — just open the sidebar and click one button to sync.

### Manual Sync (Recommended)

Set Sync to **Manual** → click **Choose file** → select or create `web-notes.json` in your OneDrive / iCloud folder → click **↻ Sync now** whenever you want to sync. Each sync performs a bidirectional newer-wins merge — no data loss.

### Auto Sync

Set Sync to **Auto** → choose a file the same way. Highlights, edits, and deletions are written to the JSON file automatically. **Note: write permission may be lost after idle time, triggering a warning banner at the top of the page. Re-authorize in the sidebar or switch to Manual mode.**

### Export/Import JSON (Manual Backup)

- **↓ Export JSON**: downloads `web-notes-YYYY-MM-DD.json` to your local disk
- **↑ Import JSON**: select a previously exported JSON file, merges into the current database (newer-wins — existing newer notes are not overwritten)

### Sync JSON File Format

```json
{
  "version": 1,
  "exported_at": "2026-06-30T10:00:00Z",
  "domains": {
    "example.com": {
      "pages": [
        {
          "url": "https://example.com/article",
          "title": "Article Title",
          "highlights": [
            {
              "id": "a1b2c3d4",
              "text": "The original highlighted text",
              "color": "yellow",
              "note": "Markdown note content",
              "anchor": {
                "text": "The original highlighted text",
                "prefix": "Preceding context (up to 100 chars)",
                "suffix": "Following context (up to 100 chars)",
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

## Usage Guide

### Creating Highlights

1. Select any text on a web page
2. Right-click to open the context menu
3. Choose a mode:
   - **Highlight** — pure highlight (yellow), no note
   - **Highlight & Add Note** — highlight and immediately open the note bubble
   - **Highlight (choose color)** → pick a color — highlight with a specific color

### Editing Notes

- Click any highlighted text on the page → editing bubble appears
- Type Markdown content → **800ms debounced auto-save**
- **Edit** / **Preview** tabs for live rendered preview
- In Preview mode, checkboxes are interactive and sync back to the Markdown source
- Color swatches can be changed at any time without closing the bubble
- **Save & Close** or simply close the bubble (auto-save triggers on close)
- **Delete** requires confirmation to prevent accidental removal

### Managing Notes

Three sidebar tabs:

| Tab | Purpose |
|-----|---------|
| **This Page** | Lists all highlights on the current page. Shows color strip, quoted text, note preview, timestamp. Click "Go to highlight" to scroll to it. Broken highlights are greyed out with a "Page changed" badge. |
| **All Notes** | All pages grouped by domain. Click domain to expand/collapse. Filter by title/URL. Shows highlight count and last-updated time per page. "Open" opens in a new tab. Delete individual pages or entire domains. |
| **Search** | Search all notes. Matches highlight text, note content, page title, and URL. Shows context snippets. Click a result to open that page. |

## Highlight Recovery Strategy

On every page load, the extension attempts to restore all highlights using a three-tier fallback:

| Tier | Strategy | When It Works |
|------|----------|---------------|
| **Tier 1** | XPath + character offset | DOM unchanged — precise restoration |
| **Tier 2** | Prefix + suffix context fuzzy match | Minor DOM changes (e.g., ad loads) |
| **Tier 3** | Text-only match (`innerText`) | Major DOM restructures — last resort |
| **Failed** | Mark as Broken | Content has changed completely |

### Broken Highlights

- Displayed greyed out in the sidebar with strikethrough text
- Orange "Page changed" badge
- Note content remains **fully readable**
- Automatically restored if the page content reverts to match

## Development

### Local Development

```bash
# Development mode (with HMR)
npm run dev

# Type check + build
npm run build

# Run tests
npm run test
```

### Code Conventions

See [CLAUDE.md](CLAUDE.md) for the full development guide.

**TypeScript:**
- `const` / `let` only (no `var`)
- JSDoc on all functions, classes, and interfaces
- Type annotations on all parameters and return values (no `any`)
- `async/await` only (no callback nesting)
- File names: `snake_case`, classes: `PascalCase`, functions/variables: `camelCase`

### Extension Guide

| Task | Steps |
|------|-------|
| **Add highlight color** | 1. Add value to `HighlightColor` in `src/shared/types.ts`<br>2. Add CSS class in `src/styles/highlight.css` |
| **Add data operation** | 1. Add method in `src/shared/db.ts`<br>2. Call `sync.maybeSync()` after write operations if needed |
| **Add sidebar panel** | 1. Create component file in `src/sidebar/`<br>2. Register in `src/sidebar/index.ts`<br>3. Add tab and panel in `src/sidebar/index.html` |
| **Add message type** | 1. Add type in `src/shared/types.ts`<br>2. Add case in `src/background/index.ts` |
| **Regenerate icons** | `cd scripts && python generate_icons.py` |

## FAQ

### Right-click menu not showing?

1. Check the extension is loaded and enabled: `chrome://extensions/`
2. The context menu only appears when **text is selected** and won't work on `chrome://` or `chrome-extension://` pages

### Highlights disappear after refresh?

1. Data is stored in the browser's IndexedDB — it persists across page refreshes and browser restarts
2. If the page content changed significantly, all three recovery tiers may fail; highlights are marked as broken (notes are still visible in the sidebar)
3. Check the browser console (F12 → Console) for logs

### Cross-device sync not working?

1. Ensure the same `web-notes.json` file is selected on both devices (inside a cloud drive directory)
2. Ensure your cloud drive client (OneDrive, etc.) is running and synced
3. If using manual sync mode, make sure you've clicked "Sync now"

### Why does Auto Sync keep asking for permission?

This is a Chrome File System Access API security restriction with no current workaround. Chrome does not allow extensions to persistently hold file write permissions in the background — they are revoked after idle time. **Switching to Manual mode is recommended.** Your data remains safe in IndexedDB; sync with one click when the sidebar is open.

### Sync file moved or deleted?

If the sync JSON file is moved or deleted, sync operations will fail. Click **Choose (Change)** to re-select the file.

### How to back up my data?

1. **Sync backup**: with sync enabled, a copy of `web-notes.json` always exists in your cloud drive folder
2. **Manual**: click **↓ Export JSON** in the sidebar footer

## License
