// ==UserScript==
// @name         Tapfill – Facebook Comment Assistant
// @namespace    https://tapfill.io
// @version      3.0.0
// @description  Injects an AI comment-assistant button into every Facebook comment dialog.
// @author       Tapfill
// @match        https://www.facebook.com/*
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Config ───────────────────────────────────────────────────────────────────
  //
  //  AI model via Mistral — API key is stored securely in background.js only.

  // (model handled server-side via Tapfill SaaS)

  // ─── Constants ────────────────────────────────────────────────────────────────

  const TAP_ROOT_ID = 'tap-root';
  const TAP_MENU_ID = 'tap-menu';
  const STICKER_SEL = '[aria-label="Comment with a sticker"], [aria-label="Comment with a Sticker"]';
  const TEXTBOX_SEL = '[contenteditable="true"][role="textbox"]';

  // Temperature mapping:
  //   low  (0.2) → precise, formal output
  //   mid  (0.5) → balanced
  //   high (0.9) → high-variance, creative, witty
  const TONES = [
    { emoji: '🎩', label: 'Classic',   desc: 'Polished and timeless.',            tone: 'classic',      temp: 0.2 },
    { emoji: '🌻', label: 'Warm',      desc: 'Genuine. Heart-first.',             tone: 'friendly',     temp: 0.5 },
    { emoji: '💎', label: 'Confident', desc: 'Direct. Clear. No second-guessing.', tone: 'supportive',  temp: 0.3 },
    { emoji: '😄', label: 'Witty',     desc: 'Sharp edge, light touch.',          tone: 'funny',        temp: 0.9 },
    { emoji: '🎬', label: 'Filmy',     desc: 'Full cinematic. Dramatic flair.',   tone: 'filmy',        temp: 0.8 },
  ];

  const CREATOR_TONES = [
    { emoji: '🔥', label: 'Savage',     desc: 'Zero filter. High impact.',   tone: 'savage',    temp: 0.9, tonePrompt: 'Write a brutally honest, sharp comment with zero filter. Makes a strong point, leaves a mark, but stays within respectful limits. High impact and memorable.' },
    { emoji: '🧘', label: 'Wise',       desc: 'Deep insight. Quotable.',     tone: 'wise',      temp: 0.4, tonePrompt: 'Write a thoughtful, philosophical comment like a mentor speaking. Deep insight, quotable, the kind of comment people screenshot and share.' },
    { emoji: '💫', label: 'Hype',       desc: 'High energy. Celebratory.',   tone: 'hype',      temp: 0.9, tonePrompt: 'Write an energetic, enthusiastic comment full of excitement. Like a best friend cheering someone on. High energy, motivating, celebratory.' },
    { emoji: '😏', label: 'Sarcastic',  desc: 'Dry. Clever. Smart.',         tone: 'sarcastic', temp: 0.8, tonePrompt: 'Write a dry, clever, subtly sarcastic comment. The kind that makes people laugh and think at the same time. Smart sarcasm, not mean or offensive.' },
    { emoji: '🌶️', label: 'Desi',       desc: 'Indian humor. Relatable.',    tone: 'desi',      temp: 0.9, tonePrompt: 'Write a funny, relatable, quintessentially Indian humor comment. Use cultural references, Indian expressions, light sarcasm. The kind of comment that makes an Indian say yaar yeh toh bilkul sach hai.' },
  ];

  let _userPlan = 'free';
  // Load immediately and keep in sync
  chrome.storage.local.get('tapfill_user', (r) => { _userPlan = r.tapfill_user?.plan || 'free'; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tapfill_user) _userPlan = changes.tapfill_user.newValue?.plan || 'free';
  });
  // Helper: always read fresh from storage before building menu
  async function getUserPlan() {
    // Read all possible storage keys at once
    const stored = await new Promise(resolve =>
      chrome.storage.local.get(['tapfill_user', 'tapfill_token'], resolve)
    );
    const cachedPlan = stored.tapfill_user?.plan;
    const token      = stored.tapfill_token?.access_token;

    console.log('[Tapfill] getUserPlan cached:', cachedPlan, '| token:', token ? 'yes' : 'no');

    // If we have a token, always fetch fresh plan from API
    if (token) {
      try {
        const res = await fetch('https://tapfill-saas.vercel.app/api/ext/profile', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          console.log('[Tapfill] getUserPlan API returned:', data.plan);
          if (data.plan) {
            // Always persist so future calls use cached value
            const existing = stored.tapfill_user || {};
            chrome.storage.local.set({ tapfill_user: { ...existing, plan: data.plan, email: data.email } });
            return data.plan;
          }
        }
      } catch (e) {
        console.warn('[Tapfill] getUserPlan API fetch failed:', e);
      }
    }

    // No token — extension not connected, show connect prompt
    if (!token) {
      console.warn('[Tapfill] Not connected — no token in storage. Please connect via popup.');
    }

    return cachedPlan || 'free';
  }

  let _selectedLanguage = 'english';
  chrome.storage.local.get('tapfill_language', (r) => { _selectedLanguage = r.tapfill_language || 'english'; });
  let _toneOrder = [];
  chrome.storage.local.get('tapfill_tone_order', (r) => { _toneOrder = r.tapfill_tone_order || []; });

  // ─── Devanagari → Hinglish (Roman) transliteration ───────────────────────────
  // Hinglish = Hindi phonetics written in Roman letters — no extra API call needed.
  function devanagariToHinglish(text) {
    const C = { // consonants
      'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng',
      'च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
      'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n',
      'त':'t','थ':'th','द':'d','ध':'dh','न':'n',
      'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m',
      'य':'y','र':'r','ल':'l','व':'v',
      'श':'sh','ष':'sh','स':'s','ह':'h','ळ':'l',
      'क़':'q','ख़':'kh','ग़':'gh','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f',
    };
    const M = { // dependent vowel signs (matras)
      'ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo',
      'ृ':'ri','े':'e','ै':'ai','ो':'o','ौ':'au','ॉ':'o','ॅ':'e',
    };
    const V = { // independent vowels
      'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo',
      'ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऋ':'ri','ऑ':'o',
    };
    const VIRAMA = '्';
    const chars = [...text];
    let out = '', i = 0;
    while (i < chars.length) {
      const c = chars[i];
      if (C[c] !== undefined) {
        const next = chars[i + 1];
        if (next === VIRAMA) {
          out += C[c]; i += 2;
        } else if (M[next] !== undefined) {
          out += C[c] + M[next]; i += 2;
        } else {
          const end = !next || /[ \n.,!?;:()\[\]"'—\-]/.test(next);
          out += C[c] + (end ? '' : 'a'); i++;
        }
        if (chars[i] === 'ं' || chars[i] === 'ँ') { out += 'n'; i++; }
        else if (chars[i] === 'ः') { out += 'h'; i++; }
      } else if (V[c] !== undefined) {
        out += V[c]; i++;
        if (chars[i] === 'ं' || chars[i] === 'ँ') { out += 'n'; i++; }
        else if (chars[i] === 'ः') { out += 'h'; i++; }
      } else if (c === 'ं' || c === 'ँ') { out += 'n'; i++;
      } else if (c === 'ः') { out += 'h'; i++;
      } else if (c === '।' || c === '॥') { out += '.'; i++;
      } else if (c >= '०' && c <= '९') { out += String.fromCharCode(c.charCodeAt(0) - 0x0966 + 48); i++;
      } else { out += c; i++; }
    }
    return out;
  }
  function transliterateVariants(variants) {
    return {
      subtle:   devanagariToHinglish(variants.subtle   || ''),
      balanced: devanagariToHinglish(variants.balanced || ''),
      bold:     devanagariToHinglish(variants.bold     || ''),
      powerful: devanagariToHinglish(variants.powerful || ''),
    };
  }

  // ─── Spinner keyframe (injected once into <head>) ─────────────────────────────

  function injectStyles() {
    if (document.getElementById('tap-styles')) return;
    const s = document.createElement('style');
    s.id = 'tap-styles';
    s.textContent = [
      '@keyframes tap-spin{to{transform:rotate(360deg)}}',
      '@keyframes tap-vibe-pulse{0%,100%{opacity:0.45;text-shadow:0 0 6px rgba(99,102,241,0.4)}50%{opacity:1;text-shadow:0 0 18px rgba(99,102,241,0.85),0 0 36px rgba(129,140,248,0.5)}}',
      '.tap-vibe-text{font-size:13px;font-weight:600;color:#6366f1;animation:tap-vibe-pulse 1.4s ease-in-out infinite;letter-spacing:0.01em}',
      '@keyframes tap-word-magic{' +
        /* word starts edge-on (90°) — invisible, with a sparkle burst */
        '0%{opacity:0.2;transform:perspective(360px) rotateY(90deg) scale(1.18);' +
          'text-shadow:0 0 4px #fff,0 0 14px #818cf8,0 0 28px rgba(129,140,248,0.7),' +
            '3px -4px 7px rgba(255,255,255,0.95),-4px 3px 6px rgba(167,139,250,0.85),' +
            '4px 4px 8px rgba(196,181,253,0.7),-2px -3px 5px rgba(255,255,255,0.8);' +
          'filter:brightness(3)}' +
        /* swings past zero — slight overshoot */
        '50%{opacity:1;transform:perspective(360px) rotateY(-12deg) scale(1.05);' +
          'text-shadow:0 0 7px rgba(99,102,241,0.55);filter:brightness(1.3)}' +
        /* bounces back to just above zero */
        '75%{transform:perspective(360px) rotateY(5deg) scale(1.01);' +
          'text-shadow:0 0 3px rgba(99,102,241,0.2);filter:brightness(1.08)}' +
        /* settles flat */
        '100%{opacity:1;transform:perspective(360px) rotateY(0deg) scale(1);' +
          'text-shadow:none;filter:brightness(1)}' +
      '}',
      '.tap-word-magic{display:inline-block;animation:tap-word-magic 0.55s cubic-bezier(0.34,1.45,0.64,1) both}',
      // Sparkle particles shot from the word centre outward via CSS custom props
      '@keyframes tap-spark-out{' +
        '0%{opacity:1;transform:translate(-50%,-50%) translate(0,0) scale(1)}' +
        '80%{opacity:0.6}' +
        '100%{opacity:0;transform:translate(-50%,-50%) translate(var(--tx),var(--ty)) scale(0)}' +
      '}',
    ].join('');
    document.head.appendChild(s);
  }

  // ─── Tapfill logo (height 18, auto width) ────────────────────────────────────

  const LOGO_URL = chrome.runtime.getURL('icons/icon-48.png');

  // ─── React-compatible text insertion ─────────────────────────────────────────

  function insertTextReact(textbox, text) {
    textbox.focus();
    textbox.innerHTML = text;

    const sel   = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textbox);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);

    textbox.dispatchEvent(
      new InputEvent('input', {
        bubbles:    true,
        cancelable: true,
        composed:   true,
        data:       text,
        inputType:  'insertText',
      })
    );
  }

  // ─── Locate the closest enclosing comment dialog ──────────────────────────────

  function resolveDialog(element) {
    return (
      element.closest('[role="dialog"]') ||
      element.closest('form')            ||
      element.closest('[data-pagelet]')  ||
      document.body
    );
  }

  // ─── Post text scraper ────────────────────────────────────────────────────────
  //
  //  Extracts the parent post's text so the AI can write a contextually relevant
  //  comment.  Three strategies in order of specificity:
  //    1. Explicit Facebook post-message attributes
  //    2. [dir="auto"] nodes with substantial text, minus the comment-box subtree
  //    3. Returns '' — the API will still work but without post context

  function scrapePostText(dialog) {
    // Find the nearest article/post container — this scopes ALL searches to the
    // current post only, preventing text from nearby posts bleeding in.
    const textbox = dialog.querySelector(TEXTBOX_SEL);
    const article = (
      dialog.closest('[role="article"]') ||
      dialog.closest('[data-pagelet]')   ||
      textbox?.closest('[role="article"]') ||
      textbox?.closest('[data-pagelet]')   ||
      dialog
    );

    // Strategy 1 — known Facebook post message selectors, scoped to article
    for (const sel of [
      '[data-ad-preview="message"]',
      '[data-testid="post_message"]',
      '[data-ad-comet-preview="message"]',
    ]) {
      const el = article.querySelector(sel);
      if (!el) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (t && t.length > 5) {
        console.log('[Tapfill] scrapePostText S1 (' + sel + '):', t.slice(0, 80));
        return t.slice(0, 1000);
      }
    }

    // Returns true if text looks like a Facebook internal token/hash, not real language.
    // Real sentences: multiple short words, mostly letters, natural spacing.
    // Tokens: very long "words", digits mixed into letters, no sentence structure.
    function looksLikeToken(t) {
      const words = t.split(/\s+/).filter(w => w.length > 0);
      if (!words.length) return true;
      // If any single word is longer than 20 chars and contains digits → token
      if (words.some(w => w.length > 20 && /\d/.test(w))) return true;
      // Average word length > 15 → almost certainly not natural language
      const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
      if (avgLen > 15) return true;
      // Fewer than 2 real letter-only words of length 2+ → not a sentence
      const realWords = words.filter(w => /^[\p{L}]{2,}$/u.test(w));
      if (realWords.length < 2) return true;
      return false;
    }

    // Strategy 2 — [dir="auto"] blocks WITHIN the article only
    const cands = [...article.querySelectorAll('[dir="auto"]')]
      .filter(el =>
        !el.contains(textbox) &&
        !textbox?.contains(el) &&
        !el.closest('[aria-label*="comment" i]') &&
        !el.closest('[data-testid*="comment" i]') &&
        !el.closest('form')
      )
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(t => t.length > 30 && !looksLikeToken(t));

    if (cands.length) {
      console.log('[Tapfill] scrapePostText S2 (' + cands.length + ' cands):', cands[0].slice(0, 80));
      return cands[0].slice(0, 1000);
    }

    // Strategy 3 — nothing found in this post (e.g. cover photo with no caption)
    console.log('[Tapfill] scrapePostText: no text in post (image-only or cover photo)');
    return '';
  }

  // ─── Optimization helpers ──────────────────────────────────────────────────
  //
  //  Opt-1: scrapePostText already excludes existing comments (fixed above).
  //  Opt-2: smart image sending — count meaningful caption words to decide
  //         whether to include the post image in the API request.

  // Count words that remain after stripping emojis, hashtags, @mentions, URLs.
  function countMeaningfulWords(text) {
    if (!text) return 0;
    const cleaned = text
      .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, ' ')
      .replace(/#\S+/g, ' ')
      .replace(/@\S+/g, ' ')
      .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned ? cleaned.split(' ').filter(w => w.length > 1).length : 0;
  }

  // Facebook post image selectors (tried in order).
  const FB_IMG_SELS = [
    '[data-visualcompletion="media-vc-image"] img',
    'img[data-imgperflogname="homefeed_image"]',
    '[role="dialog"] img[src*="scontent"]:not([alt=""])',
  ];

  // Fetch image, resize to ≤512 px, return JPEG data URL. Returns null on any failure.
  async function extractPostImage(selectors, root) {
    let imgEl = null;

    // Strategy 1: known selectors within dialog root
    for (const sel of selectors) {
      const el = (root || document).querySelector(sel);
      if (el?.src && !el.src.startsWith('data:') && !el.src.startsWith('blob:')
          && el.naturalWidth >= 100) {
        imgEl = el; break;
      }
    }

    // Strategy 2: walk up DOM from _menuActiveDialog to find the post image container
    // This handles permalink pages where the image is outside the comment dialog
    if (!imgEl && _menuActiveDialog) {
      let node = _menuActiveDialog.parentElement;
      for (let level = 0; level < 10 && node && node !== document.body; level++) {
        const imgs = [...node.querySelectorAll('img[src*="scontent"]')]
          .filter(el =>
            el.src && !el.src.startsWith('data:') && !el.src.startsWith('blob:') &&
            !el.src.includes('emg1') && !el.src.includes('/t13/') &&
            !el.closest('[aria-label*="comment" i]') &&
            !el.closest('form') &&
            el.naturalWidth >= 200
          );
        if (imgs.length) {
          // Pick the largest area image found at this DOM level
          imgEl = imgs.reduce((b, e) =>
            (e.naturalWidth * e.naturalHeight) > (b.naturalWidth * b.naturalHeight) ? e : b,
            imgs[0]
          );
          console.log('[Tapfill] extractPostImage S2 level=' + level + ':', imgEl.src.slice(0, 80), imgEl.naturalWidth + 'x' + imgEl.naturalHeight);
          break;
        }
        node = node.parentElement;
      }
    }

    console.log('[Tapfill] extractPostImage final:', imgEl ? imgEl.src.slice(0, 80) + ' (' + imgEl.naturalWidth + 'x' + imgEl.naturalHeight + ')' : 'none');
    if (!imgEl) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(imgEl.src, { mode: 'cors', signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size > 5_000_000) return null;
      const blobUrl = URL.createObjectURL(blob);
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 512;
          const scale = Math.min(1, MAX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const cv = document.createElement('canvas');
          cv.width  = Math.round(img.naturalWidth  * scale);
          cv.height = Math.round(img.naturalHeight * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(blobUrl);
          const dataUrl = cv.toDataURL('image/jpeg', 0.8);
          console.log('[Tapfill] 📷 image encoded:', cv.width + 'x' + cv.height + ' → ' + Math.round(dataUrl.length / 1024) + ' KB base64');
          resolve(dataUrl);
        };
        img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(null); };
        img.src = blobUrl;
      });
    } catch { return null; }
  }

  // ─── Filmy tone enrichment ────────────────────────────────────────────────
  //
  //  Fetches this week's Bollywood data and builds an enriched tonePrompt.
  //  Falls back to a generic Bollywood prompt if the endpoint is unreachable.

  const FILMY_DATA_URL = 'https://tapfill.io/api/filmy-data';

  async function getFilmyTonePrompt() {
    try {
      const res = await fetch(FILMY_DATA_URL, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { movies } = await res.json();
      if (!movies?.length) throw new Error('empty');

      const movieBlocks = movies.map(m => {
        const lines = [`Movie: ${m.movie_name}`];
        if (m.lead_actors?.length)      lines.push(`Stars: ${m.lead_actors.join(', ')}`);
        if (m.popular_dialogues?.length) lines.push(`Popular dialogues:\n${m.popular_dialogues.map(d => `  "${d}"`).join('\n')}`);
        if (m.popular_songs?.length)    lines.push(`Songs: ${m.popular_songs.join(', ')}`);
        if (m.viral_punch_words?.length) lines.push(`Viral phrases: ${m.viral_punch_words.join(', ')}`);
        if (m.mood)  lines.push(`Mood: ${m.mood}`);
        if (m.style) lines.push(`Style: ${m.style}`);
        return lines.join('\n');
      }).join('\n\n');

      return (
        `Generate a comment in Filmy Bollywood style.\n\n` +
        `This week's latest Bollywood releases:\n\n` +
        `${movieBlocks}\n\n` +
        `Use the energy, dialogues and references from these latest movies to craft a comment that feels current and cinematic.\n` +
        `Make it feel like this week's Bollywood — not old references.\n` +
        `The comment should naturally reference one of these movies or their style.\n` +
        `Keep it under 50 words.\n` +
        `Sound like a real fan commenting — not an AI.`
      );
    } catch {
      return (
        `Generate a comment in Filmy Bollywood style.\n` +
        `Use classic Bollywood references, dramatic dialogues, and cinematic energy.\n` +
        `Make it feel like a movie scene.\n` +
        `Keep it under 50 words.`
      );
    }
  }

  // ─── Gemini API call ─────────────────────────────────────────────────────────
  //
  //  Facebook's CSP blocks direct fetch() to googleapis.com, so we dispatch
  //  through whichever escape hatch is available:
  //
  //    1. Chrome extension context  → chrome.runtime.sendMessage → background.js
  //    2. Tampermonkey / Greasemonkey → GM_xmlhttpRequest (cross-origin capable)
  //    3. Fallback                  → direct fetch (works only outside FB CSP)

  // Returns { variants, commentId } via the Tapfill SaaS backend.
  // variants = { subtle, balanced, bold, powerful }
  async function generateAllVariants(postText, toneObj) {
    // Hinglish = transliterate Hindi client-side — always call API with 'hindi'
    const language = _selectedLanguage === 'hinglish' ? 'hindi' : _selectedLanguage;

    // ── Filmy tone enrichment (Bollywood agent) ───────────────────────────
    if (toneObj.label === 'Filmy') {
      toneObj = { ...toneObj, tonePrompt: await getFilmyTonePrompt() };
    }

    // ── Opt-2: smart image sending ──────────────────────────────────────────
    const wordCount = countMeaningfulWords(postText);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[Tapfill] 🤖 GENERATING COMMENT');
    console.log('  postText  :', postText || '(none)');
    console.log('  tone      :', toneObj.tone, '|', toneObj.label);
    console.log('  language  :', language);
    console.log('  wordCount :', wordCount);
    let imageMode = 'text-only';
    let imageData  = null;
    if (wordCount > 20) {
      imageMode = 'text-only';
      console.log(`[Tapfill] text-only mode — caption has ${wordCount} words`);
    } else if (wordCount >= 1) {
      imageMode = 'image+text';
      console.log(`[Tapfill] image+text mode — caption has ${wordCount} words`);
      imageData = await extractPostImage(FB_IMG_SELS, _menuActiveDialog || document);
      if (!imageData) { console.log('[Tapfill] image extraction failed — falling back to text only'); imageMode = 'text-only'; }
    } else {
      imageMode = 'image-only';
      console.log('[Tapfill] image-only mode — no meaningful caption found');
      imageData = await extractPostImage(FB_IMG_SELS, _menuActiveDialog || document);
      if (!imageData) { console.log('[Tapfill] image extraction failed — falling back to text only'); imageMode = 'text-only'; }
    }

    console.log('  imageMode :', imageMode);
    console.log('  imageData :', imageData ? `yes (${imageData.length} chars)` : 'no');
    console.log('  tonePrompt:', toneObj.tonePrompt ? `yes (${toneObj.tonePrompt.length} chars)` : 'no');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'AI_FETCH' });
      let settled = false;
      port.onMessage.addListener((response) => {
        if (settled) return; settled = true;
        port.disconnect();
        if (response?.notConnected) {
          return reject(Object.assign(new Error('NOT_CONNECTED'), { notConnected: true }));
        }
        if (response?.rateLimit) {
          return reject(Object.assign(new Error('RATE_LIMIT'), { rateLimit: true }));
        }
        if (!response?.ok) {
          const msg = response?.detail
            ? `${response.error} | ${response.detail}`
            : (response?.error || 'AI request failed');
          return reject(new Error(msg));
        }
        if (response.imageDescription) {
          console.log('[Tapfill] 🖼️  IMAGE SEEN BY AI:', response.imageDescription);
        }
        resolve({ variants: response.variants, commentId: response.commentId || null, toneOrder: response.toneOrder || null });
      });
      port.onDisconnect.addListener(() => {
        if (settled) return; settled = true;
        reject(new Error(chrome.runtime.lastError?.message || 'Port disconnected'));
      });
      port.postMessage({ type: 'GENERATE', postText, tone: toneObj.tone, platform: 'facebook', language, tonePrompt: toneObj.tonePrompt || null, imageMode, imageData });
    });
  }

  // ─── Sparkle burst — tiny DOM particles shot from a word's centre ────────────

  function spawnSparkles(span) {
    const rect = span.getBoundingClientRect();
    if (!rect.width) return; // element not yet laid out
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;

    // 8 particles at evenly-spread angles with alternating wobble — all deterministic
    const palette = ['#818cf8','#a78bfa','#c4b5fd','#ffffff','#6366f1','#ddd6fe','#e0e7ff','#f5f3ff'];
    const N = 8;
    for (let k = 0; k < N; k++) {
      const baseAngle = (360 / N) * k;
      const wobble    = (k % 2 === 0 ? 1 : -1) * 13;
      const rad       = (baseAngle + wobble) * (Math.PI / 180);
      const dist      = 14 + (k % 3) * 9;          // 14 / 23 / 32 px
      const tx        = (Math.cos(rad) * dist).toFixed(2);
      const ty        = (Math.sin(rad) * dist).toFixed(2);
      const size      = [3.5, 2, 2.8][k % 3];
      const delay     = k * 14;                     // 0 → 98 ms tight burst

      const dot = document.createElement('div');
      dot.style.cssText = [
        'position:fixed',
        `left:${cx}px`, `top:${cy}px`,
        `width:${size}px`, `height:${size}px`,
        'border-radius:50%',
        `background:${palette[k % palette.length]}`,
        'pointer-events:none',
        'z-index:99999999',
        `animation:tap-spark-out 0.52s ${delay}ms ease-out forwards`,
      ].join(';');
      dot.style.setProperty('--tx', `${tx}px`);
      dot.style.setProperty('--ty', `${ty}px`);
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 560 + delay);
    }
  }

  // ─── Canvas — persists across menu opens ─────────────────────────────────────

  let _canvasItems = []; // { id, text, toneEmoji, toneLabel, energyLabel }

  // Draws all saved comments onto a <canvas> element and copies as PNG to clipboard.
  async function shareCanvasAsImage(shareBtn) {
    if (!_canvasItems.length) return;

    const W = 380, PAD = 18, CARD_GAP = 12, LINE_H = 19, EMO_W = 80;
    const CARD_PAD = 14, HDR_H = 76, FTR_H = 36, DPR = 2;
    const ff = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const ENERGY_ACCENT = { subtle: '#a78bfa', balanced: '#818cf8', bold: '#6366f1', powerful: '#4338ca' };

    // ── pass 1: measure card heights ────────────────────────────────────────
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.font = `13px ${ff}`;
    const TEXT_W = W - PAD * 2 - EMO_W - CARD_PAD - 8; // 8 = left accent bar width

    function wrapHeight(text) {
      let line = '', rows = 1;
      text.split(/\s+/).forEach(w => {
        const t = line ? line + ' ' + w : w;
        if (tmp.measureText(t).width > TEXT_W) { rows++; line = w; } else line = t;
      });
      return CARD_PAD * 2 + 24 + rows * LINE_H;
    }
    const cardHeights = _canvasItems.map(i => wrapHeight(i.text));
    const totalH = HDR_H + PAD
      + cardHeights.reduce((a, h) => a + h + CARD_GAP, 0)
      + PAD + FTR_H;

    // ── pass 2: draw ────────────────────────────────────────────────────────
    const cv  = document.createElement('canvas');
    cv.width  = W * DPR; cv.height = totalH * DPR;
    const ctx = cv.getContext('2d');
    ctx.scale(DPR, DPR);

    // ── Background gradient ──────────────────────────────────────────────────
    const bgGrad = ctx.createLinearGradient(0, 0, W, totalH);
    bgGrad.addColorStop(0, '#eef2ff');
    bgGrad.addColorStop(1, '#faf5ff');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, totalH);

    // ── Header panel ─────────────────────────────────────────────────────────
    ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(99,102,241,0.13)'; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.roundRect(0, 0, W, HDR_H, [0, 0, 16, 16]); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    // Rainbow accent bar at top
    const barGrad = ctx.createLinearGradient(0, 0, W, 0);
    barGrad.addColorStop(0,   '#6366f1');
    barGrad.addColorStop(0.5, '#a78bfa');
    barGrad.addColorStop(1,   '#818cf8');
    ctx.fillStyle = barGrad;
    ctx.beginPath(); ctx.roundRect(0, 0, W, 5, [0, 0, 0, 0]); ctx.fill();

    // Logo icon + wordmark
    const hdrImg = new Image();
    hdrImg.src = LOGO_URL;
    await new Promise(r => { hdrImg.onload = r; hdrImg.onerror = r; });
    const ICON_H = 28, ICON_W = hdrImg.width ? Math.round(hdrImg.width * (ICON_H / hdrImg.height)) : 28;
    ctx.drawImage(hdrImg, PAD, (HDR_H - ICON_H) / 2, ICON_W, ICON_H);

    ctx.font = `700 15px ${ff}`; ctx.fillStyle = '#6366f1';
    ctx.fillText('tapfill', PAD + ICON_W + 8, HDR_H / 2 - 4);

    ctx.font = `400 13px ${ff}`; ctx.fillStyle = '#cbd5e1';
    ctx.fillText('·  My Canvas', PAD + ICON_W + 8, HDR_H / 2 + 9);

    // Divider
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, HDR_H); ctx.lineTo(W, HDR_H); ctx.stroke();

    // ── Cards ────────────────────────────────────────────────────────────────
    let y = HDR_H + PAD;
    _canvasItems.forEach((item, i) => {
      const ch = cardHeights[i];
      const cx = PAD, cw = W - PAD * 2;
      const accent = ENERGY_ACCENT[(item.energyLabel || '').toLowerCase()] || '#818cf8';

      // Card drop shadow
      ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(99,102,241,0.10)'; ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.roundRect(cx, y, cw, ch, 14); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

      // Left accent bar
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.roundRect(cx, y, 5, ch, [14, 0, 0, 14]); ctx.fill();

      // Emoji
      ctx.font = `20px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, serif`;
      ctx.fillStyle = '#000';
      ctx.fillText(item.toneEmoji, cx + 16, y + CARD_PAD + 18);

      // Tone label
      ctx.font = `bold 9px ${ff}`; ctx.fillStyle = accent;
      ctx.fillText(item.toneLabel.toUpperCase(), cx + 16, y + CARD_PAD + 34);

      // Energy label
      ctx.font = `8px ${ff}`; ctx.fillStyle = '#94a3b8';
      ctx.fillText(item.energyLabel, cx + 16, y + CARD_PAD + 46);

      // Comment text — word-wrapped
      ctx.font = `13px ${ff}`; ctx.fillStyle = '#1e293b';
      const tx = cx + EMO_W + 8;
      let line = '', ty = y + CARD_PAD + LINE_H;
      item.text.split(/\s+/).forEach(w => {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > TEXT_W) { ctx.fillText(line, tx, ty); line = w; ty += LINE_H; }
        else line = t;
      });
      if (line) ctx.fillText(line, tx, ty);

      y += ch + CARD_GAP;
    });

    // ── Footer watermark ─────────────────────────────────────────────────────
    const fy = totalH - FTR_H + 14;
    const wmGrad = ctx.createLinearGradient(PAD, 0, PAD + 200, 0);
    wmGrad.addColorStop(0, '#6366f1'); wmGrad.addColorStop(1, '#a78bfa');
    ctx.font = `bold 11px ${ff}`; ctx.fillStyle = wmGrad;
    ctx.fillText('✦  Made with Tapfill', PAD, fy);
    ctx.font = `9px ${ff}`; ctx.fillStyle = '#94a3b8';
    ctx.fillText('tapfill.io', W - PAD - ctx.measureText('tapfill.io').width, fy);

    // ── Copy to clipboard (download fallback if CSP blocks clipboard) ──────────
    cv.toBlob(async blob => {
      const orig = shareBtn ? shareBtn.textContent : '';
      const url = URL.createObjectURL(blob);
      const triggerDownload = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tapfill-canvas.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        if (shareBtn) {
          shareBtn.textContent = '✓ Downloaded!';
          setTimeout(() => { shareBtn.textContent = orig; }, 2500);
        }
      };
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        URL.revokeObjectURL(url);
        if (shareBtn) {
          shareBtn.textContent = '✓ Copied!';
          setTimeout(() => { shareBtn.textContent = orig; }, 2000);
        }
      } catch (e) {
        console.warn('[Tapfill] clipboard blocked, downloading instead:', e.message);
        triggerDownload();
      }
    }, 'image/png');
  }

  // ─── Build #tap-menu (rebuilt fresh on every open) ───────────────────────────
  //
  //  Layout per row (single line):
  //    [emoji]  [Tone label]  ·····  [spinner | generated text | ↺ Retry]
  //
  //  All 4 tones are generated in parallel as soon as the menu opens.
  //  Clicking a ready row injects the text into the comment box.

  let _menuActiveDialog = null;
  let _menuArticle      = null;   // nearest [role="article"] for the active post
  let _menuPostText     = '';

  function buildTapMenu() {
    injectStyles();

    const menu = document.createElement('div');
    menu.id = TAP_MENU_ID;
    Object.assign(menu.style, {
      position:      'fixed',
      zIndex:        '9999999',
      background:    '#ffffff',
      borderRadius:  '16px',
      boxShadow:     '0 8px 32px rgba(0,0,0,0.18)',
      padding:       '14px 12px 12px',
      width:         '320px',
      maxWidth:      'calc(100vw - 16px)',
      display:       'flex',
      flexDirection: 'column',
      overflow:      'hidden',
      fontFamily:    '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      visibility:    'hidden',
    });

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    Object.assign(header.style, {
      fontSize: '11px', fontWeight: '600', color: '#94a3b8',
      letterSpacing: '0.08em', textTransform: 'uppercase',
      marginBottom: '10px', paddingLeft: '2px',
    });
    header.textContent = 'How do you want to show up?';
    menu.appendChild(header);

    // ── Chips row ────────────────────────────────────────────────────────────
    const chipsRow = document.createElement('div');
    Object.assign(chipsRow.style, {
      display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px',
    });
    menu.appendChild(chipsRow);

    // ── Language row ──────────────────────────────────────────────────────────
    const langRow = document.createElement('div');
    Object.assign(langRow.style, {
      display: 'flex', gap: '6px', marginTop: '8px',
    });
    const LANG_OPTIONS = [
      { key: 'english',  label: 'English' },
      { key: 'hindi',    label: 'Hindi' },
      { key: 'hinglish', label: 'Hinglish' },
    ];
    let _activeLangBtn = null;
    function setLangActive(btn) {
      if (_activeLangBtn) {
        Object.assign(_activeLangBtn.style, { background: '#f8fafc', borderColor: 'transparent', color: '#64748b', fontWeight: '500' });
      }
      _activeLangBtn = btn;
      Object.assign(btn.style, { background: '#eef2ff', borderColor: '#818cf8', color: '#6366f1', fontWeight: '600' });
    }
    LANG_OPTIONS.forEach(({ key, label }) => {
      const lb = document.createElement('button');
      lb.type = 'button';
      lb.textContent = label;
      Object.assign(lb.style, {
        flex: '1', padding: '5px 4px', borderRadius: '8px',
        border: '1.5px solid transparent', background: '#f8fafc',
        color: '#64748b', fontSize: '11px', fontWeight: '500',
        fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.15s',
      });
      lb.addEventListener('mousedown', e => e.preventDefault());
      lb.addEventListener('click', () => {
        _selectedLanguage = key;
        setLangActive(lb);
        chrome.storage.local.set({ tapfill_language: key });
        if (_langCache[key]) {
          // Already cached — instant, no API call
          _currentVariants = _langCache[key];
          showComment(_currentVariants[ENERGIES[_currentEnergyIdx].key]);
        } else if (key === 'hinglish' && _langCache['hindi']) {
          // Transliterate from cached Hindi — zero extra API call
          const hl = transliterateVariants(_langCache['hindi']);
          _langCache['hinglish'] = hl;
          _currentVariants = hl;
          showComment(_currentVariants[ENERGIES[_currentEnergyIdx].key]);
        } else if (_currentTone) {
          generateForTone(_currentTone);
        }
      });
      langRow.appendChild(lb);
      chrome.storage.local.get('tapfill_language', (r) => {
        const saved = r.tapfill_language || 'english';
        if (key === saved) setLangActive(lb);
      });
    });
    menu.appendChild(langRow);

    // ── Gradient separator (hidden until a chip is selected) ─────────────────
    const sep = document.createElement('div');
    Object.assign(sep.style, {
      height: '1px',
      background: 'linear-gradient(to right, transparent, #e2e8f0, transparent)',
      margin: '12px 0 0',
      display: 'none',
    });
    menu.appendChild(sep);

    // ── Result card (hidden until a chip is selected) ────────────────────────
    const resultCard = document.createElement('div');
    Object.assign(resultCard.style, {
      marginTop: '10px', display: 'none', flexDirection: 'column', gap: '8px',
    });
    menu.appendChild(resultCard);

    // Spinner row
    const spinnerWrap = document.createElement('div');
    Object.assign(spinnerWrap.style, {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '4px 2px', color: '#94a3b8', fontSize: '12px',
    });
    resultCard.appendChild(spinnerWrap);

    // Comment text
    const commentEl = document.createElement('p');
    Object.assign(commentEl.style, {
      margin: '0', fontSize: '13px', lineHeight: '1.6', color: '#1e293b',
      padding: '2px', display: 'none',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    });
    resultCard.appendChild(commentEl);

    // Action buttons row — [Canvas] [+ Canvas] [Use this →]  all equal width
    const actionRow = document.createElement('div');
    Object.assign(actionRow.style, { display: 'none', gap: '5px' });

    function mkBtn(label, styles) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      Object.assign(b.style, {
        flex: '1', padding: '7px 0', borderRadius: '10px',
        fontSize: '11px', fontWeight: '600', cursor: 'pointer',
        fontFamily: 'inherit', ...styles,
      });
      b.addEventListener('mousedown', e => e.preventDefault());
      return b;
    }

    const canvasBtn = mkBtn('Canvas', {
      border: '1.5px solid #e2e8f0', background: 'transparent', color: '#64748b',
    });
    const addToCanvasBtn = mkBtn('+ Canvas', {
      border: '1.5px solid #818cf8', background: 'transparent', color: '#6366f1',
    });
    const useBtn = mkBtn('Use this →', {
      border: 'none', background: 'linear-gradient(135deg,#6366f1,#818cf8)',
      color: '#fff',
    });

    actionRow.append(canvasBtn, addToCanvasBtn, useBtn);
    resultCard.appendChild(actionRow);

    // ── Energy bar ────────────────────────────────────────────────────────────
    // Keys map to the variant object returned by generateAllVariants()
    const ENERGIES = [
      { label: 'Subtle',   key: 'subtle'   },
      { label: 'Balanced', key: 'balanced' },
      { label: 'Bold',     key: 'bold'     },
      { label: 'Powerful', key: 'powerful' },
    ];
    // Progressive fills: lightest → darkest. Ring colour used for selection halo.
    const DOT_PALETTE = [
      { fill: '#ede9fe', border: '#c4b5fd', ring: '#a78bfa', label: '#a78bfa' }, // Subtle
      { fill: '#c7d2fe', border: '#818cf8', ring: '#818cf8', label: '#818cf8' }, // Balanced
      { fill: '#818cf8', border: '#6366f1', ring: '#6366f1', label: '#6366f1' }, // Bold
      { fill: '#6366f1', border: '#4338ca', ring: '#4338ca', label: '#4338ca' }, // Powerful
    ];

    const energyBar = document.createElement('div');
    Object.assign(energyBar.style, {
      display: 'none', padding: '10px 4px 4px',
    });

    // No connecting line — dots stand alone
    const energyDotsRow = document.createElement('div');
    Object.assign(energyDotsRow.style, {
      display: 'flex', justifyContent: 'space-between',
    });
    energyBar.appendChild(energyDotsRow);

    const energyDots = [];
    const energyLabels = [];
    ENERGIES.forEach((energy, idx) => {
      const pal = DOT_PALETTE[idx];
      const item = document.createElement('div');
      Object.assign(item.style, {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '5px', cursor: 'pointer',
      });
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        width: '22px', height: '22px', borderRadius: '50%',
        border: `2px solid ${pal.border}`,
        background: pal.fill,
        boxSizing: 'border-box',
        transition: 'box-shadow 0.18s ease',
        // Default selected = Balanced (idx 1)
        boxShadow: idx === 1 ? `0 0 0 2px #fff, 0 0 0 4px ${pal.ring}` : 'none',
      });
      energyDots.push(dot);

      const energyLabelEl = document.createElement('span');
      energyLabelEl.textContent = energy.label;
      Object.assign(energyLabelEl.style, {
        fontSize: '9px', fontWeight: idx >= 2 ? '600' : '400',
        color: pal.label, lineHeight: '1.2', whiteSpace: 'nowrap',
        transition: 'font-weight 0.15s',
      });
      energyLabels.push(energyLabelEl);

      item.append(dot, energyLabelEl);
      energyDotsRow.appendChild(item);
      item.addEventListener('mousedown', e => e.preventDefault());
      item.addEventListener('click', () => {
        if (_currentEnergyIdx === idx) return;
        // Remove ring from previous dot
        energyDots[_currentEnergyIdx].style.boxShadow = 'none';
        // Apply ring to new dot
        energyDots[idx].style.boxShadow = `0 0 0 2px #fff, 0 0 0 4px ${DOT_PALETTE[idx].ring}`;
        _currentEnergyIdx = idx;
        // Switch from cache — no extra API call
        if (_currentVariants) showComment(_currentVariants[ENERGIES[idx].key]);
      });
    });
    resultCard.insertBefore(energyBar, actionRow);

    let _selectedChip     = null;
    let _currentTone      = null;
    let _currentComment   = null;
    let _currentCommentId = null;  // DB record id — used for feedback
    let _currentVariants  = null;  // { subtle, balanced, bold, powerful }
    let _langCache        = {};    // lang → variants cache for current tone
    let _currentEnergyIdx = 1;     // default: Balanced
    let _lastCopied       = false; // true if current comment was copied via useBtn

    function clampPosition() {
      requestAnimationFrame(() => {
        const mRect  = menu.getBoundingClientRect();
        const vw     = document.documentElement.clientWidth;
        const vh     = window.innerHeight;
        const GAP    = 12;
        if (mRect.bottom > vh - GAP) {
          const newTop = parseFloat(menu.style.top) - (mRect.bottom - (vh - GAP));
          menu.style.top = `${Math.max(GAP, newTop)}px`;
        }
        if (parseFloat(menu.style.top) < GAP) menu.style.top = `${GAP}px`;
        if (mRect.right > vw - GAP) {
          const newLeft = parseFloat(menu.style.left) - (mRect.right - (vw - GAP));
          menu.style.left = `${Math.max(GAP, newLeft)}px`;
        }
        if (parseFloat(menu.style.left) < GAP) menu.style.left = `${GAP}px`;
      });
    }

    function showLoading() {
      _currentComment   = null;
      _currentCommentId = null;
      _currentVariants  = null;
      sep.style.display = '';
      resultCard.style.display = 'flex';
      spinnerWrap.innerHTML = '<span class="tap-vibe-text">Building your vibe\u2026</span>';
      spinnerWrap.style.display = 'flex';
      commentEl.style.display = 'none';
      energyBar.style.display = 'none';
      actionRow.style.display = 'none';
      clampPosition();
    }

    function renderWithDiff(oldText, newText) {
      const oldWords = oldText.trim().split(/\s+/).filter(Boolean);
      commentEl.innerHTML = '';
      newText.trim().split(/\s+/).filter(Boolean).forEach((word, i) => {
        if (i > 0) commentEl.appendChild(document.createTextNode(' '));
        const span = document.createElement('span');
        span.textContent = word;
        // All changed words flip at the same instant — no positional stagger
        if (oldWords[i] !== word) {
          span.className = 'tap-word-magic';
          // Wait one frame so the span has a layout rect before querying it
          requestAnimationFrame(() => spawnSparkles(span));
        }
        commentEl.appendChild(span);
      });
    }

    function showComment(text) {
      const prevText = _currentComment || '';
      _currentComment = text;
      spinnerWrap.style.display = 'none';
      // Reset any leftover fade from a previous transition
      commentEl.style.transition = '';
      commentEl.style.opacity   = '1';
      commentEl.style.display   = '';
      energyBar.style.display   = '';
      actionRow.style.display   = 'flex';
      // Word-level magic is the only animation — no whole-block fade
      renderWithDiff(prevText, text);
      clampPosition();
    }

    function showError(notConnected, isLimit) {
      _currentComment = null;
      if (isLimit) {
        spinnerWrap.innerHTML = '';
        const limitDiv = document.createElement('div');
        Object.assign(limitDiv.style, {
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '4px 0',
        });
        const limitSpan = document.createElement('span');
        Object.assign(limitSpan.style, { color: '#f59e0b', fontSize: '12px', textAlign: 'center', fontWeight: '600' });
        limitSpan.textContent = 'Free limit exhausted for today.';
        const upgradeBtn = document.createElement('button');
        Object.assign(upgradeBtn.style, {
          background: 'linear-gradient(135deg,#818cf8,#5B54F5)', color: '#fff', border: 'none',
          borderRadius: '20px', padding: '6px 18px', fontSize: '12px', fontWeight: '600',
          cursor: 'pointer', fontFamily: 'inherit',
        });
        upgradeBtn.textContent = 'Upgrade Plan \u2192';
        upgradeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        upgradeBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'OPEN_URL', url: 'https://tapfill.io/pricing' });
        });
        limitDiv.appendChild(limitSpan);
        limitDiv.appendChild(upgradeBtn);
        spinnerWrap.appendChild(limitDiv);
        spinnerWrap.style.display = 'flex';
      } else if (notConnected) {
        spinnerWrap.innerHTML = '';
        const notSignedDiv = document.createElement('div');
        Object.assign(notSignedDiv.style, {
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '4px 0',
        });
        const notSignedSpan = document.createElement('span');
        Object.assign(notSignedSpan.style, { color: '#ef4444', fontSize: '12px', textAlign: 'center' });
        notSignedSpan.textContent = 'Not signed in to Tapfill.';
        const connectBtn = document.createElement('button');
        Object.assign(connectBtn.style, {
          background: 'linear-gradient(135deg,#818cf8,#5B54F5)', color: '#fff', border: 'none',
          borderRadius: '20px', padding: '6px 18px', fontSize: '12px', fontWeight: '600',
          cursor: 'pointer', fontFamily: 'inherit',
        });
        connectBtn.textContent = 'Connect account \u2192';
        function openConnect() {
          console.log('[Tapfill] connect btn fired, sending OPEN_CONNECT');
          chrome.runtime.sendMessage({ type: 'OPEN_CONNECT' }, (res) => {
            if (chrome.runtime.lastError) {
              console.error('[Tapfill] sendMessage failed:', chrome.runtime.lastError.message);
            } else {
              console.log('[Tapfill] OPEN_CONNECT response:', res);
            }
          });
        }
        connectBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        connectBtn.addEventListener('click', openConnect);
        notSignedDiv.appendChild(notSignedSpan);
        notSignedDiv.appendChild(connectBtn);
        spinnerWrap.appendChild(notSignedDiv);
        spinnerWrap.style.display = 'flex';
      } else {
        spinnerWrap.innerHTML = `<span style="color:#ef4444;font-size:12px">Generation failed — try a different tone.</span>`;
        spinnerWrap.style.display = 'flex';
      }
      commentEl.style.display = 'none';
      energyBar.style.display = 'none';
      actionRow.style.display = 'none';
      clampPosition();
    }

    async function generateForTone(toneObj) {
      // Fast pre-check: bail immediately if no token in storage
      const _preCheck = await new Promise(r => chrome.storage.local.get('tapfill_token', r));
      if (!_preCheck.tapfill_token?.access_token) { showError(true, false); return; }
      // Reset energy selection to Balanced on each new generation
      if (_currentEnergyIdx !== 1) {
        energyDots[_currentEnergyIdx].style.boxShadow = 'none';
        energyDots[1].style.boxShadow = `0 0 0 2px #fff, 0 0 0 4px ${DOT_PALETTE[1].ring}`;
        _currentEnergyIdx = 1;
      }
      showLoading();
      try {
        const { variants, commentId, toneOrder: newToneOrder } = await generateAllVariants(_menuPostText, toneObj);
        _currentCommentId = commentId;
        if (newToneOrder) { _toneOrder = newToneOrder; chrome.storage.local.set({ tapfill_tone_order: newToneOrder }); }
        const apiLang = _selectedLanguage === 'hinglish' ? 'hindi' : _selectedLanguage;
        _langCache[apiLang] = variants;
        const displayVariants = _selectedLanguage === 'hinglish'
          ? ((_langCache['hinglish'] = transliterateVariants(variants)), _langCache['hinglish'])
          : variants;
        _currentVariants = displayVariants;
        showComment(displayVariants[ENERGIES[_currentEnergyIdx].key]);
      } catch (err) {
        const isRateLimit = err.rateLimit || err.message.includes('429') || (err.message && err.message.toLowerCase().includes('daily limit'));
        console.error('[Tapfill] generate failed:', err);
        if (isRateLimit) {
          showError(false, true);
          return;
        }
        showError(err.notConnected, false);
      }
    }

    // ── Inline Canvas View (replaces main content inside same popup) ────────────
    const mainViewEls = [header, chipsRow, langRow, sep, resultCard];

    const canvasView = document.createElement('div');
    Object.assign(canvasView.style, {
      display: 'none', flexDirection: 'column',
      // flex: 1 + minHeight: 0 lets it shrink inside the height-capped menu
      flex: '1', minHeight: '0', overflow: 'hidden', paddingBottom: '10px',
    });
    // Prevent any click inside canvas view from stealing focus off the textbox
    canvasView.addEventListener('mousedown', e => e.preventDefault());
    menu.appendChild(canvasView);

    // Header: [logo img] tapfill · My Canvas
    const cvHdr = document.createElement('div');
    Object.assign(cvHdr.style, {
      display: 'flex', alignItems: 'center', gap: '7px',
      paddingBottom: '10px', borderBottom: '1px solid #f1f5f9', marginBottom: '10px',
    });
    const cvLogoImg = document.createElement('img');
    cvLogoImg.src = LOGO_URL;
    cvLogoImg.style.cssText = 'height:18px;width:auto;display:block';
    const cvWordmark = document.createElement('span');
    cvWordmark.textContent = 'tapfill';
    Object.assign(cvWordmark.style, { fontSize: '13px', fontWeight: '700', color: '#6366f1' });
    const cvSep = document.createElement('span');
    cvSep.textContent = '·';
    Object.assign(cvSep.style, { color: '#cbd5e1', fontSize: '13px' });
    const cvTitle = document.createElement('span');
    cvTitle.textContent = 'My Canvas';
    Object.assign(cvTitle.style, { fontSize: '13px', fontWeight: '600', color: '#1e293b' });
    cvHdr.append(cvLogoImg, cvWordmark, cvSep, cvTitle);
    canvasView.appendChild(cvHdr);

    // Scrollable comment list — flex:1 + minHeight:0 makes it scroll within the
    // height-capped canvasView; the footer is always pinned below it.
    const cvList = document.createElement('div');
    Object.assign(cvList.style, {
      flex: '1', minHeight: '0', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: '8px',
      padding: '2px 0 6px',   // breathing room at top and bottom
    });
    canvasView.appendChild(cvList);

    // Footer: [← Back]  [Share 📤]
    const cvFooter = document.createElement('div');
    Object.assign(cvFooter.style, {
      display: 'flex', gap: '6px',
      paddingTop: '10px', paddingBottom: '2px', borderTop: '1px solid #f1f5f9',
    });
    const backBtn = mkBtn('← Back', {
      border: '1.5px solid #e2e8f0', background: 'transparent', color: '#64748b',
    });
    const shareBtn = mkBtn('Share 📤', {
      border: 'none', background: 'linear-gradient(135deg,#6366f1,#818cf8)', color: '#fff',
    });
    backBtn.addEventListener('click', () => showMainView());
    shareBtn.addEventListener('click', () => shareCanvasAsImage(shareBtn));
    cvFooter.append(backBtn, shareBtn);
    canvasView.appendChild(cvFooter);

    // ── View-switching helpers ────────────────────────────────────────────────
    // Snapshot display values before hiding so we can restore them exactly.
    let _savedDisplays = [];

    function showMainView() {
      // Restore each element's exact display value from the snapshot
      mainViewEls.forEach((el, i) => {
        el.style.display = _savedDisplays[i] !== undefined ? _savedDisplays[i] : '';
      });
      canvasView.style.display = 'none';
      menu.style.maxHeight = '';       // lift the canvas height cap
      menu.style.overflow  = 'hidden'; // restore default clipping
      // Re-clamp menu position in case it was nudged upward during canvas view
      clampPosition();
    }

    function showCanvasView() {
      // Snapshot so sep/resultCard managed states are captured correctly
      _savedDisplays = mainViewEls.map(el => el.style.display);
      mainViewEls.forEach(el => { el.style.display = 'none'; });
      menu.style.overflow  = 'hidden';
      canvasView.style.display = 'flex';
      renderCanvasInline();

      // After paint: measure the menu's actual top and constrain maxHeight so the
      // bottom of the popup never goes below the viewport, then nudge up if needed.
      requestAnimationFrame(() => {
        const GAP   = 8;
        const mTop  = parseFloat(menu.style.top) || menu.getBoundingClientRect().top;
        const avail = window.innerHeight - mTop - GAP;          // px left below the menu
        menu.style.maxHeight = `${Math.min(avail, 520)}px`;

        // If the menu still clips the bottom edge, slide it upward
        const mRect = menu.getBoundingClientRect();
        if (mRect.bottom > window.innerHeight - GAP) {
          const shift  = mRect.bottom - (window.innerHeight - GAP);
          menu.style.top = `${Math.max(GAP, parseFloat(menu.style.top) - shift)}px`;
          // Recalculate maxHeight from the new top position
          const newTop = parseFloat(menu.style.top);
          menu.style.maxHeight = `${Math.min(window.innerHeight - newTop - GAP, 520)}px`;
        }
      });
    }

    function renderCanvasInline() {
      cvList.innerHTML = '';
      if (!_canvasItems.length) {
        const empty = document.createElement('p');
        Object.assign(empty.style, {
          margin: '0', textAlign: 'center', color: '#94a3b8',
          fontSize: '12px', padding: '24px 0',
        });
        empty.textContent = 'No comments saved yet.';
        cvList.appendChild(empty);
        return;
      }
      _canvasItems.forEach(item => {
        const card = document.createElement('div');
        Object.assign(card.style, {
          display: 'flex', alignItems: 'flex-start', gap: '8px',
          padding: '10px', background: '#f8fafc',
          borderRadius: '12px', border: '1px solid #e2e8f0',
        });
        // Left meta
        const meta = document.createElement('div');
        Object.assign(meta.style, {
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: '3px', minWidth: '36px',
        });
        const emojiEl  = document.createElement('span');
        emojiEl.textContent = item.toneEmoji;
        emojiEl.style.fontSize = '18px';
        const lblTone  = document.createElement('span');
        lblTone.textContent = item.toneLabel;
        Object.assign(lblTone.style, { fontSize: '8px', color: '#6366f1', fontWeight: '600', textAlign: 'center' });
        const lblEnergy = document.createElement('span');
        lblEnergy.textContent = item.energyLabel;
        Object.assign(lblEnergy.style, { fontSize: '8px', color: '#94a3b8', textAlign: 'center' });
        meta.append(emojiEl, lblTone, lblEnergy);
        // Text
        const textEl = document.createElement('p');
        Object.assign(textEl.style, { margin: '0', flex: '1', fontSize: '12px', lineHeight: '1.55', color: '#1e293b', wordBreak: 'break-word' });
        textEl.textContent = item.text;
        // Discard
        const discardBtn = document.createElement('button');
        discardBtn.type = 'button'; discardBtn.textContent = '×';
        Object.assign(discardBtn.style, { background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: '16px', lineHeight: '1', padding: '0 2px', fontFamily: 'inherit', flexShrink: '0' });
        discardBtn.addEventListener('mousedown', e => e.preventDefault());
        discardBtn.addEventListener('mouseenter', () => { discardBtn.style.color = '#ef4444'; });
        discardBtn.addEventListener('mouseleave', () => { discardBtn.style.color = '#cbd5e1'; });
        discardBtn.addEventListener('click', () => {
          _canvasItems = _canvasItems.filter(c => c.id !== item.id);
          renderCanvasInline();
        });
        card.append(meta, textEl, discardBtn);
        cvList.appendChild(card);
      });
    }

    canvasBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCanvasView();
    });

    addToCanvasBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_currentComment || !_currentTone) return;
      _canvasItems.push({
        id:          Date.now(),
        text:        _currentComment,
        toneEmoji:   _currentTone.emoji,
        toneLabel:   _currentTone.label,
        energyLabel: ENERGIES[_currentEnergyIdx].label,
      });
      // Brief confirmation flash on the button
      const orig = addToCanvasBtn.textContent;
      addToCanvasBtn.textContent = '✓ Saved!';
      addToCanvasBtn.style.color  = '#10b981';
      addToCanvasBtn.style.border = '1.5px solid #10b981';
      setTimeout(() => {
        addToCanvasBtn.textContent = orig;
        addToCanvasBtn.style.color  = '#6366f1';
        addToCanvasBtn.style.border = '1.5px solid #818cf8';
      }, 1500);
      // If canvas view is currently showing, refresh it live
      if (canvasView.style.display !== 'none') renderCanvasInline();
    });

    useBtn.addEventListener('click', () => {
      if (!_currentComment) return;
      const textbox =
        (_menuActiveDialog && _menuActiveDialog.querySelector(TEXTBOX_SEL)) ||
        document.querySelector(TEXTBOX_SEL);
      if (textbox) {
        insertTextReact(textbox, _currentComment);
        requestAnimationFrame(() =>
          textbox.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        );
      }
      // Send feedback to SaaS so this comment is tracked as used
      if (_currentCommentId) {
        const port = chrome.runtime.connect({ name: 'AI_FETCH' });
        port.postMessage({ type: 'FEEDBACK', commentId: _currentCommentId, signal: 'use' });
        port.disconnect();
      }
      _lastCopied = true;
      closeTapMenu();
    });

    const visibleTones = (_userPlan === 'creator' ? [...TONES, ...CREATOR_TONES] : TONES)
      .slice()
      .sort((a, b) => {
        const ai = _toneOrder.indexOf(a.tone);
        const bi = _toneOrder.indexOf(b.tone);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    visibleTones.forEach((toneObj) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      Object.assign(chip.style, {
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:           '5px',
        padding:       '8px 6px',
        border:        '2px solid transparent',
        borderRadius:  '12px',
        background:    '#f8fafc',
        cursor:        'pointer',
        fontFamily:    'inherit',
        transition:    'background 0.15s, border-color 0.15s',
        minWidth:      '54px',
        flexShrink:    '0',
      });

      const emojiEl = document.createElement('span');
      emojiEl.textContent = toneObj.emoji;
      Object.assign(emojiEl.style, { fontSize: '20px', lineHeight: '1' });

      const labelEl = document.createElement('span');
      labelEl.textContent = toneObj.label;
      Object.assign(labelEl.style, {
        fontSize: '10px', fontWeight: '600', color: '#64748b',
        lineHeight: '1.2', textAlign: 'center',
      });

      chip.append(emojiEl, labelEl);
      chipsRow.appendChild(chip);

      chip.addEventListener('mousedown', e => e.preventDefault());
      chip.addEventListener('mouseenter', () => {
        if (_selectedChip !== chip) chip.style.background = '#f1f5f9';
      });
      chip.addEventListener('mouseleave', () => {
        if (_selectedChip !== chip) chip.style.background = '#f8fafc';
      });

      chip.addEventListener('click', () => {
        // Skip signal: switching away from a generated comment that wasn't copied
        if (_selectedChip && _selectedChip !== chip && _currentCommentId && !_lastCopied) {
          const skipPort = chrome.runtime.connect({ name: 'AI_FETCH' });
          skipPort.postMessage({ type: 'FEEDBACK', commentId: _currentCommentId, signal: 'skip' });
          setTimeout(() => skipPort.disconnect(), 1000);
        }
        _lastCopied = false;
        if (_selectedChip && _selectedChip !== chip) {
          _selectedChip.style.background  = '#f8fafc';
          _selectedChip.style.borderColor = 'transparent';
          _selectedChip.querySelector('span:last-child').style.color = '#64748b';
        }
        _selectedChip = chip;
        _currentTone  = toneObj;
        _langCache    = {};
        chip.style.background  = '#eef2ff';
        chip.style.borderColor = '#818cf8';
        labelEl.style.color    = '#6366f1';
        generateForTone(toneObj);
      });
    });

    document.body.appendChild(menu);
    return { menu };
  }

  // ─── Open / close #tap-menu ───────────────────────────────────────────────────

  async function openTapMenu(tapRootBtn) {
    closeTapMenu();

    _menuActiveDialog = tapRootBtn._tapDialog || null;
    // Scope all image extraction to the nearest article/post container
    _menuArticle = (
      tapRootBtn.closest('[role="article"]') ||
      tapRootBtn.closest('[data-pagelet]')   ||
      _menuActiveDialog?.closest('[role="article"]') ||
      _menuActiveDialog?.closest('[data-pagelet]')   ||
      _menuActiveDialog ||
      null
    );
    console.log('[Tapfill] _menuArticle:', _menuArticle?.tagName, _menuArticle?.getAttribute('role'), _menuArticle?.getAttribute('data-pagelet'), '| imgs inside:', _menuArticle?.querySelectorAll('img').length);
    _menuPostText     = scrapePostText(_menuActiveDialog ?? document.body);
    _canvasItems      = []; // fresh canvas for every new post/session

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[Tapfill] 📥 POST DATA SCRAPED');
    console.log('  postText :', _menuPostText || '(none)');
    console.log('  words    :', countMeaningfulWords(_menuPostText));
    console.log('  url      :', window.location.href.slice(0, 80));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Always read fresh plan from storage so creator tones show correctly
    _userPlan = await getUserPlan();

    const { menu } = buildTapMenu();

    const textbox = _menuActiveDialog?.querySelector(TEXTBOX_SEL);
    const anchor  = textbox || tapRootBtn;
    const aRect   = anchor.getBoundingClientRect();
    const bRect   = tapRootBtn.getBoundingClientRect();

    const POPUP_W = 320;
    const menuH   = menu.offsetHeight || 320;

    const GAP = 8;
    let top  = aRect.top - menuH - GAP;
    let left = bRect.left;

    if (top < GAP) top = aRect.bottom + GAP;
    if (top + menuH > window.innerHeight - GAP) top = window.innerHeight - menuH - GAP;
    if (left + POPUP_W > document.documentElement.clientWidth - GAP) left = document.documentElement.clientWidth - POPUP_W - GAP;
    if (left < GAP) left = GAP;

    menu.style.top        = `${top}px`;
    menu.style.left       = `${left}px`;
    menu.style.visibility = ''; // reveal after positioned

    setTimeout(() => document.addEventListener('click', onClickAway, true), 0);
  }

  function closeTapMenu() {
    document.getElementById(TAP_MENU_ID)?.remove();
    document.removeEventListener('click', onClickAway, true);
    _menuActiveDialog = null;
    _menuArticle      = null;
    _menuPostText     = '';
  }

  function onClickAway(e) {
    const menu   = document.getElementById(TAP_MENU_ID);
    const tapBtn = document.getElementById(TAP_ROOT_ID);
    if (!menu) { document.removeEventListener('click', onClickAway, true); return; }
    if (!menu.contains(e.target) && !tapBtn?.contains(e.target)) closeTapMenu();
  }

  // ─── Build the #tap-root button ───────────────────────────────────────────────

  function buildTapRoot(initialDialog) {
    const btn = document.createElement('button');
    btn.id        = TAP_ROOT_ID;
    btn.type      = 'button';
    btn.title     = 'Tapfill – Comment Assistant';
    btn.setAttribute('aria-label', 'Comment Assistant');

    btn._tapDialog = initialDialog;

    Object.assign(btn.style, {
      display:        'none',      // hidden until comment box is focused
      alignItems:     'center',
      justifyContent: 'center',
      width:          'auto',
      height:         '23px',
      padding:        '0',
      border:         'none',
      background:     'transparent',
      cursor:         'pointer',
      flexShrink:     '0',
      verticalAlign:  'middle',
      outline:        'none',
      transition:     'transform 0.12s ease',
    });

    btn.innerHTML = `<img src="${LOGO_URL}" height="23" style="display:block;width:auto" draggable="false">`;

    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.12)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });

    // Prevent mousedown from stealing focus away from the comment text box.
    btn.addEventListener('mousedown', (e) => e.preventDefault());

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (document.getElementById(TAP_MENU_ID)) {
        closeTapMenu();
      } else {
        openTapMenu(btn);
      }
    });

    return btn;
  }

  // ─── Inject / reposition #tap-root ────────────────────────────────────────────

  function injectTapRoot(container) {
    if (!container.querySelectorAll) return;

    // Facebook has two elements matching STICKER_SEL: the visible toolbar icon
    // (small x, inside the card) and a hidden React overlay (large x, outside the
    // card).  Filter to visible ones (non-zero size) and pick the leftmost.
    const allStickers = [...container.querySelectorAll(STICKER_SEL)].filter(btn => {
      const r = btn.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!allStickers.length) return;

    const stickerBtn = allStickers.reduce((a, b) =>
      a.getBoundingClientRect().x <= b.getBoundingClientRect().x ? a : b
    );

    const dialog = stickerBtn.closest('[role="dialog"]');
    if (!dialog) return;

    // Skip video posts — only inject on photo/image dialogs
    if (dialog.querySelector('video')) return;

    const r     = stickerBtn.getBoundingClientRect();
    const rowEl = stickerBtn.parentElement;
    const rowR  = rowEl?.getBoundingClientRect();
    const ref   = (rowR && rowR.height > 0 && rowR.height <= 48) ? rowR : r;

    // Match gap between T icon and sticker to the natural inter-icon spacing.
    let iconGap = 8;
    if (rowEl) {
      const cssGap = parseFloat(getComputedStyle(rowEl).columnGap);
      if (cssGap > 0 && cssGap < 30) {
        iconGap = cssGap;
      } else {
        const prev = stickerBtn.previousElementSibling;
        if (prev) {
          const pR       = prev.getBoundingClientRect();
          const measured = r.left - pR.right;
          if (measured >= 0 && measured < 30) iconGap = measured;
        }
      }
    }

    const left = r.right + iconGap + 2;
    const top  = ref.top + (ref.height - 23) / 2;

    const existing = document.getElementById(TAP_ROOT_ID);
    if (existing) {
      existing.style.left = `${left}px`;
      existing.style.top  = `${top}px`;
      existing._tapDialog = dialog;
      return;
    }

    const tapRoot = buildTapRoot(dialog);
    tapRoot.style.position = 'fixed';
    tapRoot.style.left     = `${left}px`;
    tapRoot.style.top      = `${top}px`;
    tapRoot.style.zIndex   = '999999';

    document.body.appendChild(tapRoot);
    console.log('[Tapfill] #tap-root injected ✓', { left, top }, tapRoot);
  }

  // ─── Show / hide helpers ──────────────────────────────────────────────────────

  function showTapRoot() {
    const btn = document.getElementById(TAP_ROOT_ID);
    if (btn) btn.style.display = 'inline-flex';
  }

  function hideTapRoot() {
    closeTapMenu();
    const btn = document.getElementById(TAP_ROOT_ID);
    if (btn) btn.style.display = 'none';
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────────

  let reinjectionScheduled = false;

  function scheduleReinjection() {
    if (reinjectionScheduled) return;
    reinjectionScheduled = true;
    setTimeout(() => {
      reinjectionScheduled = false;
      document.querySelectorAll(STICKER_SEL).forEach((stickerBtn) => {
        injectTapRoot(resolveDialog(stickerBtn));
      });
    }, 50);
  }

  const observer = new MutationObserver((mutations) => {
    for (const { addedNodes, removedNodes } of mutations) {

      for (const node of removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.id === TAP_ROOT_ID || node.querySelector(`#${TAP_ROOT_ID}`)) {
          scheduleReinjection();
        }
        if (node.getAttribute('role') === 'dialog' || node.querySelector('[role="dialog"]')) {
          document.getElementById(TAP_ROOT_ID)?.remove();
          closeTapMenu();
        }
      }

      for (const node of addedNodes) {
        if (!(node instanceof Element)) continue;
        const stickerBtns = node.matches(STICKER_SEL)
          ? [node]
          : Array.from(node.querySelectorAll(STICKER_SEL));

        for (const stickerBtn of stickerBtns) {
          const dialog = resolveDialog(stickerBtn);
          requestAnimationFrame(() => injectTapRoot(dialog));
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ─── focusin / focusout — show T button only while comment box is focused ─────
  //
  //  Problem: when Facebook first expands a toolbar, the sticker button is in the
  //  DOM but CSS-hidden.  getBoundingClientRect() returns (0,0,0,0) so
  //  injectTapRoot returns early and showTapRoot has nothing to show.
  //  Fix: try twice — at 100 ms (fast path) and 350 ms (slow-animation path).
  //  A `textboxFocused` flag prevents the late retry from firing if the user has
  //  already left the comment box.

  let tapHideTimer   = null;
  let textboxFocused = false;

  function positionAndShow() {
    document.querySelectorAll(STICKER_SEL).forEach((s) => {
      injectTapRoot(resolveDialog(s));
    });
    showTapRoot();
  }

  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (
      target.nodeType === Node.ELEMENT_NODE &&
      target.getAttribute('contenteditable') === 'true' &&
      target.getAttribute('role') === 'textbox'
    ) {
      textboxFocused = true;
      clearTimeout(tapHideTimer);

      // Fast path — toolbar usually ready within 100 ms
      setTimeout(() => {
        if (!textboxFocused) return;
        console.log('[Tapfill] focusin attempt 1');
        positionAndShow();
      }, 100);

      // Slow path — covers toolbars with longer CSS transitions
      setTimeout(() => {
        if (!textboxFocused) return;
        console.log('[Tapfill] focusin attempt 2');
        positionAndShow();
      }, 350);
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    const target = e.target;
    if (
      target.nodeType === Node.ELEMENT_NODE &&
      target.getAttribute('contenteditable') === 'true' &&
      target.getAttribute('role') === 'textbox'
    ) {
      textboxFocused = false;
      // Delay so T-button mousedown (which keeps text-box focus) runs first.
      tapHideTimer = setTimeout(hideTapRoot, 200);
    }
  }, true);

  // ─── Immediate scan ───────────────────────────────────────────────────────────

  const immediateFound = document.querySelectorAll(STICKER_SEL);
  console.log('[Tapfill] immediate scan – sticker buttons found:', immediateFound.length);
  immediateFound.forEach((stickerBtn) => {
    injectTapRoot(resolveDialog(stickerBtn));
  });

  // ── Heartbeat — keeps extension_sessions.last_active fresh ──────────────────
  function sendHeartbeat() {
    chrome.runtime.sendMessage({ type: 'HEARTBEAT' }, () => { void chrome.runtime.lastError; });
  }
  setTimeout(sendHeartbeat, 10000);               // first ping 10s after page load
  setInterval(sendHeartbeat, 30 * 60 * 1000);     // then every 30 minutes

})();
