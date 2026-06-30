/**
 * Search panel component: full-text search across all notes.
 */

import type { SearchResult } from '../shared/types';
import * as db from '../shared/db';

/** Debounce timer for search-as-you-type. */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 300;

/**
 * Initialize the search panel with event listeners.
 *
 * @param inputEl - The search input element.
 * @param resultsContainer - The container for search results.
 * @param emptyEl - The "no results" element.
 */
export function initSearchPanel(
  inputEl: HTMLInputElement,
  resultsContainer: HTMLElement,
  emptyEl: HTMLElement,
): void {
  inputEl.addEventListener('input', () => {
    const query = inputEl.value.trim();

    if (debounceTimer) clearTimeout(debounceTimer);

    if (!query) {
      resultsContainer.innerHTML = '';
      emptyEl.style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(() => {
      performSearch(query, resultsContainer, emptyEl);
    }, DEBOUNCE_MS);
  });

  // Also search on Enter
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (debounceTimer) clearTimeout(debounceTimer);
      const query = inputEl.value.trim();
      if (query) {
        performSearch(query, resultsContainer, emptyEl);
      }
    }
  });
}

/** Execute a search and render results. */
async function performSearch(
  query: string,
  container: HTMLElement,
  emptyEl: HTMLElement,
): Promise<void> {
  try {
    const results = await db.searchNotes(query);
    renderSearchResults(results, container, emptyEl);
  } catch (err) {
    container.innerHTML = `<p class="wn-error">Search failed: ${err instanceof Error ? err.message : 'Unknown error'}</p>`;
    emptyEl.style.display = 'none';
  }
}

/** Render search result cards into the container. */
function renderSearchResults(
  results: SearchResult[],
  container: HTMLElement,
  emptyEl: HTMLElement,
): void {
  container.innerHTML = '';

  if (!results.length) {
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

  for (const r of results) {
    const card = document.createElement('div');
    card.className = 'wn-search-card';

    // Title and domain
    const header = document.createElement('div');
    header.className = 'wn-search-header';

    const title = document.createElement('span');
    title.className = 'wn-search-title';
    title.textContent = r.title || 'Untitled';
    header.appendChild(title);

    const domain = document.createElement('span');
    domain.className = 'wn-search-domain';
    domain.textContent = r.domain;
    header.appendChild(domain);

    card.appendChild(header);

    // Matched text snippet
    const snippet = document.createElement('p');
    snippet.className = 'wn-search-snippet';
    snippet.textContent = r.context || r.match_text;
    card.appendChild(snippet);

    // Note preview (if present)
    if (r.note) {
      const note = document.createElement('p');
      note.className = 'wn-search-note';
      note.textContent = r.note.slice(0, 150) + (r.note.length > 150 ? '...' : '');
      card.appendChild(note);
    }

    // Click to open the page
    card.addEventListener('click', () => {
      chrome.tabs.create({ url: r.url });
    });
    card.style.cursor = 'pointer';
    card.title = `Open ${r.url}`;

    container.appendChild(card);
  }
}
