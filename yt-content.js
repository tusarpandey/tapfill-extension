(function () {
  'use strict';

  // Check if extension context is still valid
  try {
    chrome.runtime.getURL('');
  } catch (e) {
    console.log('[Tapfill-YT] extension context invalid — stopping');
    return;
  }

  // ─── Constants ────────────────────────────────────────────────────────────────
  const TAP_ROOT_ID = 'tap-root-yt';

  // ─── State ────────────────────────────────────────────────────────────────────
  let textboxFocused    = false;
  let lastInjectionTime = 0;
  let _tapDialog        = null;

  // ─── Token check ──────────────────────────────────────────────────────────────
  function getToken(cb) {
    chrome.storage.local.get('tapfill_token', (r) => {
      cb(r.tapfill_token?.access_token || null);
    });
  }

  // ─── Find YouTube comment box ─────────────────────────────────────────────────
  function findCommentBox() {
    return document.querySelector('#contenteditable-root[contenteditable="true"]')
      || document.querySelector('ytd-commentbox [contenteditable="true"]');
  }

  // ─── Find bottom action row ───────────────────────────────────────────────────
  function findActionRow() {
    const cancelBtn = document.querySelector(
      'ytd-commentbox #cancel-button, ytd-commentbox [aria-label="Cancel"]'
    );
    if (cancelBtn) return cancelBtn.parentElement;

    const commentBtn = document.querySelector(
      'ytd-commentbox #submit-button, ytd-commentbox [aria-label="Comment"]'
    );
    if (commentBtn) return commentBtn.parentElement;

    return null;
  }

  // ─── Remove existing T icon ───────────────────────────────────────────────────
  function removeTapRoot() {
    const existing = document.getElementById(TAP_ROOT_ID);
    if (existing) existing.remove();
  }

  // ─── Build T icon button ──────────────────────────────────────────────────────
  function buildTapButton() {
    const btn = document.createElement('div');
    btn.id    = TAP_ROOT_ID;
    btn.title = 'Tapfill — Comment Assistant';
    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      cursor: pointer;
      border-radius: 50%;
      background: transparent;
      border: none;
      padding: 4px;
      margin-right: 8px;
      flex-shrink: 0;
      vertical-align: middle;
      transition: background 0.15s;
    `;

    const img  = document.createElement('img');
    img.src    = chrome.runtime.getURL('icons/icon-48.png');
    img.width  = 24;
    img.height = 24;
    img.style.display = 'block';
    btn.appendChild(img);

    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(0,0,0,0.08)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleTapClick();
    });

    return btn;
  }

  // ─── Inject T icon into action row ────────────────────────────────────────────
  function injectTapRoot() {
    const now = Date.now();
    if (now - lastInjectionTime < 1000) return;

    const existing = document.getElementById(TAP_ROOT_ID);
    if (existing && existing.isConnected) return;
    if (existing) existing.remove();

    const actionRow = findActionRow();
    if (!actionRow) {
      console.log('[Tapfill-YT] action row not found');
      return;
    }

    _tapDialog = document.querySelector('ytd-commentbox') || document.body;

    const tapBtn = buildTapButton();
    actionRow.insertBefore(tapBtn, actionRow.firstChild);

    lastInjectionTime = now;
    console.log('[Tapfill-YT] T icon injected ✓');
  }

  // ─── Handle T icon click ──────────────────────────────────────────────────────
  function handleTapClick() {
    getToken((token) => {
      if (!token) {
        chrome.runtime.sendMessage({ type: 'OPEN_CONNECT' });
        return;
      }
      openTapfillPanel();
    });
  }

  // ─── Open Tapfill panel ───────────────────────────────────────────────────────
  function openTapfillPanel() {
    chrome.runtime.sendMessage({
      type:     'OPEN_PANEL',
      platform: 'youtube',
      url:      window.location.href,
      postText: scrapePostText(),
    });
  }

  // ─── Scrape post text ─────────────────────────────────────────────────────────
  function scrapePostText() {
    const title = document.querySelector(
      'h1.ytd-video-primary-info-renderer yt-formatted-string, ' +
      '#title h1 yt-formatted-string, ' +
      'ytd-video-primary-info-renderer h1'
    );
    if (title?.textContent?.trim()) {
      return title.textContent.trim();
    }

    const shortsTitle = document.querySelector(
      'ytd-reel-video-renderer[is-active] .title, #shorts-title'
    );
    if (shortsTitle?.textContent?.trim()) {
      return shortsTitle.textContent.trim();
    }

    return document.title || '';
  }

  // ─── Focus detection ──────────────────────────────────────────────────────────
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return;

    const isCommentBox = (
      target.id === 'contenteditable-root' ||
      !!target.closest('ytd-commentbox') ||
      (target.contentEditable === 'true' && !!target.closest('ytd-commentbox'))
    );
    if (!isCommentBox) return;

    textboxFocused = true;
    console.log('[Tapfill-YT] comment box focused');

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
      const active = document.activeElement;
      if (active?.id === TAP_ROOT_ID) return;
      if (active?.closest(`#${TAP_ROOT_ID}`)) return;
      if (active?.closest('ytd-commentbox')) return;

      textboxFocused = false;

      const tapRoot = document.getElementById(TAP_ROOT_ID);
      if (tapRoot) {
        tapRoot.style.opacity = '0';
        setTimeout(() => { if (!textboxFocused) removeTapRoot(); }, 300);
      }
    }, 200);
  }, true);

  // ─── Watch for dynamically loaded comment boxes ───────────────────────────────
  const pageObserver = new MutationObserver(() => {
    if (textboxFocused && !document.getElementById(TAP_ROOT_ID) && findCommentBox()) {
      injectTapRoot();
    }
  });

  pageObserver.observe(document.body, { childList: true, subtree: true });

  console.log('[Tapfill-YT] content script loaded ✓');
})();
