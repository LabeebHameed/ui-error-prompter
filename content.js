// ─── UI Error Prompter — Content Script ──────────────────────────────────────
// Injected programmatically by the background script.
// Enters inspect mode immediately upon injection, or re-activates via message.

(() => {
  // Guard: if already loaded in this context, just re-activate
  if (window.__uiErrorPrompterInjected) {
    if (typeof window.__uepActivateInspect === 'function') {
      window.__uepActivateInspect();
    }
    return;
  }
  window.__uiErrorPrompterInjected = true;

  // ─── State ──────────────────────────────────────────────────────────────────

  let isInspecting = false;
  let hoveredElement = null;
  let overlay = null;
  let tooltip = null;

  // ─── CSS Selector Generator ─────────────────────────────────────────────────

  function getUniqueSelector(element) {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    const path = [];
    let current = element;
    const MAX_DEPTH = 3;

    while (current && current !== document.body && current !== document.documentElement && path.length < MAX_DEPTH) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }

      // Add class names — skip Tailwind-style utility classes (contain colons, brackets, slashes)
      const classes = Array.from(current.classList)
        .filter(c => !c.startsWith('__') && c.length < 30 && !/[:\[\]\/]/.test(c) && !/^(flex|grid|relative|absolute|overflow|w-|h-|p-|m-|text-|font-|bg-|border|row-|col-|gap|items-|justify-|block|inline|hidden|contents|group)/.test(c))
        .slice(0, 2);
      if (classes.length > 0) {
        selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }

      // Only add nth-child if there are same-tag siblings and no distinguishing classes
      if (classes.length === 0) {
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
          if (siblings.length > 1) {
            selector += `:nth-child(${Array.from(parent.children).indexOf(current) + 1})`;
          }
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  // ─── Element Description ────────────────────────────────────────────────────

  function getElementDescription(el) {
    const tag = el.tagName.toLowerCase();
    const parts = [tag];

    // Add ID if present (most unique identifier)
    if (el.id) {
      parts[0] = `${tag}#${el.id}`;
    }

    // Gather identifying attributes
    const aria = el.getAttribute('aria-label');
    const title = el.getAttribute('title');
    const alt = el.getAttribute('alt');
    const placeholder = el.getAttribute('placeholder');
    const role = el.getAttribute('role');
    const name = el.getAttribute('name');
    const type = el.getAttribute('type');

    // For inputs/selects, show type and name/placeholder
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (type) parts.push(`type="${type}"`);
      if (name) parts.push(`name="${name}"`);
      if (placeholder) parts.push(`placeholder: "${placeholder.slice(0, 30)}"`);
      if (el.value) parts.push(`value: "${el.value.slice(0, 20)}"`);
      return parts.join(', ');
    }

    // For images
    if (tag === 'img') {
      if (alt) parts.push(`alt: "${alt.slice(0, 40)}"`);
      const src = el.getAttribute('src') || '';
      const filename = src.split('/').pop()?.split('?')[0] || '';
      if (filename) parts.push(`src: "${filename.slice(0, 30)}"`);
      return parts.join(', ');
    }

    // Add role if meaningful
    if (role && role !== 'presentation') parts.push(`role="${role}"`);

    // Prefer aria-label/title (most descriptive)
    if (aria) {
      parts.push(`"${aria.slice(0, 40)}"`);
      return parts.join(' — ');
    }
    if (title) {
      parts.push(`title: "${title.slice(0, 40)}"`);
      return parts.join(' — ');
    }

    // Get direct text content (not from deeply nested children)
    const directText = getDirectText(el).slice(0, 40);
    if (directText) {
      parts.push(`"${directText}"`);
      return parts.join(' — ');
    }

    // Check for SVG/icon inside (common for icon buttons)
    const hasSvg = el.querySelector('svg');
    const hasImg = el.querySelector('img');
    if (hasSvg) {
      // Try to identify the SVG by its aria-label or nearby text
      const svgLabel = hasSvg.getAttribute('aria-label') || hasSvg.getAttribute('title') || '';
      parts.push(svgLabel ? `svg icon "${svgLabel}"` : 'contains svg icon');
    } else if (hasImg) {
      const imgAlt = hasImg.getAttribute('alt') || '';
      parts.push(imgAlt ? `image "${imgAlt.slice(0, 30)}"` : 'contains image');
    }

    // If still generic, try to add positional context
    if (parts.length === 1) {
      // Look for nearest heading or label
      const parent = el.closest('section, article, nav, header, footer, form, [role="dialog"]');
      if (parent) {
        const parentTag = parent.tagName.toLowerCase();
        const parentLabel = parent.getAttribute('aria-label') || parent.id || '';
        parts.push(parentLabel ? `inside ${parentTag} "${parentLabel}"` : `inside ${parentTag}`);
      }
    }

    return parts.join(' — ');
  }

  // Get only the direct text of an element (not text from nested children)
  function getDirectText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  // ─── Tooltip Tag Label ──────────────────────────────────────────────────────

  function getTagLabel(el) {
    const tag = el.tagName.toLowerCase();
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return `${tag}${cls}`;
  }

  // ─── Create Overlay & Tooltip ───────────────────────────────────────────────

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = '__uep-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '2147483646',
      cursor: 'crosshair',
      pointerEvents: 'none',
    });
    document.documentElement.appendChild(overlay);

    tooltip = document.createElement('div');
    tooltip.id = '__uep-tooltip';
    Object.assign(tooltip.style, {
      position: 'fixed',
      zIndex: '2147483647',
      background: '#1A1A2E',
      color: '#fff',
      fontSize: '11px',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      padding: '4px 8px',
      borderRadius: '4px',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      display: 'none',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      border: '1px solid rgba(229, 62, 62, 0.4)',
    });
    document.documentElement.appendChild(tooltip);
  }

  function removeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (tooltip) { tooltip.remove(); tooltip = null; }
  }

  // ─── Highlight Helpers ──────────────────────────────────────────────────────

  function highlightElement(el) {
    if (el === overlay || el === tooltip) return;
    el.style.outline = '2px solid #E53E3E';
    el.style.backgroundColor = 'rgba(229, 62, 62, 0.08)';
    el.dataset.__uepHighlighted = '1';
  }

  function unhighlightElement(el) {
    if (el && el.dataset && el.dataset.__uepHighlighted) {
      el.style.outline = '';
      el.style.backgroundColor = '';
      delete el.dataset.__uepHighlighted;
    }
  }

  // ─── Event Handlers ────────────────────────────────────────────────────────

  function onMouseMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === tooltip || el === document.documentElement || el === document.body) {
      return;
    }

    if (el !== hoveredElement) {
      if (hoveredElement) unhighlightElement(hoveredElement);
      hoveredElement = el;
      highlightElement(el);

      // Update tooltip content
      tooltip.textContent = getTagLabel(el);
    }

    // Position tooltip near cursor
    tooltip.style.display = 'block';
    const tx = e.clientX + 14;
    const ty = e.clientY + 14;
    tooltip.style.left = `${Math.min(tx, window.innerWidth - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${Math.min(ty, window.innerHeight - tooltip.offsetHeight - 8)}px`;
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = hoveredElement || document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === tooltip) return;

    // Capture data
    const selector = getUniqueSelector(el);
    const rawHTML = el.outerHTML || '';
    const elementHTML = rawHTML.length > 500 ? rawHTML.slice(0, 500) + '…' : rawHTML;
    const elementDescription = getElementDescription(el);

    // Clean up
    deactivateInspect();

    // Send to background
    chrome.runtime.sendMessage({
      action: 'elementSelected',
      data: {
        selector,
        elementHTML,
        elementDescription,
        tabId: null,
      },
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      deactivateInspect();
    }
  }

  // ─── Activate / Deactivate ─────────────────────────────────────────────────

  function activateInspect() {
    if (isInspecting) return;
    isInspecting = true;

    createOverlay();

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function deactivateInspect() {
    if (!isInspecting) return;
    isInspecting = false;

    if (hoveredElement) {
      unhighlightElement(hoveredElement);
      hoveredElement = null;
    }

    removeOverlay();

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  // ─── Listen for re-activation messages ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'activateInspect') {
      activateInspect();
    }
  });

  // ─── Start immediately on injection ────────────────────────────────────────
  window.__uepActivateInspect = activateInspect;
  activateInspect();
})();
