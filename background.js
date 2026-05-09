// ─── Badge Helpers ───────────────────────────────────────────────────────────

async function updateBadge() {
  const { errorItems = [] } = await chrome.storage.local.get('errorItems');
  const count = errorItems.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#E53E3E' });
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

// ─── Track which tabs already have the content script injected ──────────────

const injectedTabs = new Set();

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

// ─── Message Router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startInspect') {
    handleStartInspect(message.tabId);
    sendResponse({ ok: true });
  }

  if (message.action === 'elementSelected') {
    handleElementSelected(message.data, sender).then(() => {
      sendResponse({ ok: true });
    });
    return true; // keep the message channel open for async response
  }

  if (message.action === 'getBadgeCount') {
    chrome.storage.local.get('errorItems').then(({ errorItems = [] }) => {
      sendResponse({ count: errorItems.length });
    });
    return true;
  }
});

// ─── Inspect Mode ───────────────────────────────────────────────────────────

async function handleStartInspect(tabId) {
  try {
    // Check if the tab URL is injectable (Chrome blocks certain pages)
    const tab = await chrome.tabs.get(tabId);
    const url = tab?.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || 
        url.startsWith('about:') || url.startsWith('edge://') ||
        url.includes('chromewebstore.google.com')) {
      console.warn('Cannot inject into restricted page:', url);
      return;
    }

    if (injectedTabs.has(tabId)) {
      chrome.tabs.sendMessage(tabId, { action: 'activateInspect' });
    } else {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      injectedTabs.add(tabId);
    }
  } catch (err) {
    console.error('Failed to inject content script:', err);
  }
}

// ─── Element Selected ───────────────────────────────────────────────────────

async function handleElementSelected(data, sender) {
  const { errorItems = [] } = await chrome.storage.local.get('errorItems');
  const tabId = sender?.tab?.id || data.tabId || null;

  const newItem = {
    id: crypto.randomUUID(),
    tabId: tabId,
    selector: data.selector,
    elementHTML: data.elementHTML,
    elementDescription: data.elementDescription,
    screenshotDataUrl: null,
    errorDescription: '',
    timestamp: Date.now(),
  };

  errorItems.push(newItem);
  await chrome.storage.local.set({ errorItems });
  await updateBadge();

  // Try to open the popup (MV3 — may silently fail if user hasn't interacted recently)
  try {
    await chrome.action.openPopup();
  } catch {
    // Fallback: nothing — user can click the icon
  }
}
