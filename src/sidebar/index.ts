/**
 * Sidebar entry point.
 *
 * 管理侧边面板 UI：标签切换、页面笔记、全局列表、搜索、同步控制。
 * 直接调用 db.ts（IndexedDB）和 sync.ts（文件同步），无需 Python 后端。
 */

import type { BackgroundMessage } from '../shared/types';
import type { PageSummary } from '../shared/db';
import * as db from '../shared/db';
import * as sync from '../shared/sync';
import { renderNoteList } from './note_list';
import config from '../../config.json';
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
const syncFileName = document.getElementById('sync-file-name')! as HTMLSpanElement;
const exportJsonBtn = document.getElementById('export-json-btn')! as HTMLButtonElement;
const importJsonBtn = document.getElementById('import-json-btn')! as HTMLButtonElement;
const clearDataBtn = document.getElementById('clear-data-btn')! as HTMLButtonElement;

// Sync permission banner
const syncBanner = document.getElementById('sync-banner')!;
const syncBannerGrant = document.getElementById('sync-banner-grant')! as HTMLButtonElement;
const syncBannerManual = document.getElementById('sync-banner-manual')! as HTMLButtonElement;
// ── Sidebar poll timer ─────────────────────────────────────────────────

const SIDEBAR_POLL_SEC = 60;

let sidebarPollTimer: ReturnType<typeof setInterval> | null = null;

function startSidebarPolling(): void {
  stopSidebarPolling();
  sidebarPollTimer = setInterval(() => {
    sync.checkSyncOnStartup().then(() => {
      loadPageNotes();
      loadAllPages();
    });
    // 同时检查权限状态以更新横幅
    updateSyncBanner();
  }, SIDEBAR_POLL_SEC * 1000);
}

function stopSidebarPolling(): void {
  if (sidebarPollTimer) {
    clearInterval(sidebarPollTimer);
    sidebarPollTimer = null;
  }
}

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
    // 直接读 IndexedDB，不走消息中转（更快、更可靠）
    const data = await db.getNotes(url);
    const highlights = data?.highlights || [];
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
  const mode = await sync.getSyncMode();
  syncModeSelect.value = mode;

  const fileName = await sync.getSyncFileName();
  setSyncFileDisplay(mode, fileName);

  updateSyncUI(mode);

  // 如果开启了同步且有文件，合并外部变更（只读）+ auto 模式尝试写入
  if (mode === 'manual' && fileName) {
    // 手动模式：只读合并外部变更，不写入
    try {
      await sync.checkSyncOnStartup();
    } catch { /* 合并失败静默跳过 */ }
  } else if (mode === 'auto' && fileName) {
    // 自动模式：合并 + 写入
    const recovered = await trySyncOrRecover();
    if (!recovered) {
      setSyncStatus(
        '⚠ Sync file access lost. Please re-select the sync file.',
        true,
        true,
      );
    } else {
      setSyncStatus('Synced ✓');
    }
  }
}

/** 根据模式设置文件名的显示。Off 模式下隐藏已有文件名。 */
function setSyncFileDisplay(mode: sync.SyncMode, fileName: string | null): void {
  if (mode === 'off') {
    syncFileName.textContent = '';
    syncFileName.style.display = 'none';
    syncFileBtn.textContent = 'Choose...';
    syncFileBtn.title = 'Enable sync (Auto or Manual) to select a file';
  } else if (fileName) {
    syncFileName.textContent = fileName;
    syncFileName.style.display = '';
    syncFileBtn.textContent = 'Change';
    syncFileBtn.title = `Change sync file (current: ${fileName})`;
  } else {
    syncFileName.textContent = 'No sync file';
    syncFileName.style.display = '';
    syncFileBtn.textContent = 'Choose...';
    syncFileBtn.title = 'Choose sync file location';
  }
}

/** 根据同步模式更新 UI 可见性和状态。 */
function updateSyncUI(mode: sync.SyncMode): void {
  // Sync now 按钮：仅手动模式显示
  syncNowBtn.style.display = mode === 'manual' ? '' : 'none';

  // 选择/更换文件按钮：Off 模式下禁用
  syncFileBtn.disabled = mode === 'off';
}

/** 更新同步状态提示。persistent 为 true 时不自动消失（用于权限丢失等关键错误）。 */
function setSyncStatus(text: string, isError = false, persistent = false): void {
  syncStatus.textContent = text;
  syncStatus.className = isError
    ? 'wn-sync-status wn-sync-error' + (persistent ? ' wn-sync-error--persistent' : '')
    : 'wn-sync-status';
  if (text && !persistent) {
    setTimeout(() => {
      if (syncStatus.textContent === text) {
        syncStatus.textContent = '';
      }
    }, 3000);
  }
}

/**
 * 尝试 syncNow，失败则弹出授权框重试。
 * 成功后自动刷新页面笔记列表。
 * 不修改同步模式。仅 Sidebar 上下文中调用。
 *
 * @returns 同步是否成功
 */
async function trySyncOrRecover(): Promise<boolean> {
  let success = false;
  try {
    await sync.syncNow();
    success = true;
  } catch (err) {
    if (err instanceof sync.SyncPermissionError) {
      const granted = await sync.recoverPermission();
      if (granted) {
        try {
          await sync.syncNow();
          success = true;
        } catch {
          // 恢复后仍失败（文件被删除等）
        }
      }
    }
  }
  if (success) {
    loadPageNotes();
    loadAllPages();
  }
  return success;
}

/**
 * 检测权限状态并更新顶部横幅（仅在 auto 模式下需要）。
 * 权限可用时隐藏横幅，不可用时显示。
 */
async function updateSyncBanner(): Promise<void> {
  const mode = await sync.getSyncMode();
  if (mode !== 'auto') {
    syncBanner.style.display = 'none';
    return;
  }

  const fileName = await sync.getSyncFileName();
  if (!fileName) {
    syncBanner.style.display = 'none';
    return;
  }

  const canWrite = await sync.checkWritePermission();
  syncBanner.style.display = canWrite ? 'none' : '';
}

// Banner: 点击授权
syncBannerGrant.addEventListener('click', async () => {
  syncBannerGrant.disabled = true;
  syncBannerGrant.textContent = 'Authorizing… / 授权中…';
  try {
    const granted = await sync.recoverPermission();
    if (granted) {
      await sync.syncNow();
      syncBanner.style.display = 'none';
      setSyncStatus('Permission granted — sync resumed ✓ / 授权成功 — 同步已恢复');
      // 通知所有标签页关闭遮罩弹窗
      chrome.runtime.sendMessage({ type: 'SYNC_RESOLVED' }).catch(() => {});
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'SYNC_RESOLVED' }).catch(() => {});
        }
      });
    } else {
      setSyncStatus('Permission denied. Please re-select the sync file. / 授权被拒绝，请重新选择同步文件', true, true);
    }
  } catch {
    setSyncStatus('Authorization failed. Please re-select the sync file. / 授权失败，请重新选择同步文件', true, true);
  } finally {
    syncBannerGrant.disabled = false;
    syncBannerGrant.textContent = 'Grant / 授权';
  }
});

// Banner: 切换到手动模式
syncBannerManual.addEventListener('click', async () => {
  await sync.setSyncMode('manual');
  syncModeSelect.value = 'manual';
  setSyncFileDisplay('manual', await sync.getSyncFileName());
  updateSyncUI('manual');
  syncBanner.style.display = 'none';
  setSyncStatus('Switched to manual sync / 已切换为手动同步');
});

syncModeSelect.addEventListener('change', async () => {
  const mode = syncModeSelect.value as sync.SyncMode;
  await sync.setSyncMode(mode);

  if (mode === 'off') {
    // 关闭同步 → 隐藏文件名
    setSyncFileDisplay(mode, null);
    updateSyncUI(mode);
    return;
  }

  // 开启同步模式 → 显示已有文件名（如有），尝试同步
  const fileName = await sync.getSyncFileName();
  setSyncFileDisplay(mode, fileName);
  updateSyncUI(mode);

  const recovered = await trySyncOrRecover();
  if (!recovered) {
    setSyncStatus('Sync failed. Please choose a sync file.', true, true);
  } else {
    setSyncStatus('Synced ✓');
  }
});

syncFileBtn.addEventListener('click', async () => {
  const mode = await sync.getSyncMode();
  if (mode === 'off') return; // Off 模式下按钮已禁用，双重保险

  // 已有文件时弹确认框
  const hasFile = syncFileName.textContent !== 'No sync file' && syncFileName.textContent !== '';
  if (hasFile) {
    const confirmed = confirm(
      `Current sync file:\n${syncFileName.textContent}\n\nChange to a different file? Your data will be written to the new file. The old file will no longer receive updates.`,
    );
    if (!confirmed) return;
  }

  syncFileBtn.disabled = true;
  syncFileBtn.textContent = '...';
  try {
    const name = await sync.selectSyncFile();
    if (name) {
      syncFileName.textContent = name;
      syncFileName.style.display = '';
      syncFileBtn.textContent = 'Change';
      syncFileBtn.title = `Change sync file (current: ${name})`;
      setSyncStatus('Sync file configured ✓');
    }
  } catch (err) {
    setSyncStatus(err instanceof Error ? err.message : 'Failed to select file', true);
  } finally {
    syncFileBtn.disabled = false;
    updateSyncUI(mode);
  }
});

syncNowBtn.addEventListener('click', async () => {
  syncNowBtn.disabled = true;
  syncNowBtn.textContent = 'Syncing...';
  try {
    const recovered = await trySyncOrRecover();
    if (!recovered) {
      setSyncStatus('Sync failed. Please re-select the sync file.', true, true);
    } else {
      setSyncStatus('Synced ✓');
    }
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

// Show/hide Clear Data button per config.json debug flag
if (!config.debug?.showClearButton) {
  clearDataBtn.style.display = 'none';
}

clearDataBtn.addEventListener('click', async () => {
  if (!confirm('Delete ALL notes from IndexedDB? This cannot be undone.')) return;
  if (!confirm('Are you sure? All highlights, notes, sync config, and theme preference will be erased.')) return;

  try {
    await db.clearAll();
    setSyncStatus('All data cleared ✓');
    loadPageNotes();
    loadAllPages();
  } catch (err) {
    setSyncStatus(err instanceof Error ? err.message : 'Clear failed', true);
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

// 立即加载 IndexedDB 中的数据（快速启动）
loadPageNotes();
loadAllPages();

// 检查同步文件并开始轮询
sync.checkSyncOnStartup().then(() => {
  loadPageNotes();
  loadAllPages();
});
updateSyncBanner();
startSidebarPolling();

chrome.tabs.onActivated.addListener(() => {
  loadPageNotes();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    loadPageNotes();
  }
});
