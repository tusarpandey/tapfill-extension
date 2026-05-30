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

  // ─── Scrape tweet image ───────────────────────────────────────────────────────
  async function scrapeTweetImage() {
    try {
      const allImages = document.querySelectorAll('img[src*="pbs.twimg.com"]');
      const mediaImages = [...allImages].filter(img => {
        const src = img.src;
        if (src.includes('profile_images')) return false;
        if (src.includes('/media/')) return true;
        if (src.includes('amplify_video_thumb')) return true;
        if (src.includes('ext_tw_video_thumb')) return true;
        return false;
      });

      if (mediaImages.length === 0) {
        console.log('[Tapfill-X] no tweet media found');
        return null;
      }

      let bestImage = mediaImages[0];
      let bestSize  = bestImage.naturalWidth * bestImage.naturalHeight;
      for (const img of mediaImages) {
        const size = img.naturalWidth * img.naturalHeight;
        if (size > bestSize) { bestSize = size; bestImage = img; }
      }

      console.log('[Tapfill-X] best image:', bestImage.src.substring(0, 60),
        bestImage.naturalWidth + 'x' + bestImage.naturalHeight);

      let imageUrl = bestImage.src;
      imageUrl = imageUrl.replace('name=medium', 'name=large')
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

      console.log('[Tapfill-X] image fetched:', Math.round(blob.size / 1024) + 'KB');
      return base64;
    } catch (err) {
      console.error('[Tapfill-X] image fetch error:', err);
      return null;
    }
  }

  // ─── Find reply toolbar emoji button ─────────────────────────────────────────
  function findToolbar() {
    const emojiBtn = document.querySelector('[aria-label="Add emoji"], [data-testid="emoji"]');
    if (emojiBtn) {
      const r = emojiBtn.getBoundingClientRect();
      if (r.width > 0 && r.top > 0) return emojiBtn;
    }
    return null;
  }

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
      cursor: pointer;
      border-radius: 50%;
      background: transparent;
      padding: 0;
      margin-left: 2px;
      flex-shrink: 0;
      transition: background 0.15s;
      position: relative;
      z-index: 999999;
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

  // ─── Inject T icon after emoji button ─────────────────────────────────────────
  function injectTapRoot() {
    const now = Date.now();
    if (now - lastInjectionTime < 1000) return;

    const existing = document.getElementById(TAP_ROOT_ID);
    if (existing && existing.isConnected) return;
    if (existing) existing.remove();

    const emojiBtn = findToolbar();
    if (!emojiBtn) {
      console.log('[Tapfill-X] emoji button not found');
      return;
    }

    const tapBtn = buildTapButton();
    emojiBtn.insertAdjacentElement('afterend', tapBtn);
    lastInjectionTime = now;
    console.log('[Tapfill-X] T icon injected ✓');
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

    const isReplyBox = (
      target.getAttribute('data-testid') === 'tweetTextarea_0' ||
      (target.getAttribute('role') === 'textbox' &&
        !!target.closest('[data-testid="tweetTextarea_0"]')) ||
      !!target.closest('[data-testid="tweetTextarea_0"]')
    );
    if (!isReplyBox) return;

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
      const active = document.activeElement;
      if (active?.id === TAP_ROOT_ID) return;
      if (active?.closest(`#${TAP_ROOT_ID}`)) return;
      if (active?.closest('[data-testid="tweetTextarea_0"]')) return;

      textboxFocused = false;
      const tapRoot = document.getElementById(TAP_ROOT_ID);
      if (tapRoot) {
        tapRoot.style.opacity = '0';
        setTimeout(() => { if (!textboxFocused) tapRoot?.remove(); }, 300);
      }
    }, 200);
  }, true);

  // ─── Watch for dynamically loaded reply boxes ─────────────────────────────────
  const pageObserver = new MutationObserver(() => {
    if (textboxFocused && !document.getElementById(TAP_ROOT_ID) && findToolbar()) {
      injectTapRoot();
    }
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });

  console.log('[Tapfill-X] content script loaded ✓');
})();
