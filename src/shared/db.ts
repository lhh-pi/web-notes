/**
 * IndexedDB 存储层
 *
 * 替代 Python 后端 storage.py + search.py + export.py，
 * 提供浏览器原生的笔记存储、搜索和导出功能。
 *
 * 数据库结构：
 *   Database: web-notes
 *   ├── ObjectStore: notes (keyPath: id)
 *   │    索引: url, domain, created
 *   └── ObjectStore: settings (keyPath: key)
 *        存储: syncMode, syncFileHandle 等配置
 */

import type { Highlight, HighlightColor, PageNote, SearchResult, TextAnchor } from './types';

// ---- 数据库 Schema --------------------------------------------------------

const DB_NAME = 'web-notes';
const DB_VERSION = 1;

/** IndexedDB 中存储的单条笔记记录。 */
interface NoteRecord {
  id: string;
  url: string;
  title: string;
  domain: string;
  text: string;
  color: HighlightColor;
  note: string;
  anchor: TextAnchor;
  created: string;
  updated: string;
}

// ---- 数据库连接（单例）---------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

/** 获取数据库连接。首次调用时自动创建数据库和索引。 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('notes')) {
        const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
        notesStore.createIndex('url', 'url');
        notesStore.createIndex('domain', 'domain');
        notesStore.createIndex('created', 'created');
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

// ---- 辅助函数 ------------------------------------------------------------

/** 返回当前 ISO 8601 时间戳。 */
function now(): string {
  return new Date().toISOString();
}

/** 从 URL 提取域名。 */
function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 将 IndexedDB 记录转换为外部的 Highlight 类型。 */
function toHighlight(r: NoteRecord): Highlight {
  return {
    id: r.id,
    text: r.text,
    color: r.color,
    note: r.note,
    anchor: r.anchor,
    created: r.created,
  };
}

/** 将 IDBRequest 包装为 Promise。 */
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 等待事务完成。 */
function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- CRUD 操作 -----------------------------------------------------------

/**
 * 获取指定 URL 页面的所有高亮笔记。
 * 返回结果按创建时间排序。
 */
export async function getNotes(url: string): Promise<PageNote> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readonly');
  const index = tx.objectStore('notes').index('url');
  const records: NoteRecord[] = await promisify(index.getAll(url));

  const highlights = records.map(toHighlight).sort(
    (a, b) => a.created.localeCompare(b.created),
  );

  const first = records[0];
  return {
    url,
    title: first?.title ?? '',
    domain: domainFromUrl(url),
    highlights,
    created: first?.created ?? now(),
    updated: records.reduce((latest, r) => r.updated > latest ? r.updated : latest, ''),
  };
}

/**
 * 保存一条新高亮。如果 id 已存在则覆盖（幂等）。
 * 返回更新后的页面笔记。
 */
export async function saveHighlight(
  url: string,
  title: string,
  domain: string,
  highlight: Highlight,
): Promise<PageNote> {
  const db = await getDB();
  const timestamp = now();

  const record: NoteRecord = {
    id: highlight.id,
    url,
    title,
    domain,
    text: highlight.text,
    color: highlight.color,
    note: highlight.note || '',
    anchor: highlight.anchor,
    created: highlight.created || timestamp,
    updated: timestamp,
  };

  const tx = db.transaction('notes', 'readwrite');
  await promisify(tx.objectStore('notes').put(record));
  await txComplete(tx);

  return getNotes(url);
}

/**
 * 更新一条高亮的笔记内容和/或颜色。
 *
 * @param url - 页面 URL
 * @param highlightId - 高亮 ID
 * @param note - 可选的 Markdown 笔记
 * @param color - 可选的高亮颜色
 * @returns 更新后的页面笔记
 * @throws 如果高亮不存在
 */
export async function updateHighlight(
  url: string,
  highlightId: string,
  note?: string,
  color?: HighlightColor,
): Promise<PageNote> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readwrite');
  const store = tx.objectStore('notes');

  const record: NoteRecord = await promisify(store.get(highlightId));
  if (!record) {
    throw new Error(`Highlight not found: ${highlightId}`);
  }

  if (note !== undefined) record.note = note;
  if (color !== undefined) record.color = color;
  record.updated = now();

  await promisify(store.put(record));
  await txComplete(tx);

  return getNotes(url);
}

/** 删除一条高亮（通过 ID 直接删除，id 是全局唯一的）。 */
export async function deleteHighlight(highlightId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readwrite');
  await promisify(tx.objectStore('notes').delete(highlightId));
  await txComplete(tx);
}

/** 删除某个页面的所有高亮。 */
export async function deletePage(url: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readwrite');
  const index = tx.objectStore('notes').index('url');
  const records: NoteRecord[] = await promisify(index.getAll(url));

  for (const r of records) {
    tx.objectStore('notes').delete(r.id);
  }

  await txComplete(tx);
}

/** 删除某个域名下的所有高亮。 */
export async function deleteDomain(domain: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readwrite');
  const index = tx.objectStore('notes').index('domain');
  const records: NoteRecord[] = await promisify(index.getAll(domain));

  for (const r of records) {
    tx.objectStore('notes').delete(r.id);
  }

  await txComplete(tx);
}

// ---- 搜索 ----------------------------------------------------------------

/**
 * 全文搜索所有笔记。
 *
 * 搜索范围：高亮文本、笔记内容、页面标题、URL。
 * 权重：笔记匹配 ×2，标题匹配 ×0.5，URL 匹配 ×0.3。
 * 最多返回 50 条结果，按分数降序。
 */
export async function searchNotes(query: string): Promise<SearchResult[]> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readonly');
  const records: NoteRecord[] = await promisify(tx.objectStore('notes').getAll());

  const q = query.toLowerCase();
  const scored: Array<{ result: SearchResult; score: number }> = [];

  for (const r of records) {
    let score = 0;
    const textLower = r.text.toLowerCase();
    const noteLower = r.note.toLowerCase();
    const titleLower = r.title.toLowerCase();
    const urlLower = r.url.toLowerCase();

    if (textLower.includes(q)) score += q.length;
    if (noteLower.includes(q)) score += q.length * 2;
    if (titleLower.includes(q)) score += q.length * 0.5;
    if (urlLower.includes(q)) score += q.length * 0.3;

    if (score > 0) {
      scored.push({
        result: {
          url: r.url,
          title: r.title,
          domain: r.domain,
          highlight_id: r.id,
          match_text: r.text,
          note: r.note,
          context: snippet(r.text, q),
        },
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 50).map((s) => s.result);
}

/** 提取查询匹配周围的上下文片段（最多 120 字符）。 */
function snippet(text: string, query: string, maxLen = 120): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, maxLen);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 40);
  let s = text.slice(start, end);
  if (start > 0) s = '…' + s;
  if (end < text.length) s = s + '…';
  return s;
}

// ---- 列表查询 ------------------------------------------------------------

/** 列出所有包含笔记的域名（按字母排序）。 */
export async function listDomains(): Promise<string[]> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readonly');
  const records: NoteRecord[] = await promisify(tx.objectStore('notes').getAll());

  const domains = new Set(records.map((r) => r.domain));
  return Array.from(domains).sort();
}

/** 页面摘要信息。 */
export interface PageSummary {
  url: string;
  title: string;
  domain: string;
  highlightCount: number;
  updated: string;
}

/** 列出所有页面及其高亮统计（按更新时间降序）。 */
export async function listPages(): Promise<PageSummary[]> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readonly');
  const records: NoteRecord[] = await promisify(tx.objectStore('notes').getAll());

  const pageMap = new Map<string, {
    title: string;
    domain: string;
    count: number;
    updated: string;
  }>();

  for (const r of records) {
    const existing = pageMap.get(r.url);
    if (existing) {
      existing.count++;
      if (r.updated > existing.updated) existing.updated = r.updated;
    } else {
      pageMap.set(r.url, { title: r.title, domain: r.domain, count: 1, updated: r.updated });
    }
  }

  return Array.from(pageMap.entries())
    .map(([url, info]) => ({ url, ...info, highlightCount: info.count }))
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

// ---- 设置操作 ------------------------------------------------------------

/**
 * 读取一个设置项。
 *
 * @returns 设置值，如果不存在则返回 null
 */
export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const db = await getDB();
  const tx = db.transaction('settings', 'readonly');
  const result: { key: string; value: T } | undefined = await promisify(
    tx.objectStore('settings').get(key),
  );
  return result?.value ?? null;
}

/** 写入一个设置项。 */
export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
  await txComplete(tx);
}

// ---- JSON 导出/导入 ------------------------------------------------------

/** 同步 JSON 文件的数据格式。 */
export interface SyncFileFormat {
  version: 1;
  exported_at: string;
  domains: Record<string, {
    pages: Array<{
      url: string;
      title: string;
      highlights: Array<{
        id: string;
        text: string;
        color: string;
        note: string;
        anchor: TextAnchor;
        created: string;
        updated: string;
      }>;
    }>;
  }>;
}

/** 全量导出 IndexedDB 为结构化 JSON 对象。 */
export async function exportToJSON(): Promise<SyncFileFormat> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readonly');
  const records: NoteRecord[] = await promisify(tx.objectStore('notes').getAll());

  const domains: SyncFileFormat['domains'] = {};

  for (const r of records) {
    if (!domains[r.domain]) {
      domains[r.domain] = { pages: [] };
    }

    let page = domains[r.domain].pages.find((p) => p.url === r.url);
    if (!page) {
      page = { url: r.url, title: r.title, highlights: [] };
      domains[r.domain].pages.push(page);
    }

    page.highlights.push({
      id: r.id,
      text: r.text,
      color: r.color,
      note: r.note,
      anchor: r.anchor,
      created: r.created,
      updated: r.updated,
    });
  }

  // 每个域名内按 URL 排序
  for (const d of Object.values(domains)) {
    d.pages.sort((a, b) => a.url.localeCompare(b.url));
  }

  return {
    version: 1,
    exported_at: now(),
    domains,
  };
}

/**
 * 从 JSON 数据导入笔记到 IndexedDB。
 *
 * 合并策略：newer-wins。同 id 的记录比较 updated 时间戳，
 * IndexedDB 中已有的较新记录不会被覆盖。
 *
 * @returns 导入和跳过的记录数
 */
export async function importFromJSON(
  data: SyncFileFormat,
): Promise<{ imported: number; skipped: number }> {
  const db = await getDB();
  let imported = 0;
  let skipped = 0;

  const tx = db.transaction('notes', 'readwrite');
  const store = tx.objectStore('notes');

  for (const [domain, domainData] of Object.entries(data.domains)) {
    for (const page of domainData.pages) {
      for (const hl of page.highlights) {
        const existing: NoteRecord | undefined = await promisify(store.get(hl.id));

        if (existing && existing.updated >= hl.updated) {
          skipped++;
          continue;
        }

        store.put({
          id: hl.id,
          url: page.url,
          title: page.title,
          domain,
          text: hl.text,
          color: hl.color as HighlightColor,
          note: hl.note,
          anchor: hl.anchor,
          created: hl.created,
          updated: hl.updated,
        });
        imported++;
      }
    }
  }

  await txComplete(tx);

  return { imported, skipped };
}
