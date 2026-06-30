# Web Notes

A Chrome browser extension for web page annotation — highlight text, take Markdown notes, and sync across devices.

[English](README_EN.md) | [中文](README.md)

<img src="src/assets/icons/icon128.png" width="64" height="64" alt="Web Notes icon">

> **This project is entirely built with AI assistance.** Feel free to modify the code. [Issues](https://github.com/lhh-pi/web-notes/issues) are welcome (but I'm lazy and may not fix them 😅) — it's way more fun to use AI tools and build whatever features you want yourself!

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Auto-Start Backend](#auto-start-backend)
- [API Endpoints](#api-endpoints)
- [Storage Format](#storage-format)
- [Usage Guide](#usage-guide)
- [Highlight Recovery Strategy](#highlight-recovery-strategy)
- [Development](#development)
- [FAQ](#faq)

## Features

- **Text Highlighting**: Select text → right-click context menu, 4 colors (yellow / green / blue / red), three modes (highlight only, highlight + note, choose color)
- **Markdown Notes**: Click any highlight to open an inline editing bubble with live Markdown preview (Edit / Preview tabs), interactive checkboxes, and 800ms debounced auto-save
- **Smart Recovery**: Three-tier anchor strategy (XPath+offset → context fuzzy match → text-only fallback) ensures highlights survive minor page changes
- **Broken Detection**: Highlight that can't be restored appears greyed out in the sidebar with a "Page changed" badge; note content remains fully readable
- **Sidebar Management**: Three-tab layout
  - **This Page**: all highlights on the current page, with "Go to highlight" scroll button
  - **All Notes**: all pages grouped by domain, expandable/collapsible, filter by title/URL, open in new tab, delete single pages or entire domains
  - **Search**: cross-site full-text search (300ms debounce + Enter for instant search), matches highlight text, note content, page title, and URL
- **Dark Mode**: sidebar and bubble UI support dark/light theme, follows system `prefers-color-scheme` on first launch, manual toggle persisted to `chrome.storage.local`
- **Multi-Device Sync**: note storage path is a relative path configured via `.env`, works with OneDrive or any cloud drive for automatic cross-device sync
- **System Service**: Python backend supports systemd auto-start with daily per-device log rotation

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
│  │ • bubble UI  │   │ • search  │   │ • API proxy    │  │
│  │ • anchoring  │   │ • pages   │   │ • broadcasting │  │
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
│  │ (routes) │  │ (JSON CRUD)│ │(full-text)│ │(MD)     │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
│                              │                            │
│                    ┌─────────▼─────────┐                  │
│                    │  $NOTE_STORAGE/   │                  │
│                    │  (JSON files)     │                  │
│                    └───────────────────┘                  │
└──────────────────────────────────────────────────────────┘
```

### Communication

- **Content Script ↔ Background Worker**: `chrome.runtime.sendMessage`
- **Sidebar → Background Worker**: `chrome.runtime.sendMessage`
- **Sidebar → Python Backend**: some read-only requests (search, page listing) are made directly via `shared/api.ts`
- **Background Worker → Python Backend**: HTTP via `shared/api.ts` (the sole HTTP client module)

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
│   │   ├── index.ts              #     Entry: tab switching, theme, loading
│   │   ├── note_list.ts          #     Current page notes list (with broken badge)
│   │   ├── page_list.ts          #     All pages list (domain grouping, delete)
│   │   └── search_panel.ts       #     Full-text search panel
│   ├── background/               #   Service Worker
│   │   └── index.ts              #     Message routing + context menu + API proxy
│   ├── shared/                   #   Shared modules
│   │   ├── types.ts              #     TypeScript type definitions
│   │   └── api.ts                #     Python backend HTTP client
│   ├── assets/                   #   Static assets
│   │   └── icons/                #     Extension icons (16/48/128 px)
│   └── styles/                   #   Stylesheets
│       ├── highlight.css         #     Highlight colors & bubble UI & preview
│       └── sidebar.css           #     Sidebar styles (CSS Variables, dark mode)
├── scripts/                      # Utility scripts
│   └── generate_icons.py         #   Icon generator (Pillow)
├── backend/                      # Python local backend
│   ├── server.py                 #   FastAPI entry point + 10 routes
│   ├── storage.py                #   JSON file CRUD + .index.json
│   ├── search.py                 #   Full-text search with relevance scoring
│   ├── export.py                 #   Markdown export
│   ├── models.py                 #   Pydantic v2 data models (8 classes)
│   ├── config.py                 #   Config management (reads config.json + .env)
│   ├── run.sh                    #   Start / install / uninstall script
│   └── requirements.txt          #   Python dependencies
├── tests/                        # Tests
│   └── backend/
│       └── test_storage.py       #   Storage layer unit tests (pytest)
├── manifest.json                 # Chrome MV3 manifest
├── config.json                   # Shared config: host + port
├── package.json                  # npm dependencies & scripts
├── tsconfig.json                 # TypeScript compiler config
├── vite.config.ts                # Vite + crxjs plugin config
├── .env.example                  # Private config template
├── .gitignore
├── CLAUDE.md                     # AI dev guidelines
├── README.md                     # This file (Chinese)
└── README_EN.md                  # English version
```

## Requirements

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | ≥ 18 | For building the extension |
| npm | ≥ 9 | Package management |
| Python | 3.12 | Backend server |
| Conda | miniconda3 / anaconda3 | Virtual environment (recommended) |
| Chrome | ≥ 114 | Required for Side Panel API support |

> **Don't have Node.js?** Install via [nvm](https://github.com/nvm-sh/nvm) or download from [nodejs.org](https://nodejs.org/).
>
> **Don't have Conda?** We recommend [miniconda3](https://docs.conda.io/en/latest/miniconda.html). You can also skip conda and use system Python 3.12 + venv + pip directly.

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/lhh-pi/web-notes
cd note
```

### 2. Install Node.js Dependencies

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

### 3. Create Python Virtual Environment & Install Dependencies

```bash
# Create conda environment
conda create -n note python=3.12 -y
conda activate note

# Install Python dependencies
pip install -r backend/requirements.txt
```

`backend/requirements.txt` contents:

| Package | Min Version | Purpose |
|---------|-------------|---------|
| `fastapi` | 0.109.0 | HTTP API framework |
| `uvicorn[standard]` | 0.27.0 | ASGI server (with uvloop/http2) |
| `pydantic` | 2.5.0 | Data validation and serialization |
| `python-dotenv` | 1.0.0 | Load .env environment variables |

### 4. Configure Storage Path

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Note storage path (relative to project root)
# Point to a cloud drive directory for automatic multi-device sync
NOTE_STORAGE_PATH=../../3_datas/web_notes
```

> **Multi-device setup**: Use the same relative path on all devices. The `.env` file is git-ignored, so each device can have its own configuration.

### 5. Build the Extension

```bash
npm run build
```

> **Note**: The `dist/` directory is git-ignored. Users must build the extension themselves. This ensures each build uses up-to-date dependencies and configuration.

Build output in `dist/`:
- `manifest.json` — Chrome extension manifest
- `assets/` — bundled JS/CSS (hashed filenames with sourcemaps)
- `src/sidebar/index.html` — side panel page
- `src/styles/highlight.css` — highlight styles
- `src/assets/icons/` — extension icons

### 6. Load the Extension in Chrome

1. Open Chrome, navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `dist/` directory in this project
5. The Web Notes icon appears in the toolbar — right-click to pin it

### 7. Start the Backend

```bash
./backend/run.sh
```

Verify it's running:

```bash
curl http://127.0.0.1:2463/api/health
# {"status":"ok","storage_path":"/path/to/notes","storage_exists":true}
```

> The storage directory is created automatically on first startup. For auto-start on boot, see [Auto-Start Backend](#auto-start-backend).

### 8. Start Using

Open any web page, select some text, right-click → **Highlight**, and you've created your first annotation.

To open the sidebar:
- Click the Web Notes icon in the Chrome toolbar
- Or use the keyboard shortcut: `Ctrl+Shift+S` (customizable at `chrome://extensions/shortcuts`)

## Configuration

### config.json — Server Settings

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 2463
  }
}
```

The Python backend reads this via `json.load()`. The TypeScript extension imports it at build time (inlined by Vite). **After changing the port, restart the backend and rebuild the extension** (`npm run build`).

### .env — Private Settings

```bash
NOTE_STORAGE_PATH=../../3_datas/web_notes
```

- **Path type**: relative, resolved against the project root (`note/`)
- **Why relative?**: absolute paths differ across devices; relative paths work consistently when the project and storage are both inside a cloud drive directory tree
- **Default**: there is no default — the backend will fail to start without this configured

## Auto-Start Backend

`backend/run.sh` supports three modes:

### Direct Start

```bash
./backend/run.sh
```

Runs in the foreground, logs to `logs/backend-<hostname>-<date>.log`. Automatic cleanup: deletes this device's logs older than 1 day, and any device's logs older than 7 days.

### Install as systemd Service (Auto-Start on Boot)

```bash
./backend/run.sh --install
```

This will:
1. Create `/etc/systemd/system/note-sync.service`
2. Configure `Restart=always` with a 10-second delay on failure
3. Auto-detect project path and conda location
4. Run `systemctl enable` for auto-start on boot
5. Immediately restart the service

Check service status:

```bash
systemctl status note-sync
```

View logs:

```bash
journalctl -u note-sync -f        # Follow live
tail -f logs/backend-*.log         # File-based logs
```

### Uninstall Service

```bash
./backend/run.sh --uninstall
```

Stops the service, disables auto-start, and removes the service file.

## API Endpoints

All endpoints are served at `http://127.0.0.1:2463/api/`.

| Method | Path | Parameters | Description |
|--------|------|------------|-------------|
| `GET` | `/api/notes` | `url` (query, required) | Get all highlights for a page URL |
| `POST` | `/api/notes` | JSON body: `CreateHighlightRequest` | Create or replace a highlight |
| `PATCH` | `/api/notes/<id>` | `url` (query), JSON body: `{note?, color?}` | Update a highlight's note or color |
| `DELETE` | `/api/notes/<id>` | `url` (query) | Delete a single highlight |
| `GET` | `/api/search` | `q` (query, required, min_length=1) | Full-text search (matches text/note/title/URL) |
| `GET` | `/api/domains` | — | List all domains with notes |
| `GET` | `/api/pages` | — | List all pages with metadata (newest first) |
| `DELETE` | `/api/pages` | `url` (query) | Delete all highlights for a page URL |
| `GET` | `/api/export` | `domain` (query, optional) | Export notes as downloadable Markdown |
| `GET` | `/api/health` | — | Health check |

### Data Models

Complete type definitions are in [src/shared/types.ts](src/shared/types.ts) (TypeScript) and [backend/models.py](backend/models.py) (Pydantic). Both are kept in sync.

<details>
<summary>Click to expand core model examples</summary>

**CreateHighlightRequest**:

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "domain": "example.com",
  "text": "Selected text to highlight",
  "color": "yellow",
  "note": "Optional Markdown note",
  "anchor": {
    "text": "Selected text to highlight",
    "prefix": "Up to 100 preceding characters...",
    "suffix": "Up to 100 following characters...",
    "xpath": "/html/body/div/p[2]/text()[1]",
    "offset": 42,
    "endXpath": "",
    "endOffset": 0
  }
}
```

**SearchResult**:

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "domain": "example.com",
  "highlight_id": "a1b2c3d4",
  "match_text": "Matched highlight text",
  "note": "Note content",
  "context": "Surrounding context snippet with keyword match..."
}
```

</details>

## Storage Format

```
$NOTE_STORAGE_PATH/
├── .index.json                          # Global index
├── example.com/
│   ├── example-com-article-slug.json    # Page note file
│   └── example-com-another-slug.json
└── github.com/
    └── github-com-some-page-slug.json
```

### Page JSON Structure

One JSON file per page. Filenames are derived from the URL path (non-alphanumeric characters replaced with hyphens, max 200 chars).

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "domain": "example.com",
  "created": "2026-06-29T10:30:00Z",
  "updated": "2026-06-29T14:20:00Z",
  "highlights": [
    {
      "id": "a1b2c3d4",
      "text": "The original highlighted text",
      "color": "yellow",
      "note": "Markdown note content\n\n- [x] Completed task\n- [ ] Pending task",
      "anchor": {
        "text": "The original highlighted text",
        "prefix": "Preceding context (up to 100 chars)",
        "suffix": "Following context (up to 100 chars)",
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

### Global Index (`.index.json`)

```json
{
  "https://example.com/article": {
    "title": "Article Title",
    "domain": "example.com",
    "updated": "2026-06-29T14:20:00Z",
    "highlight_count": 5
  }
}
```

### Data Safety

- All file writes use **atomic writes**: write to `.tmp` file first, then `os.replace` to the target — prevents corruption from concurrent access
- All files use **UTF-8** encoding
- Empty pages (all highlights deleted) automatically cleaned up; empty domain directories also removed

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
# Development mode (with HMR for sidebar/popup)
npm run dev

# Type check + build
npm run build

# Run tests
npm run test

# Test watch mode
npm run test:watch
```

### Code Conventions

See [CLAUDE.md](CLAUDE.md) for the full development guide.

**TypeScript:**
- `const` / `let` only (no `var`)
- JSDoc on all functions, classes, and interfaces
- Type annotations on all parameters and return values (no `any`)
- `async/await` only (no callback nesting)
- File names: `snake_case`, classes: `PascalCase`, functions/variables: `camelCase`
- Chrome API calls go through `shared/api.ts`

**Python:**
- PEP 8, 4-space indentation, 88-char line limit
- Google-style docstrings (Args / Returns / Raises)
- Type annotations on all functions (no `Any`)
- Pydantic models for all request/response structures

### Extension Guide

| Task | Steps |
|------|-------|
| **Add highlight color** | 1. Add value to `HighlightColor` in `src/shared/types.ts`<br>2. Add matching enum value in `backend/models.py`<br>3. Add CSS class in `src/styles/highlight.css` |
| **Add API endpoint** | 1. Add route in `backend/server.py`<br>2. Add client method in `src/shared/api.ts`<br>3. Add message type in `src/shared/types.ts`<br>4. Add case in `src/background/index.ts` |
| **Add sidebar panel** | 1. Create component file in `src/sidebar/`<br>2. Register in `src/sidebar/index.ts`<br>3. Add tab and panel in `src/sidebar/index.html` |
| **Change port** | 1. Edit `config.json`<br>2. Update `host_permissions` in `manifest.json`<br>3. Restart backend + `npm run build` |
| **Regenerate icons** | `cd scripts && python generate_icons.py` |

## FAQ

### Right-click menu not showing?

1. Verify the backend is running: `curl http://127.0.0.1:2463/api/health`
2. Check the extension is loaded and enabled: `chrome://extensions/`
3. The context menu only appears when **text is selected** and won't work on `chrome://` or `chrome-extension://` pages

### Highlights disappear after refresh?

Possible causes:
1. Backend is not running — highlights are loaded from the backend on each page visit
2. The page content changed significantly — all three recovery tiers failed, highlights are marked as broken (visible in sidebar)
3. Check the browser console (F12 → Console) and backend logs (`logs/` directory)

### Cross-device sync not working?

1. Verify all devices have `NOTE_STORAGE_PATH` in `.env` pointing to the same cloud drive directory
2. Ensure the cloud drive client (OneDrive, etc.) is running and synced
3. This project does not do network sync — it relies entirely on the cloud drive's file sync

### How to change the port?

1. Edit `config.json` with the new port
2. Edit `manifest.json`, add the new port to `host_permissions`
3. Restart backend: `systemctl restart note-sync` (or re-run `./backend/run.sh`)
4. Rebuild extension: `npm run build`
5. Refresh the extension at `chrome://extensions/`

### Backend fails with "ModuleNotFoundError: No module named 'backend'"?

Make sure you're running from the **project root**:

```bash
cd /path/to/note
python -m backend.server
```

Don't `cd` into the `backend/` directory first.

## License

MIT License
