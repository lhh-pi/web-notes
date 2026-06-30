/**
 * HTTP client for communicating with the Python backend.
 *
 * All requests go to the local Python server. The background worker
 * is the only component that calls these functions; content scripts
 * and sidebar communicate via Chrome messaging.
 */

import type {
  CreateHighlightRequest,
  DomainsResponse,
  GetNotesResponse,
  HighlightColor,
  PageNote,
  PagesResponse,
  SearchResponse,
} from './types';
import config from '../../config.json';

const { host, port } = config.server;
const API_BASE = `http://${host}:${port}/api`;

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/** Fetch all highlights for a page URL. */
export async function getNotes(pageUrl: string): Promise<GetNotesResponse> {
  const encoded = encodeURIComponent(pageUrl);
  return request<GetNotesResponse>(`/notes?url=${encoded}`);
}

/** Create or update a highlight. */
export async function createHighlight(
  payload: CreateHighlightRequest,
): Promise<PageNote> {
  return request<PageNote>('/notes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Update a highlight's note or color. */
export async function updateHighlight(
  url: string,
  highlightId: string,
  note?: string,
  color?: HighlightColor,
): Promise<PageNote> {
  const encoded = encodeURIComponent(url);
  const body: Record<string, string> = {};
  if (note !== undefined) body.note = note;
  if (color !== undefined) body.color = color;
  return request<PageNote>(`/notes/${highlightId}?url=${encoded}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Delete a highlight. */
export async function deleteHighlight(
  url: string,
  highlightId: string,
): Promise<{ deleted: string }> {
  const encoded = encodeURIComponent(url);
  return request(`/notes/${highlightId}?url=${encoded}`, {
    method: 'DELETE',
  });
}

/** Full-text search. */
export async function searchNotes(query: string): Promise<SearchResponse> {
  const encoded = encodeURIComponent(query);
  return request<SearchResponse>(`/search?q=${encoded}`);
}

/** List all indexed pages with metadata. */
export async function listPages(): Promise<PagesResponse> {
  return request<PagesResponse>('/pages');
}

/** Delete an entire page (all its highlights). */
export async function deletePage(url: string): Promise<{ deleted: string }> {
  const encoded = encodeURIComponent(url);
  return request(`/pages?url=${encoded}`, { method: 'DELETE' });
}

/** Export notes as Markdown text. */
export async function exportNotes(domain: string): Promise<string> {
  const encoded = encodeURIComponent(domain);
  const url = `${API_BASE}/export?domain=${encoded}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Export error ${res.status}`);
  }
  return res.text();
}

/** List all domains with notes. */
export async function listDomains(): Promise<DomainsResponse> {
  return request<DomainsResponse>('/domains');
}

