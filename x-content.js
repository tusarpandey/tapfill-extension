(function () {
  'use strict';

  try {
    chrome.runtime.getURL('');
  } catch (e) {
    console.log('[Tapfill-X] extension context invalid — stopping');
    return;
  }

  // ─── Constants ────────────────────────────────────────────────────────────────
  const TAP_ROOT_ID = 'tap-root-x';

  // ─── State ────────────────────────────────────────────────────────────────────
  let textboxFocused    = false;
  let lastInjectionTime = 0;

  // ─── Token check ──────────────────────────────────────────────────────────────
  function getToken(cb) {
    chrome.storage.local.get('tapfill_token', (r) => {
      cb(r.tapfill_token?.access_token || null);
    });
  }

  // ─── Scrape tweet text being replied to ──────────────────────────────────────
  function scrapeTweetText() {
    const tweetTexts = document.querySelectorAll('[data-testid="tweetText"]');
    if (tweetTexts.length > 0) {
      const text = tweetTexts[0].textContent?.trim();
      if (text) {
        console.log('[Tapfill-X] tweet text:', text.substring(0, 80));
        return text;
      }
    }
    const langEl = document.querySelector('[data-testid="tweet"] [lang]');
    if (langEl?.textContent?.trim()) return langEl.textContent.trim();
    return '';
  }

  // ─── Scrape tweet image (dialog-scoped only) ─────────────────────────────────
  async function scrapeTweetImage() {
    try {
      const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
      if (!dialog) return null;

      const mediaImages = [...dialog.querySelectorAll(
        'img[src*="pbs.twimg.com/media/"],' +
        'img[src*="amplify_video_thumb"],' +
        'img[src*="ext_tw_video_thumb"]'
      )].filter(img =>
        !img.src.includes('profile_images') &&
        img.naturalWidth > 100 && img.naturalHeight > 100
      );

      console.log('[Tapfill-X] media in dialog:', mediaImages.length);
      if (mediaImages.length === 0) return null;

      const best = mediaImages.reduce((a, b) =>
        (a.naturalWidth * a.naturalHeight) > (b.naturalWidth * b.naturalHeight) ? a : b
      );

      const imageUrl = best.src.replace('name=medium', 'name=large')
                                .replace('name=small',  'name=large');
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error('fetch failed');
      const blob = await response.blob();
      if (blob.size < 5000) return null;

      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });

      console.log('[Tapfill-X] image:', Math.round(blob.size / 1024) + 'KB');
      return base64;
    } catch (err) {
      console.error('[Tapfill-X] image error:', err);
      return null;
    }
  }

  // ─── Paste text into X reply box (async, React-compatible) ───────────────────
  async function pasteIntoXReplyBox(text) {
    const replyBox = document.querySelector('[data-testid="tweetTextarea_0"]');
    if (!replyBox) return;

    replyBox.focus();
    await new Promise(r => setTimeout(r, 150));

    const sel   = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(replyBox);
    sel.removeAllRanges();
    sel.addRange(range);
    await new Promise(r => setTimeout(r, 50));

    document.execCommand('delete', false, null);
    await new Promise(r => setTimeout(r, 50));

    document.execCommand('insertText', false, text);
    await new Promise(r => setTimeout(r, 100));

    ['input', 'change', 'keyup'].forEach(type =>
      replyBox.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
    );

    replyBox.focus();
    console.log('[Tapfill-X] paste complete');
  }

  // Expose for fb-content.js shared panel
  window._tapfillXPaste = pasteIntoXReplyBox;

  // ─── Build T icon ─────────────────────────────────────────────────────────────
  function buildTapButton() {
    const btn = document.createElement('div');
    btn.id    = TAP_ROOT_ID;
    btn.title = 'Tapfill — Comment Assistant';
    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      min-width: 34px;
      cursor: pointer;
      border-radius: 50%;
      background: transparent;
      padding: 0;
      margin: 0 2px;
      flex-shrink: 0;
      align-self: center;
      transition: background 0.15s;
    `;

    const img  = document.createElement('img');
    img.src    = chrome.runtime.getURL('icons/icon-48.png');
    img.width  = 22;
    img.height = 22;
    img.style.display = 'block';
    btn.appendChild(img);

    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(29,161,242,0.1)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleTapClick(btn);
    });

    return btn;
  }

  // ─── Inject T icon inline in the toolbar row ──────────────────────────────────
  function injectTapRoot() {
    const now = Date.now();
    if (now - lastInjectionTime < 1000) return;

    const existing = document.getElementById(TAP_ROOT_ID);
    if (existing && existing.isConnected) return;
    if (existing) existing.remove();

    const flagBtn = document.querySelector(
      '[data-testid="contentDisclosureButton"],' +
      '[aria-label="Content disclosure"]'
    );
    if (!flagBtn) {
      console.log('[Tapfill-X] flag button not found');
      return;
    }
    const r = flagBtn.getBoundingClientRect();
    if (r.width === 0 || r.top === 0) return;

    // Walk UP 4 levels to reach the main horizontal toolbar row:
    // Level 0: BUTTON (flag)
    // Level 1: DIV wrapper
    // Level 2: DIV column (flex-column, 2 children)
    // Level 3: DIV wrapper
    // Level 4: DIV flexDirection:row, 8 children ← toolbar row
    let toolbarRow = flagBtn;
    for (let i = 0; i < 4; i++) {
      toolbarRow = toolbarRow?.parentElement;
    }
    if (!toolbarRow) {
      console.log('[Tapfill-X] toolbar row not found');
      return;
    }

    console.log('[Tapfill-X] toolbar row children:', toolbarRow.children.length,
      'display:', window.getComputedStyle(toolbarRow).display);

    // Level 3 is the direct child of the toolbar row that contains the flag
    let flagWrapper = flagBtn;
    for (let i = 0; i < 3; i++) {
      flagWrapper = flagWrapper?.parentElement;
    }

    const tapBtn = buildTapButton();
    flagWrapper.insertAdjacentElement('afterend', tapBtn);
    lastInjectionTime = now;
    console.log('[Tapfill-X] T icon injected inline ✓');
  }

  // ─── Handle T icon click ──────────────────────────────────────────────────────
  function handleTapClick(btn) {
    getToken(async (token) => {
      if (!token) {
        chrome.runtime.sendMessage({ type: 'OPEN_CONNECT' });
        return;
      }

      btn.style.opacity = '0.5';
      const postText  = scrapeTweetText();
      const imageData = await scrapeTweetImage();
      btn.style.opacity = '1';

      btn._tapPostText  = postText;
      btn._tapPlatform  = 'twitter';
      btn._tapImageData = imageData || null;

      if (imageData && postText)   btn._tapImageMode = 'image+text';
      else if (imageData)          btn._tapImageMode = 'image-only';
      else                         btn._tapImageMode = 'text-only';

      // Attach dialog context for popup positioning
      btn._tapDialog = document.querySelector('[data-testid="tweetTextarea_0"]')
        ?.closest('[role="dialog"]') || document.body;

      console.log('[Tapfill-X] postText:', postText.substring(0, 50));
      console.log('[Tapfill-X] imageData:', imageData
        ? 'YES (' + Math.round(imageData.length / 1024) + 'KB)'
        : 'NO');

      if (typeof window._tapfillOpen === 'function') {
        window._tapfillOpen(btn);
      }
    });
  }

  // ─── Focus detection ──────────────────────────────────────────────────────────
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (!target) return;

    const isReplyTextarea = (
      target.getAttribute('data-testid') === 'tweetTextarea_0' ||
      target.closest('[data-testid="tweetTextarea_0"]')
        ?.getAttribute('data-testid') === 'tweetTextarea_0'
    );
    if (!isReplyTextarea) return;

    // Only inject when a reply dialog is actually open
    const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
    if (!dialog) return;

    textboxFocused = true;
    console.log('[Tapfill-X] reply box focused');

    [300, 600, 1000].forEach(delay => {
      setTimeout(() => {
        if (!textboxFocused) return;
        const existing = document.getElementById(TAP_ROOT_ID);
        if (existing && existing.isConnected) return;
        injectTapRoot();
      }, delay);
    });
  }, true);

  // ─── Focusout ─────────────────────────────────────────────────────────────────
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      // Keep T icon while reply dialog is still open
      const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
      if (dialog) return;

      const active = document.activeElement;
      if (active?.id === TAP_ROOT_ID) return;
      if (active?.closest(`#${TAP_ROOT_ID}`)) return;
      if (active?.closest('[data-testid="tweetTextarea_0"]')) return;

      textboxFocused = false;
      const tapRoot = document.getElementById(TAP_ROOT_ID);
      if (tapRoot) {
        tapRoot.style.opacity = '0';
        setTimeout(() => { if (!textboxFocused) tapRoot?.remove(); }, 500);
      }
    }, 500);
  }, true);

  // ─── Watch for dynamically loaded reply boxes ─────────────────────────────────
  const pageObserver = new MutationObserver(() => {
    if (textboxFocused && !document.getElementById(TAP_ROOT_ID) &&
        document.querySelector('[data-testid="contentDisclosureButton"],[aria-label="Content disclosure"]')) {
      injectTapRoot();
    }
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });

  console.log('[Tapfill-X] content script loaded ✓');
})();
