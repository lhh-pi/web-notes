/**
 * DOM highlighter: renders and manages `<mark>` elements on the page.
 */

import type { Highlight, HighlightColor } from '../shared/types';
import type { TextAnchor } from '../shared/types';
import { locateAnchor } from './anchor';
import { showBubble } from './popup_bubble';

const MARK_CLASS = 'wn-highlight';
const renderedRanges = new Map<string, Range>();

/**
 * Apply a highlight to the DOM using its stored anchor.
 *
 * Uses the three-tier recovery strategy to locate the text,
 * then wraps it in a `<mark>` with a click handler for the popup bubble.
 */
export function applyHighlight(highlight: Highlight): HTMLElement | null {
  removeHighlight(highlight.id);

  const anchor = highlight.anchor;
  console.log('[Web Notes] applyHighlight:', highlight.id, 'text:', highlight.text?.slice(0, 30), 'xpath:', anchor?.xpath?.slice(0, 40));

  const range = locateAnchor(anchor);
  if (!range) {
    console.warn(`[Web Notes] Could not locate text for highlight ${highlight.id}, anchor:`, JSON.stringify(anchor).slice(0, 200));
    return null;
  }

  const mark = createMarkElement(highlight);
  const inserted = wrapRangeWithMark(range, mark);
  if (inserted) {
    renderedRanges.set(highlight.id, range);
    console.log('[Web Notes] Highlight applied:', highlight.id);
  }
  return inserted;
}

/**
 * Highlight the user's current text selection in-place.
 *
 * Captures the selection range before it is modified, wraps it in a
 * `<mark>`, and returns the mark element with a click handler attached.
 *
 * Uses extractContents+insertNode instead of surroundContents to handle
 * selections that cross element boundaries.
 *
 * Returns null if no valid selection exists or if the DOM operation fails.
 */
export function highlightSelection(
  range: Range,
  color: HighlightColor,
  anchor: TextAnchor,
): HTMLElement | null {
  const text = range.toString();
  if (!text.trim()) return null;

  const mark = document.createElement('mark');
  mark.className = `${MARK_CLASS} ${MARK_CLASS}--${color}`;

  // Build a temporary highlight for the click handler
  const tempHighlight: Highlight = {
    id: '',
    text,
    color,
    note: '',
    anchor,
    created: new Date().toISOString(),
  };
  // Store on the element so we can retrieve it later
  (mark as HTMLElement & { _wnHighlight: Highlight })._wnHighlight = tempHighlight;

  mark.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const h = (mark as HTMLElement & { _wnHighlight?: Highlight })._wnHighlight;
    if (h) showBubble(h, mark);
  });

  const inserted = wrapRangeWithMark(range, mark);
  if (!inserted) return null;

  return mark;
}

/**
 * Wrap a Range with a mark element.
 *
 * Uses surroundContents for simple (single-node) selections.
 * For cross-boundary selections, wraps each text node in reverse
 * order to avoid position invalidation. Caps at 200 nodes to
 * prevent freezing on very large selections.
 */
function wrapRangeWithMark(range: Range, mark: HTMLElement): HTMLElement | null {
  try {
    range.surroundContents(mark);
    return mark;
  } catch {
    return wrapCrossBoundary(range, mark);
  }
}

function wrapCrossBoundary(range: Range, template: HTMLElement): HTMLElement | null {
  const nodes = collectRangeTextNodes(range);
  if (nodes.length === 0) return null;

  const tmplExt = template as HTMLElement & { _wnHighlight?: Highlight };
  const highlightData = tmplExt._wnHighlight;

  // Use existing ID if set (restore), otherwise generate temp ID (create)
  const sharedId = template.dataset.highlightId || ('pending-' + Date.now());
  template.dataset.highlightId = sharedId;

  let firstMark: HTMLElement | null = null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const { node, start, end } = nodes[i];
    // cloneNode does NOT copy event listeners — must re-attach
    const m = template.cloneNode(true) as HTMLElement;
    // share highlight data and ID across all segments
    (m as HTMLElement & { _wnHighlight?: Highlight })._wnHighlight = highlightData as Highlight;
    m.dataset.highlightId = sharedId;
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const h = (m as HTMLElement & { _wnHighlight?: Highlight })._wnHighlight;
      if (h) showBubble(h, m);
    });

    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    try {
      r.surroundContents(m);
      firstMark = m;
    } catch { /* skip */ }
  }

  return firstMark;
}

/** Get a text node's index among child nodes of its parent. */
function childIndexOf(textNode: Text): number {
  let idx = 0;
  let sibling = textNode.previousSibling;
  while (sibling) { idx++; sibling = sibling.previousSibling; }
  return idx;
}

/** Collect text nodes within a range, capped to prevent freezing. */
function collectRangeTextNodes(
  range: Range,
): Array<{ node: Text; start: number; end: number }> {
  const MAX_NODES = 200;
  const result: Array<{ node: Text; start: number; end: number }> = [];

  // Use a NodeIterator instead of TreeWalker for simpler boundary control
  const iter = document.createNodeIterator(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
  );

  let node: Node | null;
  while ((node = iter.nextNode()) && result.length < MAX_NODES) {
    const textNode = node as Text;
    const text = textNode.textContent || '';
    if (!text.trim()) continue;

    // Quick position check: is this node between start and end?
    const posStart = range.startContainer.compareDocumentPosition(textNode);
    const posEnd = range.endContainer.compareDocumentPosition(textNode);

    // Node must be after or equal to startContainer ...
    const afterStart = textNode === range.startContainer ||
      !!(posStart & Node.DOCUMENT_POSITION_FOLLOWING) ||
      !!(posStart & Node.DOCUMENT_POSITION_CONTAINS);
    // ... and before or equal to endContainer
    const beforeEnd = textNode === range.endContainer ||
      !!(posEnd & Node.DOCUMENT_POSITION_PRECEDING) ||
      !!(posEnd & Node.DOCUMENT_POSITION_CONTAINS);

    if (!(afterStart && beforeEnd)) continue;

    // Determine the selected portion within this text node
    let start = 0;
    let end = text.length;

    if (textNode === range.startContainer) {
      start = range.startOffset;
    } else if (range.startContainer.nodeType === Node.ELEMENT_NODE &&
               textNode.parentNode === range.startContainer) {
      // Text node is a direct child of the start element — check child index
      const childIdx = childIndexOf(textNode);
      if (childIdx < range.startOffset) continue; // Before selection start
    }

    if (textNode === range.endContainer) {
      end = range.endOffset;
    } else if (range.endContainer.nodeType === Node.ELEMENT_NODE &&
               textNode.parentNode === range.endContainer) {
      // Text node is a direct child of the end element — check child index
      const childIdx = childIndexOf(textNode);
      if (childIdx > range.endOffset) continue; // After selection end
    }

    if (start >= end) continue;

    result.push({ node: textNode, start, end });
  }

  return result;
}

/**
 * Create a `<mark>` element from a Highlight object with click handler.
 */
function createMarkElement(highlight: Highlight): HTMLElement {
  const mark = document.createElement('mark');
  mark.className = `${MARK_CLASS} ${MARK_CLASS}--${highlight.color}`;
  mark.dataset.highlightId = highlight.id;
  mark.dataset.hasNote = highlight.note ? '1' : '0';
  mark.title = highlight.note ? 'Click to view/edit note' : 'Click to add a note';
  // Store highlight data for cross-boundary cloning
  (mark as HTMLElement & { _wnHighlight: Highlight })._wnHighlight = highlight;

  mark.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    showBubble(highlight, mark);
  });

  return mark;
}

/**
 * Remove a highlight `<mark>` from the DOM, preserving the text content.
 */
export function removeHighlight(highlightId: string): void {
  const marks = document.querySelectorAll(
    `mark.${MARK_CLASS}[data-highlight-id="${highlightId}"]`,
  );
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    }
  });
  renderedRanges.delete(highlightId);
}

/**
 * Update the highlight ID and note status on a mark element.
 * Called after the backend assigns a permanent ID.
 */
export function updateMarkData(
  mark: HTMLElement,
  highlightId: string,
  note: string,
): void {
  mark.dataset.highlightId = highlightId;
  mark.dataset.hasNote = note ? '1' : '0';
  // Update the stored highlight
  const ext = mark as HTMLElement & { _wnHighlight?: Highlight };
  if (ext._wnHighlight) {
    ext._wnHighlight.id = highlightId;
    ext._wnHighlight.note = note;
  }
}

/**
 * Apply all highlights for the current page (called on page load).
 *
 * @returns Count of applied highlights and IDs of those that could not be located.
 */
export function applyAllHighlights(highlights: Highlight[]): { applied: number; brokenIds: string[] } {
  let applied = 0;
  const brokenIds: string[] = [];
  for (const h of highlights) {
    const mark = applyHighlight(h);
    if (mark) {
      applied++;
    } else {
      brokenIds.push(h.id);
    }
  }
  return { applied, brokenIds };
}
