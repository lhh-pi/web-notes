/**
 * Sidebar entry point.
 *
 * Manages the side panel UI: tab switching, page notes, search, export.
 * Communicates with the background worker and Python backend via chrome.runtime.
 */

import type {
  BackgroundMessage,
  GetNotesResponse,
  PageEntry,
} from '../shared/types';
import * as api from '../shared/api';
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
const exportBtn = document.getElementById('export-btn')! as HTMLButtonElement;
const themeToggle = document.getElementById('theme-toggle')!;

// ── Cached page data ──────────────────────────────────────────────────

let allPages: PageEntry[] = [];
let brokenIds: Set<string> = new Set();

// ── Tab switching ─────────────────────────────────────────────────────

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    if (!target) return;

    // Update tab active states
    tabs.forEach((t) => t.classList.remove('wn-tab--active'));
    tab.classList.add('wn-tab--active');

    // Update panel visibility
    Object.entries(panels).forEach(([key, panel]) => {
      panel.classList.toggle('wn-panel--active', key === target);
    });

    // Focus search input when switching to search tab
    if (target === 'search') {
      searchInput.focus();
    }

    // Load all pages when switching to All Notes tab
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
  // Persist preference
  chrome.storage.local.set({ darkMode });
});

// Restore saved preference
chrome.storage.local.get('darkMode', (result) => {
  if (result.darkMode !== undefined) {
    darkMode = result.darkMode;
    applyTheme();
  }
});

function applyTheme(): void {
  document.body.classList.toggle('wn-dark', darkMode);
  themeToggle.textContent = darkMode ? '☀' : '☽'; // Sun / Moon
}

// ── Load page notes ───────────────────────────────────────────────────

async function loadPageNotes(): Promise<void> {
  // Get the active tab URL
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
            // Background wraps the response: { type: 'NOTES_LOADED', data: PageNote }
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

// ── Export ────────────────────────────────────────────────────────────

exportBtn.addEventListener('click', async () => {
  exportBtn.textContent = 'Exporting...';
  exportBtn.disabled = true;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const domain = tabs[0]?.url ? new URL(tabs[0].url).hostname : '';

    // Get export from background
    const markdown = await new Promise<string>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'EXPORT', domain },
        (res: string) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        },
      );
    });

    // Download the file
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `notes-${domain || 'all'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('[Web Notes] Export failed:', err);
  } finally {
    exportBtn.textContent = 'Export Notes';
    exportBtn.disabled = false;
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
  if (message.type === 'REFRESH_NOTES' || message.type === 'HIGHLIGHT_SAVED' || message.type === 'HIGHLIGHT_DELETED') {
    loadPageNotes();
    loadAllPages();
  }
});

// ── All pages ───────────────────────────────────────────────────────────

async function loadAllPages(): Promise<void> {
  try {
    const response = await api.listPages();
    allPages = response.pages || [];
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

// ── Initialize ────────────────────────────────────────────────────────

// Initialize search panel
initSearchPanel(searchInput, searchResults, noResultsEl);

// Load notes for the current page
loadPageNotes();

// Preload all pages in background
loadAllPages();

// Refresh notes when the active tab changes
chrome.tabs.onActivated.addListener(() => {
  loadPageNotes();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    loadPageNotes();
  }
});
