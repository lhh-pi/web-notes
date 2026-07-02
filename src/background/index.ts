/**
 * Background Service Worker.
 *
 * 消息路由中枢：Content Script ↔ Background ↔ IndexedDB
 *
 * 职责：
 *   - 注册右键菜单（高亮、高亮+笔记、颜色选择）
 *   - Content Script 消息 → db.ts 调用 → 返回结果
 *   - 广播刷新消息给 Sidebar
 *   - 触发自动同步
 */

import * as db from '../shared/db';
import * as sync from '../shared/sync';
import type { BackgroundMessage, ContentMessage, Highlight, HighlightColor } from '../shared/types';

// ── Context menu setup ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'highlight',
    title: 'Highlight',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'highlight_note',
    title: 'Highlight & Add Note',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'highlight_color',
    title: 'Highlight (choose color)',
    contexts: ['selection'],
  });

  const colors: { id: string; title: string; color: HighlightColor }[] = [
    { id: 'hl_yellow', title: 'Yellow', color: 'yellow' },
    { id: 'hl_green', title: 'Green', color: 'green' },
    { id: 'hl_blue', title: 'Blue', color: 'blue' },
    { id: 'hl_red', title: 'Red', color: 'red' },
  ];

  for (const c of colors) {
    chrome.contextMenus.create({
      id: c.id,
      parentId: 'highlight_color',
      title: c.title,
      contexts: ['selection'],
    });
  }
});

// ── Context menu click handler ────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  const colorMap: Record<string, HighlightColor> = {
    hl_yellow: 'yellow',
    hl_green: 'green',
    hl_blue: 'blue',
    hl_red: 'red',
  };

  let action: string;
  let color: HighlightColor | undefined;

  if (info.menuItemId === 'highlight') {
    action = 'highlight';
  } else if (info.menuItemId === 'highlight_note') {
    action = 'highlight_note';
  } else if (info.menuItemId in colorMap) {
    action = 'highlight';
    color = colorMap[info.menuItemId as string];
  } else {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action, color }).catch(() => {
    console.debug('[Web Notes] Could not send message to tab', tab.id);
  });
});

// ── Message routing ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse) => {
    handleMessage(message, _sender)
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({ type: 'ERROR', message: err.message }));

    return true;
  },
);

async function handleMessage(
  message: ContentMessage,
  _sender: chrome.runtime.MessageSender,
): Promise<BackgroundMessage | Record<string, unknown>> {
  try {
    switch (message.type) {
      case 'GET_NOTES': {
        const data = await db.getNotes(message.url);
        return { type: 'NOTES_LOADED', data };
      }

      case 'CREATE_HIGHLIGHT': {
        // 生成 ID（UUID4 前 8 位，与旧 Python 后端一致）
        const id = crypto.randomUUID().slice(0, 8);

        const highlight: Highlight = {
          id,
          text: message.payload.text,
          color: message.payload.color,
          note: message.payload.note || '',
          anchor: message.payload.anchor,
          created: new Date().toISOString(),
        };

        const data = await db.saveHighlight(
          message.payload.url,
          message.payload.title,
          message.payload.domain,
          highlight,
        );

        maybeSyncWithWarning(_sender);

        // 广播刷新消息给 Sidebar
        chrome.runtime.sendMessage({ type: 'REFRESH_NOTES' }).catch(() => {});
        return { type: 'HIGHLIGHT_SAVED', data };
      }

      case 'UPDATE_HIGHLIGHT': {
        const data = await db.updateHighlight(
          message.url,
          message.highlightId,
          message.note,
          message.color,
        );

        maybeSyncWithWarning(_sender);
        chrome.runtime.sendMessage({ type: 'REFRESH_NOTES' }).catch(() => {});
        return { type: 'HIGHLIGHT_SAVED', data };
      }

      case 'DELETE_HIGHLIGHT': {
        await db.deleteHighlight(message.highlightId);

        maybeSyncWithWarning(_sender);
        chrome.runtime.sendMessage({ type: 'REFRESH_NOTES' }).catch(() => {});
        return { type: 'HIGHLIGHT_DELETED', highlightId: message.highlightId };
      }

      case 'SEARCH': {
        const results = await db.searchNotes(message.query);
        return {
          type: 'SEARCH_RESULTS',
          data: { query: message.query, count: results.length, results },
        };
      }

      case 'GET_DOMAINS': {
        const domains = await db.listDomains();
        return { type: 'DOMAINS_LIST', data: { domains } };
      }

      case 'OPEN_SIDEBAR':
        // 内容脚本请求打开侧边栏（用于 auto-sync 权限丢失弹窗的"授权"按钮）
        if (_sender.tab?.windowId) {
          chrome.sidePanel.open({ windowId: _sender.tab.windowId }).catch(() => {});
        }
        return { type: 'OK' };

      case 'SWITCH_TO_MANUAL':
        // 内容脚本请求切换到手动模式（用于 auto-sync 权限丢失弹窗的"切换手动"按钮）
        await sync.setSyncMode('manual');
        chrome.runtime.sendMessage({ type: 'SYNC_RESOLVED' }).catch(() => {});
        return { type: 'OK' };

      case 'BROKEN_HIGHLIGHTS':
        chrome.runtime.sendMessage({
          type: 'BROKEN_HIGHLIGHTS',
          url: message.url,
          brokenIds: message.brokenIds,
        }).catch(() => {});
        return { type: 'OK' };

      default:
        return { type: 'ERROR', message: `Unknown message type: ${(message as ContentMessage).type}` };
    }
  } catch (err) {
    return {
      type: 'ERROR',
      message: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ── Side panel click handler ──────────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  if (tab.id && tab.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
      chrome.action.setPopup({ popup: 'sidebar/index.html' });
    });
  }
});

// ── Sync helpers ──────────────────────────────────────────────────────

/**
 * Auto 模式下尝试写入同步文件。写入失败（权限不足）时通知当前页面。
 * 不在 SW 中预检权限——queryPermission 在 SW 上下文中可能意外改变权限状态。
 */
async function maybeSyncWithWarning(sender: chrome.runtime.MessageSender): Promise<void> {
  const mode = await sync.getSyncMode();
  if (mode !== 'auto') return;

  try {
    await sync.syncNow();
  } catch (err) {
    if (err instanceof sync.SyncPermissionError) {
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, { type: 'SYNC_WARNING' }).catch(() => {});
      }
    }
  }
}

// ── Initialize ────────────────────────────────────────────────────────

// SW 冷启动时只读合并一次外部变更
sync.checkSyncOnStartup().catch(() => {});
db.purgeExpired().catch(() => {});

// chrome.alarms 作为 SW 重启后的兜底（Chrome 最小 60s）
try {
  chrome.alarms.create('sync-check', { delayInMinutes: 0, periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sync-check') {
      sync.checkSyncOnStartup().catch(() => {});
      db.purgeExpired().catch(() => {});
    }
  });
} catch {
  // alarms API 不可用，静默跳过
}

console.log('[Web Notes] Background worker started');
