/**
 * Sidebar entry point.
 *
 * 管理侧边面板 UI：标签切换、页面笔记、全局列表、搜索、同步控制。
 * 直接调用 db.ts（IndexedDB）和 sync.ts（文件同步），无需 Python 后端。
 */

import type { BackgroundMessage, GetNotesResponse } from '../shared/types';
import type { PageSummary } from '../shared/db';
import * as db from '../shared/db';
import * as sync from '../shared/sync';
import { renderNoteList } from './note_list';
import { renderPageList, filterPages } from './page_list';
import { initSearchPanel } from './search_panel';

// ── DOM references ────────────────────────────────────────────────────

const tabs = document.querySelectorAll<HTMLButtonElement>('.wn-tab');
const panels = {
  page: document.getElementById('panel-page')!,
  all: document.getElementById('panel-all')!,
  search: document.getElementById('panel-search')!,
};
const pageUrlEl = document.querySelector('.wn-page-url')!;
const notesList = document.getElementById('notes-list')!;
const noNotesEl = document.getElementById('no-notes')!;
const pageFilterInput = document.getElementById('page-filter-input') as HTMLInputElement;
const pageList = document.getElementById('page-list')!;
const noPagesEl = document.getElementById('no-pages')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchResults = document.getElementById('search-results')!;
const noResultsEl = document.getElementById('no-results')!;
const themeToggle = document.getElementById('theme-toggle')!;

// Sync controls
const syncModeSelect = document.getElementById('sync-mode-select') as HTMLSelectElement;
const syncFileBtn = document.getElementById('sync-file-btn')! as HTMLButtonElement;
const syncNowBtn = document.getElementById('sync-now-btn')! as HTMLButtonElement;
const syncStatus = document.getElementById('sync-status')! as HTMLSpanElement;
const exportJsonBtn = document.getElementById('export-json-btn')! as HTMLButtonElement;
const importJsonBtn = document.getElementById('import-json-btn')! as HTMLButtonElement;

// ── Cached page data ──────────────────────────────────────────────────

let allPages: PageSummary[] = [];
let brokenIds: Set<string> = new Set();

// ── Tab switching ─────────────────────────────────────────────────────

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    if (!target) return;

    tabs.forEach((t) => t.classList.remove('wn-tab--active'));
    tab.classList.add('wn-tab--active');

    Object.entries(panels).forEach(([key, panel]) => {
      panel.classList.toggle('wn-panel--active', key === target);
    });

    if (target === 'search') {
      searchInput.focus();
    }

    if (target === 'all') {
      loadAllPages();
    }
  });
});

// ── Theme toggle ──────────────────────────────────────────────────────

let darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
applyTheme();

themeToggle.addEventListener('click', () => {
  darkMode = !darkMode;
  applyTheme();
  chrome.storage.local.set({ darkMode });
});

chrome.storage.local.get('darkMode', (result) => {
  if (result.darkMode !== undefined) {
    darkMode = result.darkMode;
    applyTheme();
  }
});

function applyTheme(): void {
  document.body.classList.toggle('wn-dark', darkMode);
  themeToggle.textContent = darkMode ? '☀' : '☽';
}

// ── Load page notes ───────────────────────────────────────────────────

async function loadPageNotes(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url;
  if (!url) {
    pageUrlEl.textContent = 'No active page';
    return;
  }

  pageUrlEl.textContent = url;

  try {
    const response = await new Promise<{ data?: GetNotesResponse }>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'GET_NOTES', url },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve((res as { data?: GetNotesResponse }) || {});
          }
        },
      );
    });

    const highlights = response?.data?.highlights || [];
    if (highlights.length === 0) {
      notesList.innerHTML = '';
      noNotesEl.style.display = 'block';
    } else {
      noNotesEl.style.display = 'none';
      renderNoteList(highlights, notesList, brokenIds.size > 0 ? brokenIds : undefined);
    }
  } catch (err) {
    pageUrlEl.textContent = `Error loading notes: ${err instanceof Error ? err.message : 'Unknown'}`;
    notesList.innerHTML = '';
    noNotesEl.style.display = 'block';
  }
}

// ── All pages ─────────────────────────────────────────────────────────

async function loadAllPages(): Promise<void> {
  try {
    allPages = await db.listPages();
    renderFilteredPages();
  } catch {
    pageList.innerHTML = '<p class="wn-error">Failed to load pages.</p>';
  }
}

function renderFilteredPages(): void {
  const query = pageFilterInput.value.trim();
  const filtered = filterPages(allPages, query);
  if (filtered.length === 0) {
    pageList.innerHTML = '';
    noPagesEl.style.display = 'block';
  } else {
    noPagesEl.style.display = 'none';
    renderPageList(filtered, pageList, loadAllPages);
  }
}

pageFilterInput.addEventListener('input', () => {
  if (!allPages.length) return;
  renderFilteredPages();
});

// ── Sync controls ─────────────────────────────────────────────────────

/** 初始化同步 UI：恢复保存的模式和文件状态。 */
async function initSyncUI(): Promise<void> {
  // 恢复同步模式
  const mode = await sync.getSyncMode();
  syncModeSelect.value = mode;
  updateSyncUI(mode);

  // 恢复同步文件状态
  const fileName = await sync.getSyncFileName();
  if (fileName) {
    syncFileBtn.textContent = fileName;
    syncFileBtn.title = `Sync file: ${fileName}`;
  }
}

/** 根据同步模式更新 UI 可见性。 */
function updateSyncUI(mode: sync.SyncMode): void {
  syncNowBtn.style.display = mode === 'manual' ? '' : 'none';
}

/** 更新同步状态提示。 */
function setSyncStatus(text: string, isError = false): void {
  syncStatus.textContent = text;
  syncStatus.className = isError ? 'wn-sync-status wn-sync-error' : 'wn-sync-status';
  if (text) {
    setTimeout(() => {
      if (syncStatus.textContent === text) {
        syncStatus.textContent = '';
      }
    }, 3000);
  }
}

syncModeSelect.addEventListener('change', async () => {
  const mode = syncModeSelect.value as sync.SyncMode;
  await sync.setSyncMode(mode);
  updateSyncUI(mode);

  if (mode === 'auto') {
    // 切换到自动模式时立即同步一次
    try {
      await sync.syncNow();
      setSyncStatus('Synced ✓');
    } catch {
      setSyncStatus('Sync failed — select a file first', true);
    }
  }
});

syncFileBtn.addEventListener('click', async () => {
  syncFileBtn.disabled = true;
  syncFileBtn.textContent = '...';
  try {
    const name = await sync.selectSyncFile();
    if (name) {
      syncFileBtn.textContent = name;
      syncFileBtn.title = `Sync file: ${name}`;
      setSyncStatus('Sync file configured ✓');
    } else {
      syncFileBtn.textContent = 'Choose file...';
    }
  } catch (err) {
    setSyncStatus(err instanceof Error ? err.message : 'Failed to select file', true);
    syncFileBtn.textContent = 'Choose file...';
  } finally {
    syncFileBtn.disabled = false;
  }
});

syncNowBtn.addEventListener('click', async () => {
  syncNowBtn.disabled = true;
  syncNowBtn.textContent = 'Syncing...';
  try {
    await sync.syncNow();
    setSyncStatus('Synced ✓');
  } catch (err) {
    setSyncStatus(err instanceof Error ? err.message : 'Sync failed', true);
  } finally {
    syncNowBtn.disabled = false;
    syncNowBtn.textContent = '↻ Sync now';
  }
});

exportJsonBtn.addEventListener('click', async () => {
  exportJsonBtn.disabled = true;
  exportJsonBtn.textContent = 'Exporting...';
  try {
    await sync.exportToFile();
    setSyncStatus('Exported ✓');
  } catch (err) {
    setSyncStatus(err instanceof Error ? err.message : 'Export failed', true);
  } finally {
    exportJsonBtn.disabled = false;
    exportJsonBtn.textContent = '↓ Export JSON';
  }
});

importJsonBtn.addEventListener('click', async () => {
  importJsonBtn.disabled = true;
  importJsonBtn.textContent = 'Importing...';
  try {
    const result = await sync.importFromFile();
    if (result) {
      setSyncStatus(`Imported ${result.imported}, skipped ${result.skipped} ✓`);
      loadAllPages();
      loadPageNotes();
    }
  } catch (err) {
    setSyncStatus(err instanceof Error ? err.message : 'Import failed', true);
  } finally {
    importJsonBtn.disabled = false;
    importJsonBtn.textContent = '↑ Import JSON';
  }
});

// ── Listen for messages from background ───────────────────────────────

chrome.runtime.onMessage.addListener((message: BackgroundMessage | { type: string }) => {
  if (message.type === 'BROKEN_HIGHLIGHTS') {
    const msg = message as { type: string; url: string; brokenIds: string[] };
    brokenIds = new Set(msg.brokenIds);
    loadPageNotes();
    return;
  }
  if (
    message.type === 'REFRESH_NOTES' ||
    message.type === 'HIGHLIGHT_SAVED' ||
    message.type === 'HIGHLIGHT_DELETED'
  ) {
    loadPageNotes();
    loadAllPages();
  }
});

// ── Initialize ────────────────────────────────────────────────────────

initSearchPanel(searchInput, searchResults, noResultsEl);
initSyncUI();
loadPageNotes();
loadAllPages();

chrome.tabs.onActivated.addListener(() => {
  loadPageNotes();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    loadPageNotes();
  }
});
