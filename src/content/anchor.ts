/**
 * Text anchor computation for highlight persistence.
 *
 * When a user highlights text, we compute a "fingerprint" that allows
 * us to re-locate the same text on subsequent page visits, even if
 * the DOM structure changes slightly.
 *
 * Three-tier recovery strategy:
 *   1. XPath + offset — precise DOM position
 *   2. Text + surrounding context — fuzzy match
 *   3. Text-only match — last resort fallback
 */

import type { TextAnchor } from '../shared/types';

/** Number of context characters to capture before and after the selection. */
const CONTEXT_LENGTH = 100;

/**
 * Compute a TextAnchor for the current browser Selection.
 *
 * Captures the selected text, its surrounding context, the XPath to
 * the containing text node, and the character offset within that node.
 *
 * @returns A TextAnchor object, or null if no text is selected.
 */
export function computeAnchor(): TextAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const range = sel.getRangeAt(0);
  const text = range.toString();
  if (!text.trim()) return null;

  const prefix = capturePrefix(range, CONTEXT_LENGTH);
  const suffix = captureSuffix(range, CONTEXT_LENGTH);
  const xpath = getXPath(range.startContainer);
  const offset = range.startOffset;

  // Always record end position
  const endXpath = getXPath(range.endContainer);
  const endOffset = range.endOffset;
  const startType = range.startContainer.nodeType;
  const endType = range.endContainer.nodeType;
  const isMulti = range.startContainer !== range.endContainer;
  console.log('[Web Notes] computeAnchor: multi-node?', isMulti, 'text len:', text.length,
    'startType:', startType, 'endType:', endType,
    'xpath ends text():', xpath.includes('text()'),
    'endXpath empty:', !endXpath, 'endXpath:', endXpath.slice(-30));

  // Defensive: if endXpath is empty but the selection spans multiple nodes,
  // fall back to using the start XPath (same-node recovery in buildTextNodeRange
  // will detect the length mismatch and return null, letting Tier 2/3 handle it).
  if (!endXpath && isMulti) {
    console.warn('[Web Notes] computeAnchor: endXpath is empty for a multi-node selection! ' +
      'endContainer type:', range.endContainer.nodeType,
      'endContainer nodeName:', (range.endContainer as Element).nodeName || '(text)');
  }

  return { text, prefix, suffix, xpath, offset, endXpath, endOffset };
}

/**
 * Locate a text node in the DOM using the stored anchor.
 *
 * Applies the three-tier recovery strategy in order.
 *
 * @param anchor - The stored TextAnchor.
 * @returns The located Range, or null if the text cannot be found.
 */
export function locateAnchor(anchor: TextAnchor): Range | null {
  // Tier 1: XPath + offset (most precise)
  const tier1 = locateByXPath(anchor);
  if (tier1) {
    console.log('[Web Notes] locateAnchor: Tier 1 (XPath) success');
    return tier1;
  }
  console.log('[Web Notes] locateAnchor: Tier 1 (XPath) failed, xpath ends with text():', anchor.xpath?.includes('text()'));

  // Tier 2: Text + context (fuzzy)
  const tier2 = locateByContext(anchor);
  if (tier2) {
    console.log('[Web Notes] locateAnchor: Tier 2 (context) success');
    return tier2;
  }
  console.log('[Web Notes] locateAnchor: Tier 2 (context) failed, search text length:', (anchor.prefix.slice(-50) + anchor.text + anchor.suffix.slice(0, 50)).trim().length);

  // Tier 3: Text-only
  const tier3 = locateByTextOnly(anchor);
  if (tier3) {
    console.log('[Web Notes] locateAnchor: Tier 3 (text-only) success');
    return tier3;
  }
  console.log('[Web Notes] locateAnchor: Tier 3 (text-only) failed, looking for:', anchor.text?.slice(0, 50));
  return null;
}

// ── Tier 1: XPath + offset ────────────────────────────────────────────

function getXPath(node: Node): string {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (el.id) return `//*[@id="${el.id}"]`;

    let parts: string[] = [];
    let current: Node | null = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const e = current as Element;
      let index = 1;
      let sibling = e.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === e.nodeName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${e.nodeName.toLowerCase()}[${index}]`);
      current = e.parentNode;
    }
    return '/' + parts.join('/');
  }

  if (node.nodeType === Node.TEXT_NODE && node.parentNode) {
    const parentXPath = getXPath(node.parentNode);
    const textNodes = Array.from(node.parentNode!.childNodes).filter(
      (n) => n.nodeType === Node.TEXT_NODE,
    );
    const index = textNodes.indexOf(node as ChildNode);
    return `${parentXPath}/text()[${index + 1}]`;
  }

  return '';
}

function locateByXPath(anchor: TextAnchor): Range | null {
  if (!anchor.xpath) return null;

  try {
    // Try text-node XPath first
    const startTextNode = locateTextNodeByXPath(anchor.xpath, anchor.offset);
    if (startTextNode) {
      return buildTextNodeRange(anchor, startTextNode);
    }

    // Element case: XPath points to an element, offset is child index
    const startEl = resolveXPath(anchor.xpath);
    if (!startEl) return null;

    let endEl: Node = startEl;
    let endOff = anchor.endOffset;
    if (anchor.endXpath) {
      const e = resolveXPath(anchor.endXpath);
      if (e) { endEl = e; endOff = anchor.endOffset; }
    }

    const range = document.createRange();
    range.setStart(startEl, anchor.offset);
    range.setEnd(endEl, endOff);
    return range;
  } catch {
    return null;
  }
}

function buildTextNodeRange(anchor: TextAnchor, startNode: Text): Range | null {
  const startOffset = Math.min(anchor.offset, (startNode.textContent || '').length);

  let endNode: Text;
  let endOffset: number;

  if (anchor.endXpath) {
    const en = locateTextNodeByXPath(anchor.endXpath, anchor.endOffset);
    if (!en) return null;
    endNode = en;
    endOffset = Math.min(anchor.endOffset, (endNode.textContent || '').length);
  } else {
    // No end XPath recorded. If the text fits within the start node,
    // treat it as a single-node highlight. Otherwise return null to
    // fall through to Tier 2 (context match) or Tier 3 (text-only),
    // both of which handle multi-node ranges properly.
    const nodeLen = (startNode.textContent || '').length;
    if (startOffset + anchor.text.length <= nodeLen) {
      endNode = startNode;
      endOffset = startOffset + anchor.text.length;
    } else {
      return null;
    }
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function resolveXPath(xpath: string): Node | null {
  if (!xpath) return null;
  const result = document.evaluate(
    xpath, document, null,
    XPathResult.FIRST_ORDERED_NODE_TYPE, null,
  );
  return result.singleNodeValue as Node | null;
}

/**
 * Given an XPath like /html/body/div[1]/p[2]/text()[1] and an offset,
 * locate the specific text node.
 */
function locateTextNodeByXPath(xpath: string, _offset: number): Text | null {
  if (!xpath) return null;
  const match = xpath.match(/text\(\)\[(\d+)\]$/);
  if (!match) return null;

  const textIndex = parseInt(match[1], 10) - 1;
  const parentPath = xpath.replace(/\/text\(\)\[\d+\]$/, '');

  const result = document.evaluate(
    parentPath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  );
  const parent = result.singleNodeValue;
  if (!parent) return null;

  const textNodes = Array.from(parent.childNodes).filter(
    (n) => n.nodeType === Node.TEXT_NODE,
  );
  return (textNodes[textIndex] as Text) || null;
}

// ── Tier 2: Context-based fuzzy match ─────────────────────────────────

function locateByContext(anchor: TextAnchor): Range | null {
  const searchText = (anchor.prefix.slice(-50) + anchor.text + anchor.suffix.slice(0, 50)).trim();
  if (!searchText || searchText.length < 10) return null;

  const range = findTextInDocument(searchText);
  if (!range) return null;

  // Try to narrow the range to just the highlight text portion
  const fullText = range.toString();
  const idx = fullText.indexOf(anchor.text);
  if (idx >= 0) {
    // Compute the innerText offset of anchor.text within the document body,
    // then use mapOffsetToRange for proper multi-node range construction.
    // Previously this assumed the entire anchor.text fit in a single text
    // node, which broke multi-element (cross-boundary) highlights on restore.
    const body = document.body;
    if (body) {
      const preRange = document.createRange();
      preRange.selectNodeContents(body);
      preRange.setEnd(range.startContainer, range.startOffset);
      const beforeLen = preRange.toString().length;
      const narrowRange = mapOffsetToRange(body, beforeLen + idx, anchor.text.length);
      if (narrowRange) return narrowRange;
    }
    // Fallback: single-node narrowing (works when text is in one node)
    const textNode = range.startContainer;
    const offset = range.startOffset + idx;
    const textLen = (textNode.textContent || '').length;
    const endOffset = Math.min(offset + anchor.text.length, textLen);
    if (offset < endOffset) {
      const narrowRange = document.createRange();
      narrowRange.setStart(textNode, offset);
      narrowRange.setEnd(textNode, endOffset);
      return narrowRange;
    }
  }

  return range;
}

// ── Tier 3: Text-only fallback ────────────────────────────────────────

function locateByTextOnly(anchor: TextAnchor): Range | null {
  if (!anchor.text || anchor.text.length < 3) return null;
  return findTextInDocument(anchor.text);
}

// ── Helpers ───────────────────────────────────────────────────────────

function capturePrefix(range: Range, length: number): string {
  const preRange = document.createRange();
  preRange.setStartBefore(range.startContainer.ownerDocument?.body || range.startContainer);
  preRange.setEnd(range.startContainer, range.startOffset);
  const full = preRange.toString();
  return full.slice(-length);
}

function captureSuffix(range: Range, length: number): string {
  const postRange = document.createRange();
  postRange.setStart(range.endContainer, range.endOffset);
  const body = range.endContainer.ownerDocument?.body;
  if (body) {
    postRange.setEndAfter(body);
  } else {
    postRange.setEnd(range.endContainer, (range.endContainer.textContent || '').length);
  }
  const full = postRange.toString();
  return full.slice(0, length);
}

// ── Visible text map (shared by findTextInDocument) ──────────────────

interface TextSegment {
  node: Text;
  /** Start offset within the concatenated visible text. */
  textStart: number;
  /** End offset (exclusive) within the concatenated visible text. */
  textEnd: number;
}

/**
 * Build a list of visible text segments by walking the DOM.
 *
 * Concatenating all segment text content produces a string that is
 * consistent with `Range.toString()` — the same representation used
 * when the highlight was originally created. This avoids the whitespace
 * mismatch between `innerText` and selection ranges.
 */
function buildVisibleTextMap(root: HTMLElement): TextSegment[] {
  const segments: TextSegment[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const el = (node as Text).parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let cumulative = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const text = textNode.textContent || '';
    if (!text) continue;
    segments.push({
      node: textNode,
      textStart: cumulative,
      textEnd: cumulative + text.length,
    });
    cumulative += text.length;
  }

  return segments;
}

/**
 * Create a DOM Range from a segment list and a target offset + length.
 */
function rangeFromSegments(
  segments: TextSegment[],
  targetOffset: number,
  length: number,
): Range | null {
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const seg of segments) {
    if (!startNode && seg.textEnd > targetOffset) {
      startNode = seg.node;
      startOffset = targetOffset - seg.textStart;
    }
    if (startNode && seg.textEnd >= targetOffset + length) {
      endNode = seg.node;
      endOffset = targetOffset + length - seg.textStart;
      break;
    }
  }

  if (!startNode) return null;

  // If we found start but not end (text extends past last segment),
  // use the last segment as the end.
  if (!endNode && segments.length > 0) {
    const last = segments[segments.length - 1];
    endNode = last.node;
    endOffset = last.textEnd - last.textStart;
  }
  if (!endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, Math.min(startOffset, (startNode.textContent || '').length));
  range.setEnd(endNode, Math.min(endOffset, (endNode.textContent || '').length));
  return range;
}

function findTextInDocument(searchText: string): Range | null {
  const body = document.body;
  if (!body) return null;

  // Build visible text map and concatenate. This text representation
  // is consistent with Range.toString() used during highlight creation,
  // avoiding innerText whitespace normalization mismatches.
  const segments = buildVisibleTextMap(body);
  const fullText = segments.map((s) => s.node.textContent || '').join('');

  const idx = fullText.indexOf(searchText);
  if (idx === -1) {
    const firstChars = searchText.slice(0, 10);
    console.log('[Web Notes] findTextInDocument: NOT FOUND. fullText length:', fullText.length, 'searchText length:', searchText.length, 'first 10:', firstChars);
    return null;
  }

  return rangeFromSegments(segments, idx, searchText.length);
}

/**
 * Map a character offset in the visible text back to a DOM Range.
 *
 * Walks visible text nodes (skipping script, style, display:none)
 * and tracks the cumulative offset until the target position is found.
 */
function mapOffsetToRange(root: HTMLElement, targetOffset: number, length: number): Range | null {
  const segments = buildVisibleTextMap(root);
  return rangeFromSegments(segments, targetOffset, length);
}
