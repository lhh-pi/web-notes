/**
 * IndexedDB 存储层
 *
 * 提供浏览器原生的笔记存储、搜索和导出功能。
 *
 * 数据库结构：
 *   Database: web-notes
 *   ├── ObjectStore: notes (keyPath: id)
 *   │    索引: url, domain, created
 *   └── ObjectStore: settings (keyPath: key)
 *        存储: syncMode, syncFileHandle, lastSyncAt 等配置
 *
 * 软删除策略：
 *   删除操作不物理移除记录，只标记 deleted: true 和 updated 时间戳。
 *   合并时若本机记录为软删除且 updated 更新，则拒绝文件中的同名记录。
 *   导出时自动清理超过 SOFT_DELETE_TTL（30天）的软删除记录。
 */

import type { Highlight, HighlightColor, PageNote, SearchResult, TextAnchor } from './types';

// ---- 常量 ----------------------------------------------------------------

const DB_NAME = 'web-notes';
const DB_VERSION = 2; // 升级：新增 deleted 字段，支持软删除
/** 软删除记录的保留天数。超过后导出时物理清除。 */
const SOFT_DELETE_TTL_DAYS = 7;
const SOFT_DELETE_TTL_MS = SOFT_DELETE_TTL_DAYS * 24 * 60 * 60 * 1000;

// ---- 数据库 Schema --------------------------------------------------------

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
  /** 软删除标记。存在且为 true 时表示已被删除（保留用于合并判断）。 */
  deleted?: boolean;
}

// ---- 数据库连接（单例）---------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

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

function now(): string {
  return new Date().toISOString();
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

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

/** 记录是否已过期（可物理清除）。 */
function isExpired(r: NoteRecord): boolean {
  if (!r.deleted) return false;
  const age = Date.now() - new Date(r.updated).getTime();
  return age > SOFT_DELETE_TTL_MS;
}

/** 过滤出活跃（未删除）的记录。 */
function isActive(r: NoteRecord): boolean {
  return !r.deleted;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- CRUD 操作 -----------------------------------------------------------

/** 获取指定 URL 页面的所有活跃高亮，按创建时间排序。 */
export async function getNotes(url: string): Promise<PageNote> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readonly');
  const index = tx.objectStore('notes').index('url');
  const records: NoteRecord[] = await promisify(index.getAll(url));

  const active = records.filter(isActive);
  const highlights = active.map(toHighlight).sort(
    (a, b) => a.created.localeCompare(b.created),
  );

  const first = active[0];
  return {
    url,
    title: first?.title ?? '',
    domain: domainFromUrl(url),
    highlights,
    created: first?.created ?? now(),
    updated: active.reduce((latest, r) => r.updated > latest ? r.updated : latest, ''),
  };
}

/** 保存一条新高亮（幂等）。 */
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
    deleted: false,
  };

  const tx = db.transaction('notes', 'readwrite');
  await promisify(tx.objectStore('notes').put(record));
  await txComplete(tx);

  return getNotes(url);
}

/** 更新笔记和/或颜色。 */
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
  record.deleted = false; // 确保未删除状态

  await promisify(store.put(record));
  await txComplete(tx);

  return getNotes(url);
}

/** 软删除一条高亮。 */
export async function deleteHighlight(highlightId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readwrite');
  const store = tx.objectStore('notes');

  const record: NoteRecord = await promisify(store.get(highlightId));
  if (!record) return;

  record.deleted = true;
  record.updated = now();
  await promisify(store.put(record));
  await txComplete(tx);
}

/** 软删除某页面的所有高亮。 */
export async function deletePage(url: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readwrite');
  const index = tx.objectStore('notes').index('url');
  const records: NoteRecord[] = await promisify(index.getAll(url));
  const timestamp = now();

  for (const r of records) {
    r.deleted = true;
    r.updated = timestamp;
    tx.objectStore('notes').put(r);
  }

  await txComplete(tx);
}

/** 软删除某域名下的所有高亮。 */
export async function deleteDomain(domain: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readwrite');
  const index = tx.objectStore('notes').index('domain');
  const records: NoteRecord[] = await promisify(index.getAll(domain));
  const timestamp = now();

  for (const r of records) {
    r.deleted = true;
    r.updated = timestamp;
    tx.objectStore('notes').put(r);
  }

  await txComplete(tx);
}

// ---- 搜索 ----------------------------------------------------------------

/** 全文搜索（仅搜索活跃记录）。 */
export async function searchNotes(query: string): Promise<SearchResult[]> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readonly');
  const records: NoteRecord[] = await promisify(tx.objectStore('notes').getAll());

  const q = query.toLowerCase();
  const scored: Array<{ result: SearchResult; score: number }> = [];

  for (const r of records) {
    if (!isActive(r)) continue;

    let score = 0;
    if (r.text.toLowerCase().includes(q)) score += q.length;
    if (r.note.toLowerCase().includes(q)) score += q.length * 2;
    if (r.title.toLowerCase().includes(q)) score += q.length * 0.5;
    if (r.url.toLowerCase().includes(q)) score += q.length * 0.3;

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

// ---- 列表查询（仅活跃记录）-----------------------------------------------

export async function listDomains(): Promise<string[]> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readonly');
  const records: NoteRecord[] = await promisify(tx.objectStore('notes').getAll());

  const domains = new Set(records.filter(isActive).map((r) => r.domain));
  return Array.from(domains).sort();
}

export interface PageSummary {
  url: string;
  title: string;
  domain: string;
  highlightCount: number;
  updated: string;
}

/**
 * 物理删除所有过期的软删除记录。
 * 返回删除数量。可安全重复调用。
 */
/** 清空所有数据（物理删除 notes + settings），完整重置。 */
export async function clearAll(): Promise<void> {
  const db = await getDB();
  // 清空笔记
  const txNotes = db.transaction('notes', 'readwrite');
  const records: NoteRecord[] = await promisify(txNotes.objectStore('notes').getAll());
  for (const r of records) {
    txNotes.objectStore('notes').delete(r.id);
  }
  await txComplete(txNotes);
  // 清空设置（同步模式、文件句柄、主题偏好、时间戳等）
  const txSettings = db.transaction('settings', 'readwrite');
  const allSettings = await promisify(txSettings.objectStore('settings').getAll());
  for (const s of allSettings) {
    txSettings.objectStore('settings').delete(s.key);
  }
  await txComplete(txSettings);
}

export async function purgeExpired(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readwrite');
  const records: NoteRecord[] = await promisify(tx.objectStore('notes').getAll());
  let deleted = 0;

  for (const r of records) {
    if (isExpired(r)) {
      tx.objectStore('notes').delete(r.id);
      deleted++;
    }
  }

  await txComplete(tx);
  return deleted;
}

export async function listPages(): Promise<PageSummary[]> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readonly');
  const records: NoteRecord[] = await promisify(tx.objectStore('notes').getAll());
  const active = records.filter(isActive);

  const pageMap = new Map<string, {
    title: string;
    domain: string;
    count: number;
    updated: string;
  }>();

  for (const r of active) {
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

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const db = await getDB();
  const tx = db.transaction('settings', 'readonly');
  const result: { key: string; value: T } | undefined = await promisify(
    tx.objectStore('settings').get(key),
  );
  return result?.value ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
  await txComplete(tx);
}

// ---- JSON 导出/导入 ------------------------------------------------------

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
        /** 软删除标记（可选），存在且为 true 时表示该记录已被删除。 */
        deleted?: boolean;
      }>;
    }>;
  }>;
}

/**
 * 全量导出 IndexedDB → JSON 对象。
 *
 * 导出逻辑：
 *   1. 包含活跃记录 + 未过期的软删除记录
 *   2. 超过 SOFT_DELETE_TTL_DAYS 天的软删除记录 → 物理删除（不导出 + 从 DB 移除）
 *   3. 导出后页面 highlights 为空 → 该页面不导出
 *   4. 导出后域名 pages 为空 → 该域名不导出
 */
export async function exportToJSON(): Promise<SyncFileFormat> {
  const db = await getDB();
  const tx = db.transaction('notes', 'readwrite');
  const records: NoteRecord[] = await promisify(tx.objectStore('notes').getAll());

  const domains: SyncFileFormat['domains'] = {};

  for (const r of records) {
    // 过期的软删除记录 → 物理删除
    if (isExpired(r)) {
      tx.objectStore('notes').delete(r.id);
      continue;
    }

    if (!domains[r.domain]) {
      domains[r.domain] = { pages: [] };
    }

    let page = domains[r.domain].pages.find((p) => p.url === r.url);
    if (!page) {
      page = { url: r.url, title: r.title, highlights: [] };
      domains[r.domain].pages.push(page);
    }

    const hl: SyncFileFormat['domains'][string]['pages'][number]['highlights'][number] = {
      id: r.id,
      text: r.text,
      color: r.color,
      note: r.note,
      anchor: r.anchor,
      created: r.created,
      updated: r.updated,
    };
    if (r.deleted) hl.deleted = true;

    page.highlights.push(hl);
  }

  // 过滤空页面和空域名
  for (const [domain, domainData] of Object.entries(domains)) {
    domainData.pages = domainData.pages.filter((p) => p.highlights.length > 0);
    if (domainData.pages.length === 0) {
      delete domains[domain];
    }
  }

  await txComplete(tx);

  return {
    version: 1,
    exported_at: now(),
    domains,
  };
}

/**
 * 从 JSON 导入笔记到 IndexedDB。
 *
 * 合并策略（newer-wins + 软删除感知）：
 *   - IndexedDB 无此 id → 直接导入
 *   - IndexedDB 有此 id，本机 deleted=true 且 updated > 文件 → 跳过（本机删除更新）
 *   - IndexedDB 有此 id，本机 updated >= 文件 → 跳过（本机更新）
 *   - 文件 updated >= 本机 → 覆盖导入（含 undelete）
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

        if (existing) {
          // 本机软删除且时间戳更新 → 拒绝导入
          if (existing.deleted && existing.updated >= hl.updated) {
            skipped++;
            continue;
          }
          // 本机非删除且时间戳更新 → 保留本机
          if (!existing.deleted && existing.updated >= hl.updated) {
            skipped++;
            continue;
          }
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
          deleted: hl.deleted === true ? true : false,
        });
        imported++;
      }
    }
  }

  await txComplete(tx);

  return { imported, skipped };
}
