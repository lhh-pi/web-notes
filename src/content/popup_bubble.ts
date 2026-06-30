/**
 * Popup bubble that appears when clicking a highlighted `<mark>`.
 *
 * Features:
 * - Auto-save on input (800ms debounce) and on close
 * - Edit / Preview tab switching with Markdown rendering
 * - Delete confirmation to prevent accidental data loss
 */

import { marked } from 'marked';
import type { Highlight, HighlightColor } from '../shared/types';
import { removeHighlight } from './highlighter';

/** The currently visible bubble element (only one at a time). */
let currentBubble: HTMLElement | null = null;

/** Debounce timer for auto-save. */
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Callbacks set by the content script entry point. */
let callbacks: BubbleCallbacks | null = null;

export interface BubbleCallbacks {
  onSave: (highlightId: string, note: string) => void;
  onDelete: (highlightId: string) => void;
  onColorChange: (highlightId: string, color: HighlightColor) => void;
}

/** Register callbacks so the bubble can communicate back to the host. */
export function setBubbleCallbacks(cb: BubbleCallbacks): void {
  callbacks = cb;
}

/**
 * Show the popup bubble next to a highlight mark element.
 */
export function showBubble(highlight: Highlight, mark: HTMLElement): void {
  // Flush any pending auto-save from the previous bubble
  flushAutoSave();

  // Remove any existing bubble
  hideBubble();

  const bubble = createBubble(highlight);
  document.body.appendChild(bubble);
  currentBubble = bubble;

  // Position the bubble near the mark
  positionBubble(bubble, mark);

}

/** Hide and remove the current bubble from the DOM. */
export function hideBubble(): void {
  flushAutoSave();
  if (currentBubble) {
    currentBubble.remove();
    currentBubble = null;
  }
}

// ── Auto-save ─────────────────────────────────────────────────────────

/** Persist the textarea content after a short idle period. */
function scheduleAutoSave(highlightId: string, textarea: HTMLTextAreaElement): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    if (callbacks) callbacks.onSave(highlightId, textarea.value.trim());
  }, 800);
}

/** Immediately persist any pending auto-save. */
function flushAutoSave(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    // The timer callback won't fire, so save manually.
    if (currentBubble) {
      const textarea = currentBubble.querySelector('.wn-bubble-textarea') as HTMLTextAreaElement | null;
      const highlightId = currentBubble.dataset.highlightId;
      if (textarea && highlightId && callbacks) {
        callbacks.onSave(highlightId, textarea.value.trim());
      }
    }
  }
}

// ── Bubble creation ───────────────────────────────────────────────────

function createBubble(highlight: Highlight): HTMLElement {
  const bubble = document.createElement('div');
  bubble.className = 'wn-bubble';
  bubble.dataset.highlightId = highlight.id;

  // ── Header: color swatches + delete button ──
  const header = document.createElement('div');
  header.className = 'wn-bubble-header';

  // Color swatches
  const colors: HighlightColor[] = ['yellow', 'green', 'blue', 'red'];
  const swatchGroup = document.createElement('div');
  swatchGroup.className = 'wn-bubble-colors';
  for (const c of colors) {
    const swatch = document.createElement('span');
    swatch.className = `wn-bubble-swatch wn-bubble-swatch--${c}`;
    if (c === highlight.color) {
      swatch.classList.add('wn-bubble-swatch--active');
    }
    swatch.title = c;
    swatch.addEventListener('click', () => {
      // Update active swatch visual immediately
      swatchGroup.querySelectorAll('.wn-bubble-swatch').forEach((s) => {
        s.classList.remove('wn-bubble-swatch--active');
      });
      swatch.classList.add('wn-bubble-swatch--active');
      // Persist the color change without closing the bubble
      if (callbacks) callbacks.onColorChange(highlight.id, c);
    });
    swatchGroup.appendChild(swatch);
  }
  header.appendChild(swatchGroup);

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'wn-bubble-delete';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => {
    showDeleteConfirm(bubble, highlight);
  });
  header.appendChild(delBtn);

  bubble.appendChild(header);

  // ── Body: Edit / Preview tabs ──
  const body = document.createElement('div');
  body.className = 'wn-bubble-body';

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.className = 'wn-bubble-tabs';

  const editTab = document.createElement('button');
  editTab.className = 'wn-bubble-tab wn-bubble-tab--active';
  editTab.textContent = 'Edit';
  editTab.dataset.tab = 'edit';

  const previewTab = document.createElement('button');
  previewTab.className = 'wn-bubble-tab';
  previewTab.textContent = 'Preview';
  previewTab.dataset.tab = 'preview';

  tabBar.appendChild(editTab);
  tabBar.appendChild(previewTab);
  body.appendChild(tabBar);

  // Edit panel (textarea)
  const editPanel = document.createElement('div');
  editPanel.className = 'wn-bubble-panel wn-bubble-panel--edit';

  const textarea = document.createElement('textarea');
  textarea.className = 'wn-bubble-textarea';
  textarea.placeholder = 'Add a note (Markdown supported)...';
  textarea.value = highlight.note || '';
  textarea.rows = 3;
  textarea.addEventListener('input', () => {
    scheduleAutoSave(highlight.id, textarea);
  });
  editPanel.appendChild(textarea);
  body.appendChild(editPanel);

  // Preview panel (rendered Markdown)
  const previewPanel = document.createElement('div');
  previewPanel.className = 'wn-bubble-panel wn-bubble-panel--preview';
  previewPanel.style.display = 'none';
  const previewContent = document.createElement('div');
  previewContent.className = 'wn-bubble-preview';
  previewPanel.appendChild(previewContent);
  body.appendChild(previewPanel);

  // Tab switching
  editTab.addEventListener('click', () => switchTab(body, 'edit'));
  previewTab.addEventListener('click', () => switchTab(body, 'preview'));

  // Save & close button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'wn-bubble-save';
  saveBtn.textContent = 'Save & Close';
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    flushAutoSave();
    hideBubble();
  });
  body.appendChild(saveBtn);

  bubble.appendChild(body);

  // Focus the textarea after the bubble is in the DOM
  setTimeout(() => textarea.focus(), 50);

  return bubble;
}

// ── Tab switching ──────────────────────────────────────────────────────

function switchTab(body: HTMLElement, tab: string): void {
  const editPanel = body.querySelector('.wn-bubble-panel--edit') as HTMLElement | null;
  const previewPanel = body.querySelector('.wn-bubble-panel--preview') as HTMLElement | null;
  const editTab = body.querySelector('[data-tab="edit"]') as HTMLElement | null;
  const previewTab = body.querySelector('[data-tab="preview"]') as HTMLElement | null;
  const textarea = body.querySelector('.wn-bubble-textarea') as HTMLTextAreaElement | null;
  const bubble = body.parentElement as HTMLElement | null;

  if (!editPanel || !previewPanel) return;

  if (tab === 'preview') {
    // Lock bubble to its current rendered width before hiding the textarea
    if (bubble) {
      bubble.style.width = bubble.offsetWidth + 'px';
    }
    // Save any pending edits before rendering preview
    flushAutoSave();
    const md = textarea?.value || '';
    const previewContent = previewPanel.querySelector('.wn-bubble-preview');
    if (previewContent) {
  previewContent.innerHTML = marked.parse(md, { breaks: true }) as string;
    enableCheckboxes(previewContent, body);
    }
    editPanel.style.display = 'none';
    previewPanel.style.display = '';
    editTab?.classList.remove('wn-bubble-tab--active');
    previewTab?.classList.add('wn-bubble-tab--active');
  } else {
    // Release fixed width so textarea can be resized again
    if (bubble) {
      bubble.style.width = '';
    }
    previewPanel.style.display = 'none';
    editPanel.style.display = '';
    editTab?.classList.add('wn-bubble-tab--active');
    previewTab?.classList.remove('wn-bubble-tab--active');
    textarea?.focus();
  }
}

/**
 * Make rendered checkboxes interactive and tag them with line indices
 * so clicks can directly map back to the markdown source lines.
 */
function enableCheckboxes(container: Element, body: HTMLElement): void {
  const bubble = body.parentElement;
  if (!bubble || !bubble.classList.contains('wn-bubble')) return;
  const highlightId = bubble.dataset.highlightId;
  if (!highlightId) return;

  const textarea = body.querySelector('.wn-bubble-textarea') as HTMLTextAreaElement | null;
  if (!textarea) return;
  const lines = textarea.value.split('\n');

  // Build a map from checkbox line index to the actual line number.
  // marked renders task list lines sequentially, so we match them against
  // lines that contain `- [ ]` or `- [x]`.
  const taskLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/\[[ x]\]/.test(lines[i])) {
      taskLineIndices.push(i);
    }
  }

  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach((cb, idx) => {
    const input = cb as HTMLInputElement;
    input.disabled = false;

    const lineIdx = taskLineIndices[idx];
    if (lineIdx === undefined) return;

    input.addEventListener('click', (e) => {
      e.preventDefault();
      const newChecked = !input.checked;
      input.checked = newChecked;

      // Toggle the corresponding markdown line
      lines[lineIdx] = newChecked
        ? lines[lineIdx].replace(/\[ \]/, '[x]')
        : lines[lineIdx].replace(/\[x\]/, '[ ]');
      textarea.value = lines.join('\n');
      scheduleAutoSave(highlightId, textarea);

      // Re-render preview with updated markdown
      const preview = body.querySelector('.wn-bubble-preview') as HTMLElement | null;
      if (preview) {
        preview.innerHTML = marked.parse(textarea.value, { breaks: true }) as string;
        enableCheckboxes(preview, body);
      }
    });
  });
}

// ── Delete confirmation ───────────────────────────────────────────────

function showDeleteConfirm(bubble: HTMLElement, highlight: Highlight): void {
  // Flush any pending save before showing confirmation
  flushAutoSave();

  // Replace the body content with confirmation UI
  const body = bubble.querySelector('.wn-bubble-body');
  if (!body) return;

  body.innerHTML = '';

  const message = document.createElement('p');
  message.className = 'wn-bubble-confirm-msg';
  message.textContent = 'Delete this highlight and its note? This cannot be undone.';
  body.appendChild(message);

  const actions = document.createElement('div');
  actions.className = 'wn-bubble-confirm-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'wn-bubble-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideBubble();
  });
  actions.appendChild(cancelBtn);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'wn-bubble-confirm-delete';
  confirmBtn.textContent = 'Delete';
  confirmBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (callbacks) callbacks.onDelete(highlight.id);
    removeHighlight(highlight.id);
    hideBubble();
  });
  actions.appendChild(confirmBtn);

  body.appendChild(actions);
}

// ── Positioning ───────────────────────────────────────────────────────

function positionBubble(bubble: HTMLElement, mark: HTMLElement): void {
  const markRect = mark.getBoundingClientRect();
  const bubbleHeight = 200;

  let top = markRect.bottom + window.scrollY + 6;
  let left = markRect.left + window.scrollX;

  // If bubble would go below viewport, show above the mark
  if (markRect.bottom + bubbleHeight > window.innerHeight) {
    top = markRect.top + window.scrollY - bubbleHeight - 6;
  }

  // Clamp horizontal position
  const bubbleWidth = 320;
  if (left + bubbleWidth > window.innerWidth) {
    left = window.innerWidth - bubbleWidth - 12;
  }
  if (left < 12) left = 12;

  bubble.style.position = 'absolute';
  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
}
