/**
 * Content script entry point.
 *
 * Injected into every web page. Handles: right-click context menu actions,
 * highlight rendering, popup bubble lifecycle, and page-load restoration.
 */

import { computeAnchor } from './anchor';
import {
  applyAllHighlights,
  highlightSelection,
  removeHighlight,
  updateMarkData,
} from './highlighter';
import { hideBubble, setBubbleCallbacks, showBubble } from './popup_bubble';
import type { ContentMessage, HighlightColor } from '../shared/types';

// ── State ─────────────────────────────────────────────────────────────

let pendingNoteBubble = false;

// ── Bubble callbacks ──────────────────────────────────────────────────

setBubbleCallbacks({
  onSave(highlightId: string, note: string) {
    // Update ALL marks (cross-boundary creates multiple)
    document.querySelectorAll(`mark.wn-highlight[data-highlight-id="${highlightId}"]`).forEach((mark) => {
      const m = mark as HTMLElement;
      m.dataset.hasNote = note ? '1' : '0';
      const ext = m as HTMLElement & { _wnHighlight?: { note: string } };
      if (ext._wnHighlight) ext._wnHighlight.note = note;
    });
    sendToBackground({
      type: 'UPDATE_HIGHLIGHT',
      url: window.location.href,
      highlightId,
      note,
    });
  },
  onDelete(highlightId: string) {
    removeHighlight(highlightId);
    hideBubble();
    sendToBackground({
      type: 'DELETE_HIGHLIGHT',
      url: window.location.href,
      highlightId,
    });
  },
  onColorChange(highlightId: string, color: HighlightColor) {
    // Update ALL marks immediately
    document.querySelectorAll(`mark.wn-highlight[data-highlight-id="${highlightId}"]`).forEach((mark) => {
      const m = mark as HTMLElement;
      m.className = m.className.replace(/wn-highlight--\w+/g, `wn-highlight--${color}`);
      const ext = m as HTMLElement & { _wnHighlight?: { color: string } };
      if (ext._wnHighlight) ext._wnHighlight.color = color;
    });
    sendToBackground({
      type: 'UPDATE_HIGHLIGHT',
      url: window.location.href,
      highlightId,
      color,
    });
  },
});

// ── Incoming messages (from background via tabs.sendMessage) ──────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Context menu actions
  if (message.action === 'highlight') {
    handleHighlight((message.color as HighlightColor) || 'yellow');
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === 'highlight_note') {
    pendingNoteBubble = true;
    handleHighlight('yellow');
    sendResponse({ ok: true });
    return true;
  }

  // Direct messages from background (NOTES_LOADED, ERROR, etc.)
  const msg = message as Record<string, unknown>;
  switch (msg.type) {
    case 'NOTES_LOADED': {
      const highlights = (msg.data as { highlights?: [] })?.highlights || [];
      applyAllHighlights(highlights as []);
      sendResponse({ ok: true });
      break;
    }
    case 'HIGHLIGHT_DELETED':
      removeHighlight(msg.highlightId as string);
      hideBubble();
      break;
    case 'ERROR':
      console.error('[Web Notes]', msg.message);
      break;
  }
  return true;
});

// ── Highlight handler ─────────────────────────────────────────────────

function handleHighlight(color: HighlightColor): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);

  // CRITICAL: compute anchor BEFORE the DOM is modified
  const anchor = computeAnchor();
  if (!anchor) return;

  // Apply visual highlight (modifies DOM, clears selection)
  const mark = highlightSelection(range, color, anchor);
  if (!mark) return;

  // Get the temp ID used for all marks in this selection
  const tempId = mark.dataset.highlightId || '';

  // Persist to backend — handle the response to update ALL marks
  sendToBackground(
    { type: 'CREATE_HIGHLIGHT', payload: {
      url: window.location.href,
      title: document.title,
      domain: window.location.hostname,
      text: anchor.text,
      color,
      note: '',
      anchor,
    }},
    (response) => {
      const res = response as { type?: string; data?: { highlights?: Array<{ id: string; note: string }> } };
      if (res.type !== 'HIGHLIGHT_SAVED' || !res.data?.highlights?.length) return;

      const last = res.data.highlights[res.data.highlights.length - 1];

      // Update ALL marks with the temp ID (cross-boundary creates multiple)
      const allMarks = document.querySelectorAll(
        `mark.wn-highlight[data-highlight-id="${tempId}"]`,
      );
      allMarks.forEach((m) => updateMarkData(m as HTMLElement, last.id, last.note));

      // If no marks were found by temp ID, update the returned mark
      if (allMarks.length === 0 && mark) {
        updateMarkData(mark, last.id, last.note);
      }

      // Show note bubble if the user chose "Highlight & Add Note"
      if (pendingNoteBubble) {
        pendingNoteBubble = false;
        const updatedMark = document.querySelector(
          `mark.wn-highlight[data-highlight-id="${last.id}"]`,
        ) as HTMLElement | null;
        if (updatedMark) {
          const ext = updatedMark as HTMLElement & {
            _wnHighlight?: { id: string; text: string; color: string; note: string; anchor: unknown; created: string };
          };
          if (ext._wnHighlight) {
            ext._wnHighlight.id = last.id;
            setTimeout(() => showBubble(ext._wnHighlight as Parameters<typeof showBubble>[0], updatedMark), 150);
          }
        }
      }
    },
  );
}

// ── Page load: restore highlights ─────────────────────────────────────

function loadNotes(): void {
  const url = window.location.href;
  console.log('[Web Notes] Loading notes for:', url);
  sendToBackground({ type: 'GET_NOTES', url }, (response) => {
    const res = response as { type?: string; data?: { highlights?: unknown[]; url?: string } };
    console.log('[Web Notes] loadNotes response:', res.type, 'highlights:', res.data?.highlights?.length || 0);
    if (res.type === 'NOTES_LOADED' && res.data?.highlights) {
      const { applied, brokenIds } = applyAllHighlights(res.data.highlights as Parameters<typeof applyAllHighlights>[0]);
      console.log('[Web Notes] Restored', applied, 'of', res.data.highlights.length, 'highlights, broken:', brokenIds.length);
      if (brokenIds.length > 0) {
        sendToBackground({ type: 'BROKEN_HIGHLIGHTS', url: window.location.href, brokenIds });
      }
    }
  });
}

// ── Background communication helper ───────────────────────────────────

function sendToBackground(
  message: ContentMessage,
  callback?: (response: unknown) => void,
): void {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[Web Notes] Runtime error:', chrome.runtime.lastError.message);
      return;
    }
    if (callback) callback(response);
  });
}

// ── Initialize ────────────────────────────────────────────────────────

if (document.readyState === 'complete') {
  setTimeout(loadNotes, 500);
} else {
  window.addEventListener('load', () => setTimeout(loadNotes, 500));
}
