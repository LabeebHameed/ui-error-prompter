// ─── UI Error Prompter — Popup Script ────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

// ─── DOM References ──────────────────────────────────────────────────────────

const viewEmpty = $('#viewEmpty');
const viewList = $('#viewList');
const viewPrompt = $('#viewPrompt');
const viewApiKey = $('#viewApiKey');

const headerCount = $('#headerCount');
const errorList = $('#errorList');

const btnSelectEmpty = $('#btnSelectEmpty');
const btnSelectMore = $('#btnSelectMore');
const btnBuildPrompt = $('#btnBuildPrompt');
const btnCopy = $('#btnCopy');
const btnStartOver = $('#btnStartOver');
const btnSaveApiKey = $('#btnSaveApiKey');

const promptLoading = $('#promptLoading');
const promptResult = $('#promptResult');
const promptOutput = $('#promptOutput');
const promptError = $('#promptError');
const apiKeyInput = $('#apiKeyInput');
const apiKeyError = $('#apiKeyError');

// ─── State ───────────────────────────────────────────────────────────────────

let currentView = 'empty'; // 'empty' | 'list' | 'prompt' | 'apikey'
let pendingBuild = false;

// ─── View Switching ──────────────────────────────────────────────────────────

function showView(view) {
  currentView = view;
  viewEmpty.classList.toggle('hidden', view !== 'empty');
  viewList.classList.toggle('hidden', view !== 'list');
  viewPrompt.classList.toggle('hidden', view !== 'prompt');
  viewApiKey.classList.toggle('hidden', view !== 'apikey');
}

// ─── Render ──────────────────────────────────────────────────────────────────

async function render() {
  const { errorItems = [] } = await chrome.storage.local.get('errorItems');

  if (currentView === 'prompt' || currentView === 'apikey') return;

  if (errorItems.length === 0) {
    showView('empty');
    headerCount.classList.add('hidden');
    return;
  }

  showView('list');
  headerCount.textContent = `${errorItems.length} error${errorItems.length !== 1 ? 's' : ''}`;
  headerCount.classList.remove('hidden');
  btnBuildPrompt.disabled = errorItems.length === 0;

  // Check if errors span multiple tabs
  const tabIds = [...new Set(errorItems.map(e => e.tabId).filter(Boolean))];
  const multiTab = tabIds.length > 1;

  errorList.innerHTML = '';

  errorItems.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'error-card fade-in';

    let tabLabel = '';
    if (multiTab && item.tabId) {
      tabLabel = `<span class="error-card-tab">Tab ${item.tabId}</span>`;
    }

    card.innerHTML = `
      <div class="error-card-header">
        <div>
          <div class="error-card-label">${escapeHTML(item.elementDescription)}</div>
          ${tabLabel}
        </div>
        <button class="btn-remove" data-id="${item.id}" title="Remove error">✕</button>
      </div>
      <textarea
        class="error-textarea"
        data-id="${item.id}"
        rows="2"
        placeholder="Describe the error…"
      >${escapeHTML(item.errorDescription || '')}</textarea>
    `;

    errorList.appendChild(card);
  });

  // Bind remove buttons
  errorList.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeItem(btn.dataset.id));
  });

  // Bind textarea blur to save
  errorList.querySelectorAll('.error-textarea').forEach((ta) => {
    ta.addEventListener('blur', () => saveDescription(ta.dataset.id, ta.value));
  });
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function startInspect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage({ action: 'startInspect', tabId: tab.id });
  window.close();
}

async function removeItem(id) {
  const { errorItems = [] } = await chrome.storage.local.get('errorItems');
  const updated = errorItems.filter((e) => e.id !== id);
  await chrome.storage.local.set({ errorItems: updated });
  await updateBadge(updated.length);
  render();
}

async function saveDescription(id, value) {
  const { errorItems = [] } = await chrome.storage.local.get('errorItems');
  const item = errorItems.find((e) => e.id === id);
  if (item) {
    item.errorDescription = value;
    await chrome.storage.local.set({ errorItems });
  }
}

async function updateBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#E53E3E' });
}

// ─── Build Prompt ────────────────────────────────────────────────────────────

async function buildPrompt() {
  const { openRouterApiKey } = await chrome.storage.local.get('openRouterApiKey');

  if (!openRouterApiKey) {
    pendingBuild = true;
    showView('apikey');
    return;
  }

  showView('prompt');
  promptLoading.classList.remove('hidden');
  promptResult.classList.add('hidden');
  promptError.classList.add('hidden');

  const { errorItems = [] } = await chrome.storage.local.get('errorItems');

  const errorsText = errorItems
    .map(
      (e, i) =>
        `${i + 1}. Element: ${e.elementDescription}\nSelector: ${e.selector}\nHTML: ${e.elementHTML}\nIssue: ${e.errorDescription || '(no description provided)'}`
    )
    .join('\n\n');

  const systemPrompt = `You will receive UI errors with element descriptions, CSS selectors, and HTML. Rewrite them into a precise, actionable prompt for an AI coding assistant. Rules:

- Include BOTH: a human-readable description of the element AND its CSS selector path in parentheses.
- Example: "1. The 'Retry' button in the error state section (\`div.error-state > button.retry-btn\`) — change the reload icon to a ring icon."
- Use the HTML to understand what the element actually is, then describe it clearly.
- Keep each issue to one or two concise lines.
- End with: "Fix all the issues listed above."
- No introductions, no preamble, no markdown wrappers. Start directly with issue 1.`;

  const userMessage = errorsText;

  try {
    const MODEL_ID = 'google/gemini-2.5-flash-lite';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterApiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_ID,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || 'No response received.';

    promptLoading.classList.add('hidden');
    promptResult.classList.remove('hidden');
    promptOutput.value = text;
  } catch (err) {
    promptLoading.classList.add('hidden');
    promptError.classList.remove('hidden');
    promptError.innerHTML = `<div class="error-message">${escapeHTML(err.message)}</div>
      <button class="btn btn-secondary btn-full" id="btnRetry">Retry</button>
      <button class="btn btn-secondary btn-full" style="margin-top:6px" id="btnBackFromError">Back</button>`;

    $('#btnRetry')?.addEventListener('click', buildPrompt);
    $('#btnBackFromError')?.addEventListener('click', () => render());
  }
}

// ─── API Key Save ────────────────────────────────────────────────────────────

async function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    apiKeyError.textContent = 'Please enter a valid API key.';
    apiKeyError.classList.remove('hidden');
    return;
  }

  await chrome.storage.local.set({ openRouterApiKey: key });
  apiKeyError.classList.add('hidden');

  if (pendingBuild) {
    pendingBuild = false;
    buildPrompt();
  } else {
    render();
  }
}

// ─── Copy to Clipboard ──────────────────────────────────────────────────────

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(promptOutput.value);
    const original = btnCopy.textContent;
    btnCopy.textContent = 'Copied!';
    setTimeout(() => { btnCopy.textContent = original; }, 1500);
  } catch {
    // Fallback
    promptOutput.select();
    document.execCommand('copy');
  }
}

// ─── Start Over ──────────────────────────────────────────────────────────────

async function startOver() {
  await chrome.storage.local.set({ errorItems: [] });
  await updateBadge(0);
  render();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

btnSelectEmpty.addEventListener('click', startInspect);
btnSelectMore.addEventListener('click', startInspect);
btnBuildPrompt.addEventListener('click', buildPrompt);
btnCopy.addEventListener('click', copyPrompt);
btnStartOver.addEventListener('click', startOver);
btnSaveApiKey.addEventListener('click', saveApiKey);

// Enter key on API key input
apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveApiKey();
});

// ─── Init ────────────────────────────────────────────────────────────────────

render();
