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
    const commentBox = document.querySelector('ytd-commentbox');
    if (!commentBox) return null;

    // Primary: footer div is the full-width row with empty left space + buttons right
    const footer = commentBox.querySelector('#footer, div#footer');
    if (footer) {
      const r = footer.getBoundingClientRect();
      if (r.width > 0 && r.top > 0) return footer;
    }

    // Fallback: buttons container's parent
    const buttons = commentBox.querySelector('#buttons');
    if (buttons) return buttons.parentElement;

    // Fallback: walk up from cancel button to first wide container
    const cancelBtn = commentBox.querySelector('#cancel-button');
    if (cancelBtn) {
      let el = cancelBtn.parentElement;
      while (el && el !== commentBox) {
        const r = el.getBoundingClientRect();
        if (r.width > 300 && r.height > 0 && r.top > 0) return el;
        el = el.parentElement;
      }
    }

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
      width: 36px;
      height: 36px;
      cursor: pointer;
      border-radius: 50%;
      background: transparent;
      border: none;
      padding: 0;
      margin: 0;
      flex-shrink: 0;
      vertical-align: middle;
      transition: background 0.2s;
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
      handleTapClick(btn);
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

    const tapBtn = buildTapButton();
    tapBtn._tapDialog = document.querySelector('ytd-commentbox') || document.body;
    actionRow.insertBefore(tapBtn, actionRow.firstChild);

    lastInjectionTime = now;
    console.log('[Tapfill-YT] T icon injected ✓');
  }

  // ─── Scrape YouTube video title ───────────────────────────────────────────────
  function scrapePostText() {
    const selectors = [
      'ytd-video-primary-info-renderer h1 yt-formatted-string',
      '#title h1 yt-formatted-string',
      '#title yt-formatted-string',
      'h1.ytd-watch-metadata',
      '#above-the-fold #title',
      'ytd-watch-metadata h1',
      '.ytd-video-primary-info-renderer h1',
      'h1[class*="title"]',
    ];
    for (const sel of selectors) {
      const el   = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 3) {
        console.log('[Tapfill-YT] title found via:', sel, '→', text.substring(0, 50));
        return text;
      }
    }
    // Fallback: document.title minus " - YouTube" suffix
    const docTitle = document.title.replace(/\s*[-–]\s*YouTube\s*$/, '').trim();
    if (docTitle && docTitle.length > 3) {
      console.log('[Tapfill-YT] using document.title:', docTitle.substring(0, 50));
      return docTitle;
    }
    // Shorts fallback
    const shortsTitle = document.querySelector(
      'ytd-reel-video-renderer[is-active] .title, #shorts-title, ytd-shorts h2'
    );
    if (shortsTitle?.textContent?.trim()) return shortsTitle.textContent.trim();

    console.log('[Tapfill-YT] no title found');
    return 'YouTube video';
  }

  // ─── Fetch YouTube video thumbnail as base64 ─────────────────────────────────
  async function fetchYouTubeThumbnail() {
    try {
      let videoId = null;
      const urlParams = new URLSearchParams(window.location.search);
      videoId = urlParams.get('v');
      if (!videoId && window.location.pathname.includes('/shorts/')) {
        videoId = window.location.pathname.split('/shorts/')[1]?.split('?')[0];
      }
      if (!videoId) {
        console.log('[Tapfill-YT] no video ID found');
        return null;
      }
      console.log('[Tapfill-YT] fetching thumbnail for:', videoId);
      const thumbnailUrls = [
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      ];
      for (const url of thumbnailUrls) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          const blob = await response.blob();
          if (blob.size < 5000) continue;
          const base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
          console.log('[Tapfill-YT] thumbnail fetched:', Math.round(blob.size / 1024) + 'KB', url);
          return base64;
        } catch (err) {
          console.log('[Tapfill-YT] thumbnail URL failed:', url);
          continue;
        }
      }
      console.log('[Tapfill-YT] all thumbnail URLs failed');
      return null;
    } catch (err) {
      console.error('[Tapfill-YT] thumbnail fetch error:', err);
      return null;
    }
  }

  // ─── Handle T icon click ──────────────────────────────────────────────────────
  function handleTapClick(btn) {
    getToken(async (token) => {
      if (!token) {
        chrome.runtime.sendMessage({ type: 'OPEN_CONNECT' });
        return;
      }
      btn._tapPostText  = scrapePostText();
      btn._tapPlatform  = 'youtube';
      console.log('[Tapfill-YT] postText:', btn._tapPostText.substring(0, 60));
      console.log('[Tapfill-YT] fetching YouTube thumbnail...');
      const thumbnailData = await fetchYouTubeThumbnail();
      btn._tapImageData = thumbnailData || null;
      btn._tapImageMode = thumbnailData ? 'image+text' : 'image-only';
      console.log('[Tapfill-YT] imageData:', thumbnailData
        ? 'YES (' + Math.round(thumbnailData.length / 1024) + 'KB)'
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

    const isCommentBox = (
      target.id === 'contenteditable-root' ||
      !!target.closest('#contenteditable-root') ||
      (target.tagName === 'YT-FORMATTED-STRING' && !!target.closest('ytd-commentbox')) ||
      !!target.closest('ytd-commentbox [contenteditable="true"]') ||
      !!target.closest('ytd-commentbox')?.querySelector('#contenteditable-root')
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
