/**
 * Page list component: renders all indexed pages grouped by domain.
 * Domains are collapsed by default; click to expand and see pages.
 */

import type { PageSummary } from '../shared/db';
import * as db from '../shared/db';
import * as sync from '../shared/sync';

/** Track which domains are currently expanded. */
const expandedDomains = new Set<string>();

/**
 * Render the full page list grouped by domain.
 *
 * @param pages - Array of page summaries from IndexedDB.
 * @param container - The DOM element to render into.
 * @param onDelete - Callback invoked after a page or domain is deleted.
 */
export function renderPageList(
  pages: PageSummary[],
  container: HTMLElement,
  onDelete: () => void,
): void {
  container.innerHTML = '';

  if (!pages.length) {
    const empty = document.createElement('div');
    empty.className = 'wn-empty';
    empty.innerHTML = '<p>No pages with notes yet.</p>';
    container.appendChild(empty);
    return;
  }

  // Group by domain
  const grouped = new Map<string, PageSummary[]>();
  for (const p of pages) {
    const entries = grouped.get(p.domain) || [];
    entries.push(p);
    grouped.set(p.domain, entries);
  }

  for (const [domain, entries] of grouped) {
    // Domain group wrapper
    const group = document.createElement('div');
    group.className = 'wn-page-group';

    // Domain header (clickable to expand/collapse)
    const header = document.createElement('div');
    header.className = 'wn-page-group-header';

    const arrow = document.createElement('span');
    arrow.className = 'wn-page-group-arrow';
    arrow.textContent = '▶';
    header.appendChild(arrow);

    const domainName = document.createElement('span');
    domainName.className = 'wn-page-group-domain';
    domainName.textContent = domain;
    header.appendChild(domainName);

    const totalHl = entries.reduce((sum, e) => sum + e.highlightCount, 0);
    const count = document.createElement('span');
    count.className = 'wn-page-group-count';
    count.textContent = `${entries.length} page${entries.length > 1 ? 's' : ''} · ${totalHl} highlight${totalHl !== 1 ? 's' : ''}`;
    header.appendChild(count);

    // Domain-level delete button
    const delDomainBtn = document.createElement('button');
    delDomainBtn.className = 'wn-page-delete-btn';
    delDomainBtn.textContent = '✕';
    delDomainBtn.title = `Delete all notes from ${domain}`;
    delDomainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete ALL notes from "${domain}" (${entries.length} page${entries.length > 1 ? 's' : ''})? This cannot be undone.`)) return;
      Promise.all(entries.map((e) => db.deletePage(e.url)))
        .then(() => sync.maybeSync())
        .then(() => onDelete())
        .catch(() => alert('Failed to delete some pages.'));
    });
    header.appendChild(delDomainBtn);

    header.addEventListener('click', () => {
      const pagesEl = group.querySelector('.wn-page-group-pages') as HTMLElement | null;
      if (!pagesEl) return;
      const expanded = pagesEl.style.display !== 'none';
      if (expanded) {
        pagesEl.style.display = 'none';
        arrow.textContent = '▶';
        expandedDomains.delete(domain);
      } else {
        pagesEl.style.display = '';
        arrow.textContent = '▼';
        expandedDomains.add(domain);
      }
    });

    group.appendChild(header);

    // Pages list — preserve expanded state across re-renders
    const pagesEl = document.createElement('div');
    pagesEl.className = 'wn-page-group-pages';
    const isExpanded = expandedDomains.has(domain);
    pagesEl.style.display = isExpanded ? '' : 'none';
    arrow.textContent = isExpanded ? '▼' : '▶';

    for (const page of entries) {
      const card = createPageCard(page, onDelete);
      pagesEl.appendChild(card);
    }

    group.appendChild(pagesEl);
    container.appendChild(group);
  }
}

/** Create a single page card element. */
function createPageCard(page: PageSummary, onDelete: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'wn-page-card';

  // Left content
  const content = document.createElement('div');
  content.className = 'wn-page-card-content';

  const title = document.createElement('div');
  title.className = 'wn-page-title';
  title.textContent = page.title || '(untitled)';
  content.appendChild(title);

  const urlEl = document.createElement('div');
  urlEl.className = 'wn-page-url-text';
  urlEl.textContent = page.url;
  urlEl.title = page.url;
  content.appendChild(urlEl);

  const meta = document.createElement('div');
  meta.className = 'wn-page-meta';

  const hlCount = document.createElement('span');
  hlCount.className = 'wn-page-hl-count';
  hlCount.textContent = `${page.highlightCount} highlight${page.highlightCount !== 1 ? 's' : ''}`;
  meta.appendChild(hlCount);

  const date = document.createElement('span');
  date.className = 'wn-page-date';
  date.textContent = formatDate(page.updated);
  meta.appendChild(date);

  content.appendChild(meta);
  card.appendChild(content);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'wn-page-card-actions';

  // Open page button
  const openBtn = document.createElement('button');
  openBtn.className = 'wn-page-open-btn';
  openBtn.textContent = 'Open';
  openBtn.title = 'Open in new tab';
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.create({ url: page.url });
  });
  actions.appendChild(openBtn);

  // Delete page button
  const delBtn = document.createElement('button');
  delBtn.className = 'wn-page-delete-btn';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete this page and all its highlights';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`Delete all highlights for this page?\n\n${page.url}\n\nThis cannot be undone.`)) return;
    db.deletePage(page.url)
      .then(() => sync.maybeSync())
      .then(() => onDelete())
      .catch(() => alert('Failed to delete page.'));
  });
  actions.appendChild(delBtn);

  card.appendChild(actions);

  // Click card to open
  card.addEventListener('click', () => {
    chrome.tabs.create({ url: page.url });
  });

  return card;
}

/**
 * Filter pages by title, URL, or domain.
 *
 * @param pages - Full page list.
 * @param query - Search query string.
 * @returns Filtered page list.
 */
export function filterPages(pages: PageSummary[], query: string): PageSummary[] {
  if (!query.trim()) return pages;
  const q = query.toLowerCase().trim();
  return pages.filter(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      p.url.toLowerCase().includes(q) ||
      p.domain.toLowerCase().includes(q),
  );
}

/** Format an ISO 8601 date string for display. */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 10);
  }
}
