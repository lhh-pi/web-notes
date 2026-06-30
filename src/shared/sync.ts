/**
 * 文件同步层
 *
 * 使用 File System Access API（Chrome 86+ / Edge 86+）将 IndexedDB
 * 数据同步到本地 JSON 文件。配合 OneDrive / iCloud 等云盘客户端
 * 实现跨设备同步。
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
// 这些类型不在默认 TypeScript DOM lib 中，需要手动声明。

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemFileHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    createWritable(): Promise<FileSystemWritableFileStream>;
    readonly name: string;
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: string | Blob | ArrayBuffer): Promise<void>;
    close(): Promise<void>;
  }
}

// Augment the global Window interface with showSaveFilePicker
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

// ---- 同步模式管理 --------------------------------------------------------

/** 获取当前同步模式。 */
export async function getSyncMode(): Promise<SyncMode> {
  const mode = await getSetting<string>(SETTING_SYNC_MODE);
  return (mode as SyncMode) || 'off';
}

/** 设置同步模式。 */
export async function setSyncMode(mode: SyncMode): Promise<void> {
  await setSetting(SETTING_SYNC_MODE, mode);
}

// ---- 选择同步文件 --------------------------------------------------------

/**
 * 打开文件选择器，让用户选择或创建 JSON 文件作为同步目标。
 * 选中后立即执行一次全量写入。
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
    await syncNow();

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

// ---- 写入同步文件 --------------------------------------------------------

/**
 * 全量写入 IndexedDB 数据到同步 JSON 文件。
 *
 * 如果文件权限丢失（如文件被移动/删除），抛出错误提示用户重新选择文件。
 */
export async function syncNow(): Promise<void> {
  const handle = await getSyncHandle();
  if (!handle) {
    throw new Error('No sync file configured. Please select a file first.');
  }

  const writable = await verifyPermission(handle);
  if (!writable) {
    // 清除失效的 handle，提示用户重新选择
    await setSetting(SETTING_SYNC_HANDLE, null);
    throw new Error('Sync file access lost. The file may have been moved or deleted. Please re-select the file.');
  }

  const data = await exportToJSON();
  const json = JSON.stringify(data, null, 2);

  const writer = await handle.createWritable();
  await writer.write(json);
  await writer.close();
}

/** 验证并请求文件写入权限。 */
async function verifyPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };

  if ((await handle.queryPermission(opts)) === 'granted') {
    return true;
  }

  return (await handle.requestPermission(opts)) === 'granted';
}

// ---- 便捷方法：仅在自动模式下写入 ----------------------------------------

/**
 * 如果当前同步模式为 'auto'，则自动写回 JSON 文件。
 * 适用于每次数据变更后调用。写入失败静默处理（不打断用户操作）。
 */
export async function maybeSync(): Promise<void> {
  const mode = await getSyncMode();
  if (mode !== 'auto') return;

  try {
    await syncNow();
  } catch (err) {
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
 * 打开文件选择器，让用户选择 JSON 文件导入。
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

        // 导入后触发自动同步
        await maybeSync();

        resolve(result);
      } catch (err) {
        reject(err);
      }
    };

    // 用户取消文件选择
    input.addEventListener('cancel', () => resolve(null));

    input.click();
  });
}
