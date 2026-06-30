/**
 * Shared type definitions for the Web Notes extension.
 *
 * Mirrors the Python Pydantic models in backend/models.py.
 * All cross-layer messages use these types for type safety.
 */

/** Supported highlight colors. Must match backend HighlightColor enum. */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red';

/** Positional fingerprint for re-applying highlights on page revisit. */
export interface TextAnchor {
  text: string;       // The full selected text
  prefix: string;     // Up to 100 chars of preceding text
  suffix: string;     // Up to 100 chars of following text
  xpath: string;      // XPath to the START text node
  offset: number;     // Character offset within the START text node
  endXpath: string;   // XPath to the END text node (empty = same node)
  endOffset: number;  // Character offset within the END text node
}

/** A single highlight annotation. */
export interface Highlight {
  id: string;
  text: string;
  color: HighlightColor;
  note: string;       // Markdown; empty = pure highlight
  anchor: TextAnchor;
  created: string;    // ISO 8601
}

/** Page-level container for all highlights. */
export interface PageNote {
  url: string;
  title: string;
  domain: string;
  highlights: Highlight[];
  created: string;
  updated: string;
}

/** API response for GET /api/notes */
export interface GetNotesResponse {
  url: string;
  title?: string;
  domain?: string;
  highlights: Highlight[];
  created?: string;
  updated?: string;
}

/** Request body for POST /api/notes */
export interface CreateHighlightRequest {
  url: string;
  title: string;
  domain: string;
  text: string;
  color: HighlightColor;
  note: string;
  anchor: TextAnchor;
}

/** A search result from the backend. */
export interface SearchResult {
  url: string;
  title: string;
  domain: string;
  highlight_id: string;
  match_text: string;
  note: string;
  context: string;
}

/** API response for GET /api/search */
export interface SearchResponse {
  query: string;
  count: number;
  results: SearchResult[];
}

/** A single entry in the global page index. */
export interface PageEntry {
  url: string;
  title: string;
  domain: string;
  updated: string;
  highlight_count: number;
}

/** API response for GET /api/pages */
export interface PagesResponse {
  pages: PageEntry[];
}

/** API response for GET /api/domains */
export interface DomainsResponse {
  domains: string[];
}

// ── Internal Chrome extension message types ──────────────────────────

/** Messages sent from Content Script → Background Worker. */
export type ContentMessage =
  | { type: 'GET_NOTES'; url: string }
  | { type: 'CREATE_HIGHLIGHT'; payload: CreateHighlightRequest }
  | { type: 'UPDATE_HIGHLIGHT'; url: string; highlightId: string; note?: string; color?: HighlightColor }
  | { type: 'DELETE_HIGHLIGHT'; url: string; highlightId: string }
  | { type: 'SEARCH'; query: string }
  | { type: 'GET_DOMAINS' }
  | { type: 'EXPORT'; domain: string }
  | { type: 'BROKEN_HIGHLIGHTS'; url: string; brokenIds: string[] };

/** Messages sent from Background Worker → Content Script. */
export type BackgroundMessage =
  | { type: 'NOTES_LOADED'; data: GetNotesResponse }
  | { type: 'HIGHLIGHT_SAVED'; data: PageNote }
  | { type: 'HIGHLIGHT_DELETED'; highlightId: string }
  | { type: 'SEARCH_RESULTS'; data: SearchResponse }
  | { type: 'DOMAINS_LIST'; data: DomainsResponse }
  | { type: 'ERROR'; message: string };
