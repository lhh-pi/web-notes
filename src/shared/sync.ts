/**
 * 文件同步层
 *
 * 使用 File System Access API（Chrome 86+ / Edge 86+）将 IndexedDB
 * 数据同步到本地 JSON 文件。配合 OneDrive / iCloud 等云盘客户端
 * 实现跨设备同步。
 *
 * 双向同步策略：
 *   写入前先读取文件 → 如果文件被其他设备修改过 → merge 进 IndexedDB
 *   → 全量写回文件。保证 IndexedDB 和 JSON 文件始终一致。
 *
 * 权限策略：
 *   - verifyPermission() 只查询不请求，避免在 SW 中误将状态设为 denied
 *   - mergeFromFile() 只读，无需写权限，checkSyncOnStartup 直接调用
 *   - syncNow() 写入失败时抛出 SyncPermissionError，不修改同步模式
 *   - Sidebar 捕获 SyncPermissionError 后调用 recoverPermission() 弹出授权框
 *
 * 三种同步模式：
 *   - auto:   每次数据变更后自动写回 JSON 文件
 *   - manual: 用户手动点击"Sync Now"按钮写入
 *   - off:    不使用文件同步（数据仅存 IndexedDB）
 *
 * 导出/导入 JSON 是独立功能，不依赖同步配置即可使用。
 */

import { exportToJSON, getSetting, importFromJSON, setSetting } from './db';
import type { SyncFileFormat } from './db';

// ---- File System Access API 类型声明（Chrome 86+ / Edge 86+）------------

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemFileHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    createWritable(): Promise<FileSystemWritableFileStream>;
    getFile(): Promise<File>;
    readonly name: string;
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: string | Blob | ArrayBuffer): Promise<void>;
    close(): Promise<void>;
  }
}

declare global {
  interface Window {
    showSaveFilePicker(options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }): Promise<FileSystemFileHandle>;
  }
}

// ---- 类型 ----------------------------------------------------------------

export type SyncMode = 'auto' | 'manual' | 'off';

// ---- 设置 key 常量 -------------------------------------------------------

const SETTING_SYNC_MODE = 'syncMode';
const SETTING_SYNC_HANDLE = 'syncFileHandle';
// ---- 自定义错误 ------------------------------------------------------------

/**
 * 同步写入权限不可用。
 * Sidebar 捕获后可调用 recoverPermission() 弹出授权框重试。
 */
export class SyncPermissionError extends Error {
  constructor() {
    super(
      '[Web Notes] Sync write permission not available.\n\n' +
      'Open the sidebar to re-authorize file access.',
    );
    this.name = 'SyncPermissionError';
  }
}

// ---- 同步模式管理 --------------------------------------------------------

/** 获取当前同步模式。 */
export async function getSyncMode(): Promise<SyncMode> {
  const mode = await getSetting<string>(SETTING_SYNC_MODE);
  return (mode as SyncMode) || 'off';
}

/** 设置同步模式。仅由用户手动操作触发，不受权限影响。 */
export async function setSyncMode(mode: SyncMode): Promise<void> {
  await setSetting(SETTING_SYNC_MODE, mode);
}

// ---- 选择同步文件 --------------------------------------------------------

/**
 * 打开文件选择器，让用户选择或创建 JSON 文件作为同步目标。
 * 仅在 Sidebar 页面上下文中调用（需要用户手势）。
 *
 * @returns 文件名，用户取消则返回 null
 */
export async function selectSyncFile(): Promise<string | null> {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'web-notes.json',
      types: [{
        description: 'JSON file',
        accept: { 'application/json': ['.json'] },
      }],
    });

    await setSetting(SETTING_SYNC_HANDLE, handle);
    // showSaveFilePicker 已授予新权限，直接写入
    await syncNow('Selected new sync file — ');

    return handle.name;
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') {
      return null;
    }
    throw err;
  }
}

/** 获取已持久化的 FileSystemFileHandle。 */
async function getSyncHandle(): Promise<FileSystemFileHandle | null> {
  return getSetting<FileSystemFileHandle>(SETTING_SYNC_HANDLE);
}

/** 检查是否已配置同步文件。 */
export async function hasSyncFile(): Promise<boolean> {
  const handle = await getSyncHandle();
  return handle !== null;
}

/** 获取同步文件名。 */
export async function getSyncFileName(): Promise<string | null> {
  const handle = await getSyncHandle();
  return handle?.name ?? null;
}

// ---- 权限管理 ------------------------------------------------------------

/**
 * 仅查询文件写入权限，不请求。
 * 安全用于 SW 上下文（不会误将 prompt 变成 denied）。
 */
async function verifyPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  return (await handle.queryPermission(opts)) === 'granted';
}

/**
 * 弹出系统授权框请求写权限。
 * 仅应在 Sidebar 页面上下文中调用（需要 UI）。
 *
 * @returns 是否授权成功
 */
export async function recoverPermission(): Promise<boolean> {
  const handle = await getSyncHandle();
  if (!handle) return false;

  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;

  return (await handle.requestPermission(opts)) === 'granted';
}

/**
 * 快速检查写权限是否可用。不弹框，不修改状态。
 * 用于 background 在 auto 模式下写入前判断是否需要通知用户。
 *
 * @returns true 表示可以写入，false 表示权限不可用（需要授权）
 */
export async function checkWritePermission(): Promise<boolean> {
  const mode = await getSyncMode();
  if (mode !== 'auto') return true; // 非 auto 模式不需要写权限

  const handle = await getSyncHandle();
  if (!handle) return true; // 无文件配置，无需提醒

  try {
    return await verifyPermission(handle);
  } catch {
    return false; // handle 已作废（扩展重载等）
  }
}

// ---- 双向同步 ------------------------------------------------------------

/**
 * 全量双向同步：
 *   1. 读 JSON 文件 → 有外部变更则合并到 IndexedDB
 *   2. 导出 IndexedDB → 写入 JSON 文件
 *
 * 不预检权限（避免 SW 上下文 queryPermission 意外改变权限状态）。
 * createWritable() 在无权限时自然抛 NotAllowedError → 转为 SyncPermissionError。
 */
export async function syncNow(logPrefix = ''): Promise<void> {
  const handle = await getSyncHandle();
  if (!handle) {
    throw new Error('No sync file configured. Please select a file first.');
  }

  // Step 1: 读取 JSON 文件，合并外部变更（只读，无需写权限）
  await mergeFromFile(handle, logPrefix);

  // Step 2: 导出 IndexedDB → 写入 JSON 文件
  const data = await exportToJSON();
  const json = JSON.stringify(data, null, 2);

  try {
    const writer = await handle.createWritable();
    await writer.write(json);
    await writer.close();
  } catch (err) {
    if ((err as DOMException).name === 'NotAllowedError') {
      throw new SyncPermissionError();
    }
    throw err;
  }
}

/**
 * 读取同步文件，如有外部变更则合并到 IndexedDB。
 * 只读（getFile），不需要写权限。
 */
async function mergeFromFile(handle: FileSystemFileHandle, logPrefix: string): Promise<void> {
  try {
    const file = await handle.getFile();
    const fileText = await file.text();

    if (!fileText.trim()) return;

    const fileData: SyncFileFormat = JSON.parse(fileText);
    if (!fileData.version || !fileData.domains) return;

    // 始终执行逐记录 newer-wins 合并。
    // 不依赖 exported_at 跳过——用户可能手动编辑文件（不会更新 exported_at），
    // 每条记录自身的 updated 时间戳足以正确判断哪个版本更新。
    const result = await importFromJSON(fileData);
    if (result.imported > 0) {
      console.log(
        `[Web Notes] ${logPrefix}Merged ${result.imported} change(s) from sync file (${result.skipped} skipped)`,
      );
    }
  } catch (err) {
    console.debug('[Web Notes] Sync file merge skipped:', err);
  }
}

// ---- 启动/轮询时检查外部变更 --------------------------------------------

/**
 * SW 唤醒 / 定时轮询时调用：只读合并文件中的外部变更到 IndexedDB。
 *
 * 不检查写权限，只调用 getFile()（只读）。写入失败不影响合并。
 * 不修改同步模式。
 */
export async function checkSyncOnStartup(): Promise<void> {
  const mode = await getSyncMode();
  if (mode === 'off') return;

  const handle = await getSyncHandle();
  if (!handle) return;

  // 只读合并，不需要写权限
  await mergeFromFile(handle, 'Poll — ');
}

// ---- 便捷方法：仅在自动模式下写入 ----------------------------------------

/**
 * 如果同步模式为 'auto'，写回 JSON 文件。
 * 每次数据变更后调用。
 *
 * 权限不足时静默跳过。Sidebar 的定时轮询会检测并弹出授权框。
 */
export async function maybeSync(): Promise<void> {
  const mode = await getSyncMode();
  if (mode !== 'auto') return;

  try {
    await syncNow();
  } catch (err) {
    // 权限不足时静默跳过：数据已在 IndexedDB 中安全存储，
    // Sidebar 打开后 setInterval 轮询会检测权限并弹出授权框
    if (err instanceof SyncPermissionError) {
      console.debug('[Web Notes] Auto-sync skipped — permission not available');
      return;
    }
    console.warn('[Web Notes] Auto-sync failed:', err);
  }
}

// ---- 导出/导入 JSON 文件（手动备份/迁移）-------------------------------

/** 导出 IndexedDB 数据为 JSON 文件并触发浏览器下载。 */
export async function exportToFile(): Promise<void> {
  const data = await exportToJSON();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });

  const today = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `web-notes-${today}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 打开文件选择器，让用户选择 JSON 文件导入到 IndexedDB。
 *
 * 合并策略：newer-wins。同 id 的记录比较 updated 时间戳，
 * 已有较新记录不会被覆盖。
 *
 * @returns 导入统计，用户取消则返回 null
 */
export async function importFromFile(): Promise<{ imported: number; skipped: number } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      try {
        const text = await file.text();
        const data: SyncFileFormat = JSON.parse(text);

        if (!data.version || !data.domains) {
          throw new Error('Invalid file format: missing version or domains');
        }

        const result = await importFromJSON(data);

        // 导入后尝试同步写入
        await maybeSync();

        resolve(result);
      } catch (err) {
        reject(err);
      }
    };

    input.addEventListener('cancel', () => resolve(null));

    input.click();
  });
}
