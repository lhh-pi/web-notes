/**
 * Background Service Worker.
 *
 * Acts as the bridge between:
 *   - Content Scripts (web page injection)
 *   - Sidebar (extension side panel)
 *   - Python Backend (localhost HTTP API)
 *
 * Responsibilities:
 *   - Register and handle right-click context menu items
 *   - Route messages between content scripts and the Python API
 *   - Cache the current tab URL for the sidebar
 */

import * as api from '../shared/api';
import type { BackgroundMessage, ContentMessage, HighlightColor } from '../shared/types';

// ── Context menu setup ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Highlight (no note)
  chrome.contextMenus.create({
    id: 'highlight',
    title: 'Highlight',
    contexts: ['selection'],
  });

  // Highlight with note
  chrome.contextMenus.create({
    id: 'highlight_note',
    title: 'Highlight & Add Note',
    contexts: ['selection'],
  });

  // Color sub-menu
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

  // Send the action to the content script in the active tab
  chrome.tabs.sendMessage(tab.id, { action, color }).catch(() => {
    // Content script may not be loaded (e.g., chrome:// pages)
    console.debug('[Web Notes] Could not send message to tab', tab.id);
  });
});

// ── Message routing ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, sender, sendResponse) => {
    // Handle messages from content scripts and sidebar
    handleMessage(message, sender)
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({ type: 'ERROR', message: err.message }));

    return true; // Keep channel open for async response
  },
);

async function handleMessage(
  message: ContentMessage,
  _sender: chrome.runtime.MessageSender,
): Promise<BackgroundMessage | Record<string, unknown>> {
  try {
    switch (message.type) {
      case 'GET_NOTES': {
        console.log('[Web Notes BG] GET_NOTES for:', message.url);
        const data = await api.getNotes(message.url);
        console.log('[Web Notes BG] GET_NOTES result highlights:', data?.highlights?.length || 0);
        return { type: 'NOTES_LOADED', data };
      }

      case 'CREATE_HIGHLIGHT': {
        const data = await api.createHighlight(message.payload);
        // Broadcast to sidebar so it refreshes in real time
        chrome.runtime.sendMessage({ type: 'REFRESH_NOTES' }).catch(() => {});
        return { type: 'HIGHLIGHT_SAVED', data };
      }

      case 'UPDATE_HIGHLIGHT': {
        const data = await api.updateHighlight(
          message.url,
          message.highlightId,
          message.note,
          message.color,
        );
        chrome.runtime.sendMessage({ type: 'REFRESH_NOTES' }).catch(() => {});
        return { type: 'HIGHLIGHT_SAVED', data };
      }

      case 'DELETE_HIGHLIGHT': {
        await api.deleteHighlight(message.url, message.highlightId);
        chrome.runtime.sendMessage({ type: 'REFRESH_NOTES' }).catch(() => {});
        return { type: 'HIGHLIGHT_DELETED', highlightId: message.highlightId };
      }

      case 'SEARCH': {
        const data = await api.searchNotes(message.query);
        return { type: 'SEARCH_RESULTS', data };
      }

      case 'GET_DOMAINS': {
        const data = await api.listDomains();
        return { type: 'DOMAINS_LIST', data };
      }

      case 'EXPORT': {
        const markdown = await api.exportNotes(message.domain);
        // Return the markdown text directly to the sidebar
        return { type: 'SEARCH_RESULTS', data: { query: '', count: 0, results: [] }, exportText: markdown };
      }

      case 'BROKEN_HIGHLIGHTS':
        // Forward to sidebar so it can mark broken cards
        chrome.runtime.sendMessage({ type: 'BROKEN_HIGHLIGHTS', url: message.url, brokenIds: message.brokenIds }).catch(() => {});
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
  // The side panel is opened via the action API (Chrome 114+)
  // For older versions, this falls back to the popup
  if (tab.id && tab.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
      // sidePanel API not available, fall back to popup behavior
      chrome.action.setPopup({ popup: 'sidebar/index.html' });
    });
  }
});

// Log that the worker is alive (useful for debugging)
console.log('[Web Notes] Background worker started');
