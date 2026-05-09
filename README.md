# Error Prompter

A Chrome Extension that turns visual UI bug-hunting into structured, copy-paste-ready prompts for AI coding assistants.

**Point at what's broken → describe the issue → get a prompt that tells your AI exactly what to fix and where.**

---

## The Problem

Every developer and designer has the same workflow when they find UI bugs:

1. Spot the issue on a live page
2. Open DevTools, dig through the DOM to find the element
3. Copy the selector, screenshot it, write up what's wrong
4. Switch to their AI assistant, type out the context from memory
5. Realize they forgot the selector, go back to DevTools...

This loop is slow, error-prone, and breaks your focus. The gap between *seeing* a bug and *communicating* it to an AI is unnecessarily wide.

## What This Does

UI Error Prompter collapses that loop into three clicks:

1. **Click "Select Error Item"** — the extension enters inspect mode on the active page
2. **Click any element** — it captures the element's identity (tag, aria-label, text content, icon type), a short CSS selector path, and the raw HTML
3. **Describe what's wrong** — type "change icon to ring" or "text is truncated" in the popup
4. **Click "Build Prompt"** — an AI (Gemini 2.5 Flash via OpenRouter) compiles everything into a single, precise, actionable prompt

The output is a clean prompt you paste into any AI coding assistant — Claude, Cursor, Copilot, whatever. Each issue includes a human-readable description of the element *and* its structural selector path so the agent knows exactly what it is and where to find it.

### Example Output

```
1. The 'Retry' button with a reload icon (div.error-state > button.retry-btn) — change the reload icon to a ring icon.

2. The "Sign Up" heading in the hero section (section.hero > h1) — text reads "$5 one-time developer registra", should be "$5 one-time developer registration fee".

Fix all the issues listed above.
```

## How It Works

```
┌──────────┐     startInspect     ┌──────────────┐    executeScript    ┌─────────────┐
│  Popup   │ ──────────────────►  │  Background  │  ────────────────►  │  Content.js │
│  (UI)    │                      │  (Service    │                     │  (Injected  │
│          │  ◄────────────────── │   Worker)    │  ◄────────────────  │   into tab) │
│          │   elementSelected    │              │   elementSelected   │             │
└──────────┘                      └──────────────┘                     └─────────────┘
     │                                   │
     │  Build Prompt                     │  chrome.storage.local
     ▼                                   │  (errorItems array)
┌──────────┐                             │
│OpenRouter│                             │
│ API      │                             │
│ (Gemini) │                             │
└──────────┘                             │
```

### Inspect Mode
- Hover over any element → red outline + tooltip showing tag/class
- Click to capture → grabs a smart element description, short CSS selector (max 3 levels), and trimmed HTML
- Press Escape to cancel

### Smart Element Identification
The extension doesn't just dump CSS classes. It builds a meaningful description by checking (in priority order):
1. Element ID
2. `aria-label`, `title`, `alt` attributes
3. Direct text content (not nested children)
4. SVG/icon detection with label lookup
5. Input type, name, placeholder
6. Positional context (nearest semantic parent)

### Selector Generation
Selectors are capped at 3 levels deep and filter out noise (Tailwind utility classes, layout primitives). Only adds `:nth-child` when there are no distinguishing class names.

## Install

1. Clone this repo
2. Open `chrome://extensions/` → enable **Developer mode**
3. Click **Load unpacked** → select the project folder
4. Click the extension icon on any webpage to start

### API Key Setup
On first "Build Prompt", you'll be asked for an [OpenRouter API key](https://openrouter.ai/keys). It's stored locally in `chrome.storage.local` and never leaves your browser.

## File Structure

```
├── manifest.json      # MV3 manifest
├── background.js      # Service worker — messaging, badge, injection
├── content.js         # Injected into pages — inspect mode & element capture
├── popup.html         # Popup shell
├── popup.js           # Popup logic — CRUD, API calls, clipboard
├── popup.css          # Dark theme UI
└── icons/             # Extension icons (16, 32, 48, 128px)
```

## Stack

- **Vanilla JS** — no frameworks, no build step, no dependencies
- **Chrome Extension Manifest V3**
- **Gemini 2.5 Flash Lite** via OpenRouter API
- **chrome.storage.local** for persistence


Built for the [Activate AI Fellows Program](https://www.activate.build/) — Summer 2026.
