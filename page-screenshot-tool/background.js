/**
 * Page Screenshot Tool
 * Copyright (c) 2026 ELIEZER MAWULI JUNIOR. All rights reserved.
 *
 * Architecture blueprint:
 * Popup UI -> service worker -> active browser tab
 *                         |-> inject capture helper
 *                         `-> pace visible-tab PNG captures
 */

const RESTRICTED_PAGE = /^(chrome|edge|about|devtools|chrome-extension|edge-extension):/i;
const MIN_CAPTURE_INTERVAL_MS = 525;
let lastVisibleCaptureAt = 0;

function getErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");

  if (/cannot access|cannot be scripted|missing host permission|chrome web store/i.test(message)) {
    return "This browser-protected page cannot be captured as a full page. Try a regular website instead.";
  }
  if (/active tab|no tab with id|tab was closed|not found/i.test(message)) {
    return "The active tab changed or closed during capture. Return to the page and try again.";
  }
  return message;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || tab.windowId === undefined) {
    throw new Error("No active browser tab was found.");
  }
  return tab;
}

function assertFullPageAllowed(tab) {
  const url = tab.url || "";
  if (RESTRICTED_PAGE.test(url)) {
    throw new Error("Full-page capture is unavailable on browser settings, extension, and other protected pages.");
  }
  if (/^https:\/\/chromewebstore\.google\.com\//i.test(url)) {
    throw new Error("Chrome does not allow extensions to capture the Chrome Web Store as a full page.");
  }
  if (!/^(https?|file):/i.test(url)) {
    throw new Error("Full-page capture is only available on regular web pages and permitted local files.");
  }
}

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function assertTabIsStillActive(tabId, windowId) {
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (activeTab?.id !== tabId) {
    throw new Error("The active tab changed during capture. Keep the page selected until capture finishes.");
  }
}

async function captureVisiblePng(windowId) {
  // Chromium limits captureVisibleTab to two calls per second. Pacing here keeps
  // long, multi-tile captures reliable instead of intermittently hitting quota.
  const remainingDelay = MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastVisibleCaptureAt);
  if (remainingDelay > 0) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    lastVisibleCaptureAt = Date.now();
    return dataUrl;
  } catch (error) {
    // A prior capture from another extension context can consume Chromium's
    // global quota. One paced retry avoids failing the entire stitched image.
    if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|too many capture/i.test(String(error))) throw error;
    await new Promise((resolve) => setTimeout(resolve, MIN_CAPTURE_INTERVAL_MS));
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    lastVisibleCaptureAt = Date.now();
    return dataUrl;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "GET_ACTIVE_TAB": {
        const tab = await getActiveTab();
        return { id: tab.id, windowId: tab.windowId, url: tab.url || "", title: tab.title || "" };
      }

      case "CAPTURE_VISIBLE": {
        const tab = await getActiveTab();
        const dataUrl = await captureVisiblePng(tab.windowId);
        return { dataUrl, url: tab.url || "", title: tab.title || "" };
      }

      case "PREPARE_FULL_CAPTURE": {
        const tab = await getActiveTab();
        assertFullPageAllowed(tab);
        await ensureContentScript(tab.id);
        const metrics = await sendToTab(tab.id, { type: "PST_PREPARE" });
        return {
          tab: { id: tab.id, windowId: tab.windowId, url: tab.url || "", title: tab.title || "" },
          metrics
        };
      }

      case "STABILIZE_FULL_CAPTURE": {
        const { tabId, windowId } = message;
        await assertTabIsStillActive(tabId, windowId);
        const metrics = await sendToTab(tabId, { type: "PST_STABILIZE" });
        return { metrics };
      }

      case "CAPTURE_FULL_TILE": {
        const { tabId, windowId, tile } = message;
        await assertTabIsStillActive(tabId, windowId);
        const position = await sendToTab(tabId, { type: "PST_SCROLL", tile });
        await assertTabIsStillActive(tabId, windowId);
        const dataUrl = await captureVisiblePng(windowId);
        return { dataUrl, position };
      }

      case "RESTORE_CAPTURE": {
        if (message.tabId) {
          try {
            await sendToTab(message.tabId, { type: "PST_RESTORE" });
          } catch (_error) {
            // The tab may have closed or navigated; there is nothing left to restore.
          }
        }
        return { restored: true };
      }

      default:
        throw new Error("Unknown extension request.");
    }
  })()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));

  return true;
});
