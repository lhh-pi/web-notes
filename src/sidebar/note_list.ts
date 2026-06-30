/**
 * Note list component: renders highlights for the current page in the sidebar.
 */

import type { Highlight } from '../shared/types';

/**
 * Render the list of highlights for the current page.
 *
 * @param highlights - Array of Highlight objects.
 * @param container - The DOM element to render into.
 * @param brokenIds - Set of highlight IDs that could not be located on the page.
 */
export function renderNoteList(
  highlights: Highlight[],
  container: HTMLElement,
  brokenIds?: Set<string>,
): void {
  container.innerHTML = '';

  if (!highlights.length) {
    return;
  }

  for (const h of highlights) {
    const broken = brokenIds?.has(h.id) ?? false;

    const card = document.createElement('div');
    card.className = 'wn-note-card' + (broken ? ' wn-note-card--broken' : '');
    card.dataset.highlightId = h.id;

    // Color indicator strip
    const strip = document.createElement('div');
    strip.className = `wn-note-strip wn-note-strip--${broken ? 'broken' : h.color}`;
    card.appendChild(strip);

    // Content
    const content = document.createElement('div');
    content.className = 'wn-note-content';

    // Highlighted text (truncated to 20 chars)
    const quote = document.createElement('blockquote');
    quote.className = 'wn-note-quote';
    quote.textContent = h.text.length > 20 ? h.text.slice(0, 20) + '...' : h.text;
    quote.title = h.text;
    content.appendChild(quote);

    // Broken badge
    if (broken) {
      const badge = document.createElement('span');
      badge.className = 'wn-note-broken-badge';
      badge.textContent = 'Page changed — highlight lost';
      content.appendChild(badge);
    }

    // Note (if present)
    if (h.note && h.note.trim()) {
      const note = document.createElement('div');
      note.className = 'wn-note-text';
      note.textContent = h.note;
      content.appendChild(note);
    } else if (!broken) {
      const emptyNote = document.createElement('div');
      emptyNote.className = 'wn-note-text wn-note-text--empty';
      emptyNote.textContent = 'No note — click highlight on page to add one';
      content.appendChild(emptyNote);
    }

    // Timestamp
    const time = document.createElement('time');
    time.className = 'wn-note-time';
    time.textContent = formatDate(h.created);
    content.appendChild(time);

    // Scroll-to-highlight button
    if (!broken) {
      const scrollBtn = document.createElement('button');
      scrollBtn.className = 'wn-btn wn-btn--small';
      scrollBtn.textContent = 'Go to highlight';
      scrollBtn.addEventListener('click', () => {
        scrollToHighlight(h.id);
      });
      content.appendChild(scrollBtn);
    }

    card.appendChild(content);
    container.appendChild(card);
  }
}

/**
 * Scroll the current page to the highlight mark element.
 *
 * Sends a message to the content script to focus and scroll to the mark.
 */
function scrollToHighlight(highlightId: string): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      // Use chrome.scripting to execute a scroll in the page
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: (id: string) => {
          const mark = document.querySelector(
            `mark.wn-highlight[data-highlight-id="${id}"]`,
          );
          if (mark) {
            mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Brief flash animation
            mark.classList.add('wn-flash');
            setTimeout(() => mark.classList.remove('wn-flash'), 1500);
          }
        },
        args: [highlightId],
      }).catch(console.warn);
    }
  });
}

/**
 * Format an ISO 8601 date string for display.
 */
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
