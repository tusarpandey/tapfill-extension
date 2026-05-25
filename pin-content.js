// ==UserScript==
// @name         Pintfill – Pinterest Comment Assistant
// @namespace    https://tapfill.io
// @version      1.0.0
// @description  Injects an AI comment-assistant button into every Pinterest comment box.
// @author       Tapfill
// @match        https://*.pinterest.com/*
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Config ───────────────────────────────────────────────────────────────────
  //
  // API key is stored securely in background.js only.
  // (model handled server-side via Tapfill SaaS)

  // ─── Constants ────────────────────────────────────────────────────────────────

  const TAP_ROOT_ID  = 'pin-tap-root';
  const TAP_MENU_ID  = 'pin-tap-menu';
  const TEXTBOX_SEL  = '[contenteditable="true"][role="combobox"][aria-label^="Add a comment"]';

  // ─── Tones (identical to Facebook extension) ──────────────────────────────────

  const TONES = [
    { emoji: '🎩', label: 'Classic',   desc: 'Polished and timeless.',            tone: 'classic',      temp: 0.2 },
    { emoji: '🌻', label: 'Friendly',  desc: 'Warm, heartfelt, caring.',          tone: 'friendly',     temp: 0.5 },
    { emoji: '💎', label: 'Confident', desc: 'Direct. Clear. No second-guessing.', tone: 'confident',   temp: 0.3 },
    { emoji: '😄', label: 'Funny',     desc: 'Playful and clever. Makes you smile.', tone: 'funny',     temp: 0.9 },
    { emoji: '🎬', label: 'Filmy',     desc: 'Full cinematic. Dramatic flair.',   tone: 'filmy',        temp: 0.8 },
  ];

  const CREATOR_TONES = [
    { emoji: '🔥', label: 'Bold',       desc: 'Sharp. Direct. No filter.',   tone: 'bold_tone', temp: 0.9, tonePrompt: 'Write a sharp, edgy, unapologetic comment. Says what everyone is thinking but nobody says out loud. Strong take delivered with conviction. No softening, no hedging.' },
    { emoji: '🧘', label: 'Wise',      desc: 'Deep insight. Quotable.',     tone: 'wise',      temp: 0.4, tonePrompt: 'Write a thoughtful, philosophical comment like a mentor speaking. Deep insight, quotable, the kind of comment people screenshot and share.' },
    { emoji: '💫', label: 'Hype',      desc: 'High energy. Celebratory.',   tone: 'hype',      temp: 0.9, tonePrompt: 'Write an energetic, enthusiastic comment full of excitement. Like a best friend cheering someone on. High energy, motivating, celebratory.' },
    { emoji: '😏', label: 'Sarcastic', desc: 'Dry. Clever. Smart.',         tone: 'sarcastic', temp: 0.8, tonePrompt: 'Write a dry, clever, subtly sarcastic comment. The kind that makes people laugh and think at the same time. Smart sarcasm, not mean or offensive.' },
    { emoji: '🌶️', label: 'Desi',      desc: 'Indian humor. Relatable.',    tone: 'desi',      temp: 0.9, tonePrompt: 'Write a funny, relatable, quintessentially Indian humor comment. Use cultural references, Indian expressions, light sarcasm. The kind of comment that makes an Indian say yaar yeh toh bilkul sach hai.' },
  ];

  let _userPlan = 'free';
  chrome.storage.local.get('tapfill_user', (r) => { _userPlan = r.tapfill_user?.plan || 'free'; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tapfill_user) _userPlan = changes.tapfill_user.newValue?.plan || 'free';
  });

  let _selectedLanguage = 'english';
  chrome.storage.local.get('tapfill_language', (r) => { _selectedLanguage = r.tapfill_language || 'english'; });
  let _toneOrder = [];
  chrome.storage.local.get('tapfill_tone_order', (r) => { _toneOrder = r.tapfill_tone_order || []; });

  function devanagariToHinglish(text) {
    const C = {
      'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng',
      'च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
      'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n',
      'त':'t','थ':'th','द':'d','ध':'dh','न':'n',
      'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m',
      'य':'y','र':'r','ल':'l','व':'v',
      'श':'sh','ष':'sh','स':'s','ह':'h','ळ':'l',
      'क़':'q','ख़':'kh','ग़':'gh','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f',
    };
    const M = { 'ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','ृ':'ri','े':'e','ै':'ai','ो':'o','ौ':'au','ॉ':'o','ॅ':'e' };
    const V = { 'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऋ':'ri','ऑ':'o' };
    const VIRAMA = '्';
    const chars = [...text];
    let out = '', i = 0;
    while (i < chars.length) {
      const c = chars[i];
      if (C[c] !== undefined) {
        const next = chars[i + 1];
        if (next === VIRAMA) { out += C[c]; i += 2; }
        else if (M[next] !== undefined) { out += C[c] + M[next]; i += 2; }
        else { const end = !next || /[ \n.,!?;:()\[\]"'—\-]/.test(next); out += C[c] + (end ? '' : 'a'); i++; }
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
    return { subtle: devanagariToHinglish(variants.subtle||''), balanced: devanagariToHinglish(variants.balanced||''), bold: devanagariToHinglish(variants.bold||''), powerful: devanagariToHinglish(variants.powerful||'') };
  }

  // ─── Spinner keyframe ─────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('pin-tap-styles')) return;
    const s = document.createElement('style');
    s.id = 'pin-tap-styles';
    s.textContent = [
      '@keyframes pin-tap-spin{to{transform:rotate(360deg)}}',
      '@keyframes pin-vibe-pulse{0%,100%{opacity:0.45;text-shadow:0 0 6px rgba(99,102,241,0.4)}50%{opacity:1;text-shadow:0 0 18px rgba(99,102,241,0.85),0 0 36px rgba(129,140,248,0.5)}}',
      '.pin-vibe-text{font-size:13px;font-weight:600;color:#6366f1;animation:pin-vibe-pulse 1.4s ease-in-out infinite;letter-spacing:0.01em}',
    ].join('');
    document.head.appendChild(s);
  }

  // ─── Tapfill logo (height 28, auto width) ────────────────────────────────────

  const LOGO_URL = chrome.runtime.getURL('icons/icon-48.png');

  // ─── React-compatible text insertion ─────────────────────────────────────────
  //
  //  Pinterest uses React. The ClipboardEvent/paste approach is unreliable;
  //  InputEvent with inputType:'insertText' is the most compatible method.

  function insertTextReact(textbox, text) {
    textbox.focus();
    // Insert at the current cursor position WITHOUT any select-all or range
    // manipulation. Pinterest's contenteditable has React-managed child nodes
    // (placeholder spans etc.); replacing ALL content via selectAll/selectNodeContents
    // destroys those nodes, causing React's removeChild reconciliation crash.
    // The comment box is empty when the user generates, so plain insertText is safe.
    document.execCommand('insertText', false, text);
  }

  // ─── Pin context scraper ─────────────────────────────────────────────────────
  //
  //  Tries multiple Pinterest selectors to get the pin title / description
  //  so the AI can write a contextually relevant comment.

  function scrapePinText() {
    // Ordered list of selectors — first match wins.
    const SELECTORS = [
      '[data-test-id="pin-description"]',
      '[data-test-id="truncated-description"]',
      '.tBJ.dyH.iFc.yTZ.pBj.DrD.IZT',
      'div[data-test-id="pin-closeup-details"] span',
      'h1[data-test-id="pin-title"]',
      '[data-test-id="board-name"]',
      'h1[data-test-id="CloseupDetails"]',
      '[data-test-id="CloseupDetails"] h1',
      'div[data-test-id="CloseupDetails"] h1',
      '[data-test-id="pin-closeup-description"]',
      '[data-test-id="CloseupDetails"] [dir="auto"]',
      '[data-test-id="description-text"]',
      'h1',
    ];

    for (const sel of SELECTORS) {
      const t = document.querySelector(sel)?.textContent?.trim();
      if (t && t.length > 3) {
        console.log(`[Tapfill] Pinterest text found via selector: "${sel}"`);
        return t.slice(0, 500);
      }
    }

    // Alt text on the main pin image
    const img = document.querySelector('img[elementtiming*="MainPinImage"]');
    if (img?.alt && img.alt.length > 5) {
      console.log('[Tapfill] Pinterest text found via image alt text');
      return img.alt.slice(0, 300);
    }

    // Last-resort fallback — ensures postText is never empty
    console.log('[Tapfill] Pinterest text: no selector matched, using fallback text');
    return 'Interesting pin worth commenting on';
  }

  // ─── Filmy tone enrichment ────────────────────────────────────────────────

  const FILMY_DATA_URL = 'https://tapfill.io/api/filmy-data';

  async function getFilmyTonePrompt() {
    try {
      const res = await fetch(FILMY_DATA_URL, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { movies } = await res.json();
      if (!movies?.length) throw new Error('empty');

      const movieBlocks = movies.map(m => {
        const lines = [`Movie: ${m.movie_name}`];
        if (m.lead_actors?.length)       lines.push(`Stars: ${m.lead_actors.join(', ')}`);
        if (m.popular_dialogues?.length) lines.push(`Popular dialogues:\n${m.popular_dialogues.map(d => `  "${d}"`).join('\n')}`);
        if (m.popular_songs?.length)     lines.push(`Songs: ${m.popular_songs.join(', ')}`);
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

  // ─── Optimization helpers ──────────────────────────────────────────────────

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

  const PIN_IMG_SELS = [
    'img[elementtiming*="MainPinImage"]',
    '[data-test-id="pin-closeup-image"] img',
    '[data-test-id="closeup-image"] img',
  ];

  async function extractPostImage(selectors, root) {
    let imgEl = null;
    for (const sel of selectors) {
      const el = (root || document).querySelector(sel);
      if (el?.src && !el.src.startsWith('data:') && !el.src.startsWith('blob:')) {
        imgEl = el; break;
      }
    }
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
          resolve(cv.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(null); };
        img.src = blobUrl;
      });
    } catch { return null; }
  }

  // ─── SaaS API call — returns { subtle, balanced, bold, powerful } ────────────
  //  Energy switching is instant (no extra API calls).

  async function generateAllVariants(pinText, toneObj) {
    const language = _selectedLanguage === 'hinglish' ? 'hindi' : _selectedLanguage;

    // ── Filmy tone enrichment (Bollywood agent) ───────────────────────────
    if (toneObj.label === 'Filmy') {
      toneObj = { ...toneObj, tonePrompt: await getFilmyTonePrompt() };
    }

    // ── Opt-2: smart image sending ──────────────────────────────────────────
    // Skip the last-resort fallback text when counting meaningful words.
    const rawText = pinText === 'Interesting pin worth commenting on' ? '' : pinText;
    const wordCount = countMeaningfulWords(rawText);
    let imageMode = 'text-only';
    let imageData  = null;
    if (wordCount > 20) {
      imageMode = 'text-only';
      console.log(`[Tapfill] text-only mode — caption has ${wordCount} words`);
    } else if (wordCount >= 1) {
      imageMode = 'image+text';
      console.log(`[Tapfill] image+text mode — caption has ${wordCount} words`);
      imageData = await extractPostImage(PIN_IMG_SELS, document);
      if (!imageData) { console.log('[Tapfill] image extraction failed — falling back to text only'); imageMode = 'text-only'; }
    } else {
      imageMode = 'image-only';
      console.log('[Tapfill] image-only mode — no meaningful caption found');
      imageData = await extractPostImage(PIN_IMG_SELS, document);
      if (!imageData) { console.log('[Tapfill] image extraction failed — falling back to text only'); imageMode = 'text-only'; }
    }

    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'AI_FETCH' });
      let settled = false;
      port.onMessage.addListener((response) => {
        if (settled) return; settled = true;
        port.disconnect();
        if (response?.notConnected) {
          return reject(Object.assign(new Error('NOT_CONNECTED'), { notConnected: true }));
        }
        if (!response?.ok) return reject(new Error(response?.error || 'AI request failed'));
        resolve({ variants: response.variants, commentId: response.commentId || null, toneOrder: response.toneOrder || null });
      });
      port.onDisconnect.addListener(() => {
        if (settled) return; settled = true;
        reject(new Error(chrome.runtime.lastError?.message || 'Port disconnected'));
      });
      port.postMessage({ type: 'GENERATE', postText: pinText, tone: toneObj.tone, platform: 'pinterest', language, tonePrompt: toneObj.tonePrompt || null, imageMode, imageData });
    });
  }

  // ─── Menu state ───────────────────────────────────────────────────────────────

  let _menuActiveTextbox = null;
  let _menuPinText       = '';

  // ─── Build #pin-tap-menu ─────────────────────────────────────────────────────

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
      width:         '332px',
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
      letterSpacing: '0.06em', textTransform: 'uppercase',
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
    Object.assign(langRow.style, { display: 'flex', gap: '6px', marginTop: '8px' });
    const LANG_OPTIONS = [
      { key: 'english',  label: 'English' },
      { key: 'hindi',    label: 'Hindi' },
      { key: 'hinglish', label: 'Hinglish' },
    ];
    let _activeLangBtn = null;
    function setLangActive(btn) {
      if (_activeLangBtn) Object.assign(_activeLangBtn.style, { background: '#f8fafc', borderColor: 'transparent', color: '#64748b', fontWeight: '500' });
      _activeLangBtn = btn;
      Object.assign(btn.style, { background: '#eef2ff', borderColor: '#818cf8', color: '#6366f1', fontWeight: '600' });
    }
    LANG_OPTIONS.forEach(({ key, label }) => {
      const lb = document.createElement('button');
      lb.type = 'button'; lb.textContent = label;
      Object.assign(lb.style, { flex: '1', padding: '5px 4px', borderRadius: '8px', border: '1.5px solid transparent', background: '#f8fafc', color: '#64748b', fontSize: '11px', fontWeight: '500', fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.15s' });
      lb.addEventListener('mousedown', e => e.preventDefault());
      lb.addEventListener('click', () => {
        _selectedLanguage = key;
        setLangActive(lb);
        chrome.storage.local.set({ tapfill_language: key });
        if (_langCache[key]) {
          _currentVariants = _langCache[key];
          showComment(_currentVariants[ENERGIES[_currentEnergyIdx].key]);
        } else if (key === 'hinglish' && _langCache['hindi']) {
          const hl = transliterateVariants(_langCache['hindi']);
          _langCache['hinglish'] = hl;
          _currentVariants = hl;
          showComment(_currentVariants[ENERGIES[_currentEnergyIdx].key]);
        } else if (_currentTone) {
          generateAllAndShow(_currentTone);
        }
      });
      langRow.appendChild(lb);
      chrome.storage.local.get('tapfill_language', (r) => { if ((r.tapfill_language || 'english') === key) setLangActive(lb); });
    });
    menu.appendChild(langRow);

    // ── Gradient separator ───────────────────────────────────────────────────
    const sep = document.createElement('div');
    Object.assign(sep.style, {
      height: '1px',
      background: 'linear-gradient(to right, transparent, #e2e8f0, transparent)',
      margin: '12px 0 0', display: 'none',
    });
    menu.appendChild(sep);

    // ── Result card ──────────────────────────────────────────────────────────
    const resultCard = document.createElement('div');
    Object.assign(resultCard.style, {
      marginTop: '10px', display: 'none', flexDirection: 'column', gap: '8px',
    });
    menu.appendChild(resultCard);

    // Vibe loading text (replaces spinner)
    const spinnerWrap = document.createElement('div');
    Object.assign(spinnerWrap.style, { display: 'none', padding: '4px 2px' });
    resultCard.appendChild(spinnerWrap);

    // Comment text
    const commentEl = document.createElement('p');
    Object.assign(commentEl.style, {
      margin: '0', fontSize: '13px', lineHeight: '1.6', color: '#1e293b',
      padding: '2px', display: 'none',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    });
    resultCard.appendChild(commentEl);

    // ── Action buttons (flat 3-button row) ───────────────────────────────────
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
    // ↻ small icon-only refresh button (fixed width, like mobile)
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button'; refreshBtn.textContent = '↻';
    Object.assign(refreshBtn.style, {
      width: '34px', flexShrink: '0', padding: '7px 0', borderRadius: '10px',
      border: '1.5px solid #e2e8f0', background: 'transparent',
      color: '#6366f1', fontSize: '14px', fontWeight: '600',
      cursor: 'pointer', fontFamily: 'inherit',
    });
    refreshBtn.addEventListener('mousedown', e => e.preventDefault());

    const canvasBtn    = mkBtn('Canvas',     { border: '1.5px solid #e2e8f0', background: 'transparent', color: '#64748b' });
    const addCanvasBtn = mkBtn('+ Canvas',   { border: '1.5px solid #818cf8', background: 'transparent', color: '#6366f1' });
    const useBtn       = mkBtn('Use this →', { border: 'none', background: 'linear-gradient(135deg,#6366f1,#818cf8)', color: '#fff' });
    actionRow.append(refreshBtn, canvasBtn, addCanvasBtn, useBtn);
    resultCard.appendChild(actionRow);

    // ── Energy bar (progressive dots, no connecting line) ────────────────────
    const ENERGIES = [
      { label: 'Subtle',   key: 'subtle',   tempScale: 0.35 },
      { label: 'Balanced', key: 'balanced', tempScale: 1.0  },
      { label: 'Bold',     key: 'bold',     tempScale: 1.4  },
      { label: 'Powerful', key: 'powerful', tempScale: 1.85 },
    ];
    const DOT_PALETTE = [
      { fill: '#ede9fe', border: '#c4b5fd', ring: '#a78bfa', label: '#a78bfa' },
      { fill: '#c7d2fe', border: '#818cf8', ring: '#818cf8', label: '#818cf8' },
      { fill: '#818cf8', border: '#6366f1', ring: '#6366f1', label: '#6366f1' },
      { fill: '#6366f1', border: '#4338ca', ring: '#4338ca', label: '#4338ca' },
    ];

    const energyBar = document.createElement('div');
    Object.assign(energyBar.style, { display: 'none', padding: '10px 4px 4px' });

    const energyDotsRow = document.createElement('div');
    Object.assign(energyDotsRow.style, { display: 'flex', justifyContent: 'space-between' });
    energyBar.appendChild(energyDotsRow);

    const energyDots = [];
    ENERGIES.forEach((energy, idx) => {
      const pal = DOT_PALETTE[idx];
      const item = document.createElement('div');
      Object.assign(item.style, {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '4px', cursor: 'pointer',
      });
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        width: '32px', height: '32px', borderRadius: '50%',
        background: pal.fill, border: `2px solid ${pal.border}`,
        boxSizing: 'border-box', transition: 'box-shadow 0.15s',
        boxShadow: idx === 1 ? `0 0 0 2px #fff, 0 0 0 4px ${pal.ring}` : 'none',
      });
      energyDots.push(dot);
      const energyLabelEl = document.createElement('span');
      energyLabelEl.textContent = energy.label;
      Object.assign(energyLabelEl.style, {
        fontSize: '9px', fontWeight: '500', color: pal.label,
        lineHeight: '1.2', whiteSpace: 'nowrap',
      });
      item.append(dot, energyLabelEl);
      energyDotsRow.appendChild(item);
      item.addEventListener('mousedown', e => e.preventDefault());
      item.addEventListener('click', () => {
        if (_currentEnergyIdx === idx || !_currentTone) return;
        energyDots[_currentEnergyIdx].style.boxShadow = 'none';
        energyDots[idx].style.boxShadow = `0 0 0 2px #fff, 0 0 0 4px ${DOT_PALETTE[idx].ring}`;
        _currentEnergyIdx = idx;
        // Instant swap — no API call needed
        if (_currentVariants) showComment(_currentVariants[ENERGIES[idx].key]);
      });
    });
    resultCard.insertBefore(energyBar, actionRow);

    // ── State ─────────────────────────────────────────────────────────────────
    let _canvasItems      = [];
    let _selectedChip     = null;
    let _currentTone      = null;
    let _currentComment   = null;
    let _currentCommentId = null;
    let _currentVariants  = null;  // { subtle, balanced, bold, powerful }
    let _langCache        = {};
    let _currentEnergyIdx = 1;
    let _lastCopied       = false;

    function clampPosition() {
      requestAnimationFrame(() => {
        const mRect = menu.getBoundingClientRect();
        const GAP = 8;
        if (mRect.bottom > window.innerHeight - GAP) {
          const newTop = parseFloat(menu.style.top) - (mRect.bottom - (window.innerHeight - GAP));
          menu.style.top = `${Math.max(GAP, newTop)}px`;
        }
        if (parseFloat(menu.style.top) < GAP) menu.style.top = `${GAP}px`;
      });
    }

    function showLoading() {
      _currentComment   = null;
      _currentCommentId = null;
      _currentVariants  = null;
      sep.style.display = '';
      resultCard.style.display = 'flex';
      spinnerWrap.innerHTML = '<span class="pin-vibe-text">Building your vibe…</span>';
      spinnerWrap.style.display = '';
      commentEl.style.display = 'none';
      energyBar.style.display = 'none';
      actionRow.style.display = 'none';
      clampPosition();
    }

    function showComment(text) {
      _currentComment = text;
      spinnerWrap.style.display = 'none';
      commentEl.textContent = text;
      commentEl.style.display = '';
      energyBar.style.display = '';
      actionRow.style.display = 'flex';
      clampPosition();
    }

    function showError(notConnected, isLimit) {
      _currentComment = null;
      spinnerWrap.innerHTML = '';
      if (isLimit) {
        const limitDiv = document.createElement('div');
        Object.assign(limitDiv.style, {
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '4px 0',
        });
        const limitSpan = document.createElement('span');
        Object.assign(limitSpan.style, { color: '#f59e0b', fontSize: '12px', textAlign: 'center', fontWeight: '600' });
        limitSpan.textContent = 'Daily limit reached.';
        const upgradeBtn = document.createElement('button');
        Object.assign(upgradeBtn.style, {
          background: 'linear-gradient(135deg,#818cf8,#5B54F5)', color: '#fff', border: 'none',
          borderRadius: '32px', padding: '6px 18px', fontSize: '12px', fontWeight: '600',
          cursor: 'pointer', fontFamily: 'inherit',
        });
        upgradeBtn.textContent = 'Upgrade Now →';
        upgradeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        upgradeBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'OPEN_URL', url: 'https://tapfill.io/pricing' });
        });
        limitDiv.appendChild(limitSpan);
        limitDiv.appendChild(upgradeBtn);
        spinnerWrap.appendChild(limitDiv);
        spinnerWrap.style.display = 'flex';
      } else if (notConnected) {
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
          borderRadius: '32px', padding: '6px 18px', fontSize: '12px', fontWeight: '600',
          cursor: 'pointer', fontFamily: 'inherit',
        });
        connectBtn.textContent = 'Connect account →';
        connectBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); clearTimeout(tapHideTimer); });
        connectBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_CONNECT' }));
        notSignedDiv.appendChild(notSignedSpan);
        notSignedDiv.appendChild(connectBtn);
        spinnerWrap.appendChild(notSignedDiv);
        spinnerWrap.style.display = 'flex';
      } else {
        spinnerWrap.innerHTML = `<span style="font-size:12px;color:#ef4444">Could not read this pin. Please try again.</span>`;
        spinnerWrap.style.display = '';
      }
      commentEl.style.display = 'none';
      energyBar.style.display = 'none';
      actionRow.style.display = 'none';
      clampPosition();
    }

    async function generateAllAndShow(toneObj) {
      // Fast pre-check: bail immediately if no token in storage
      const _preCheck = await new Promise(r => chrome.storage.local.get('tapfill_token', r));
      if (!_preCheck.tapfill_token?.access_token) { showError(true, false); return; }
      showLoading();
      try {
        // Ensure postText is populated — retry scrape if page wasn't fully loaded when menu opened
        let pinText = _menuPinText;
        if (!pinText || !pinText.trim()) {
          console.log('[Tapfill] _menuPinText empty — re-scraping Pinterest DOM');
          pinText = scrapePinText();
          _menuPinText = pinText;
        }

        const { variants, commentId, toneOrder: newToneOrder } = await generateAllVariants(pinText, toneObj);
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
        console.error('[Tapfill] generate failed:', err);
        const isRateLimit = err.rateLimit || err.message?.includes('429') || err.message?.toLowerCase().includes('daily limit');
        showError(err.notConnected, isRateLimit);
      }
    }

    useBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_currentComment) return;
      // Save reference now — closeTapMenu() will null _menuActiveTextbox
      const textbox = _menuActiveTextbox || document.querySelector(TEXTBOX_SEL);
      if (textbox) {
        insertTextReact(textbox, _currentComment);
      }
      if (_currentCommentId) {
        const port = chrome.runtime.connect({ name: 'AI_FETCH' });
        port.postMessage({ type: 'FEEDBACK', commentId: _currentCommentId, signal: 'use' });
        setTimeout(() => port.disconnect(), 1000);
      }
      _lastCopied = true;
      closeTapMenu();
      clearTimeout(tapHideTimer);
      // Do NOT programmatically re-focus here. insertTextReact already focused
      // the textbox. All menu buttons have e.preventDefault() on mousedown so
      // focus never left the textbox during the entire menu interaction.
      // closeTapMenu() removes a div that had no focus — it cannot trigger a
      // focusout on the textbox. Extra focus() calls trigger Pinterest React
      // re-renders that crash with removeChild errors.
    });

    addCanvasBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_currentComment || !_currentTone) return;
      _canvasItems.push({
        id: Date.now(), text: _currentComment,
        toneEmoji: _currentTone.emoji, toneLabel: _currentTone.label,
        energyLabel: ENERGIES[_currentEnergyIdx].label,
      });
      const orig = addCanvasBtn.textContent;
      addCanvasBtn.textContent = '✓ Saved!';
      addCanvasBtn.style.color  = '#10b981';
      addCanvasBtn.style.border = '1.5px solid #10b981';
      setTimeout(() => {
        addCanvasBtn.textContent = orig;
        addCanvasBtn.style.color  = '#6366f1';
        addCanvasBtn.style.border = '1.5px solid #818cf8';
      }, 1500);
    });

    // ── Inline canvas view ────────────────────────────────────────────────────
    const mainViewEls = [header, chipsRow, langRow, sep, resultCard];

    const canvasView = document.createElement('div');
    Object.assign(canvasView.style, {
      display: 'none', flexDirection: 'column',
      flex: '1', minHeight: '0', overflow: 'hidden', paddingBottom: '16px',
    });
    canvasView.addEventListener('mousedown', e => e.preventDefault());
    menu.appendChild(canvasView);

    // Canvas header: deep navy with glow
    const cvHdr = document.createElement('div');
    Object.assign(cvHdr.style, { background: 'linear-gradient(135deg,#050816,#0B1023,#171B46)', borderRadius: '12px', marginBottom: '10px', padding: '12px 14px', position: 'relative', overflow: 'hidden' });
    const cvGlow1 = document.createElement('div');
    Object.assign(cvGlow1.style, { position: 'absolute', top: '-20px', left: '-20px', width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(99,102,241,0.2)', pointerEvents: 'none' });
    const cvGlow2 = document.createElement('div');
    Object.assign(cvGlow2.style, { position: 'absolute', bottom: '-15px', right: '-15px', width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(139,92,246,0.15)', pointerEvents: 'none' });
    const cvLogoIcon = document.createElement('div');
    Object.assign(cvLogoIcon.style, { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(139,92,246,0.4)', boxShadow: '0 0 10px rgba(139,92,246,0.4)', marginRight: '10px', fontSize: '12px', fontWeight: '800', color: '#fff', flexShrink: '0' });
    cvLogoIcon.textContent = 'T';
    const cvTextWrap = document.createElement('div');
    Object.assign(cvTextWrap.style, { display: 'flex', flexDirection: 'column' });
    const cvWordmark = document.createElement('span');
    cvWordmark.textContent = 'Tapfill';
    Object.assign(cvWordmark.style, { fontSize: '12px', fontWeight: '800', color: '#fff', lineHeight: '1.2', textShadow: '0 0 12px rgba(139,92,246,0.55)' });
    const cvDivider = document.createElement('div');
    Object.assign(cvDivider.style, { height: '1px', background: 'rgba(255,255,255,0.18)', margin: '4px 0 3px' });
    const cvSubtitle = document.createElement('span');
    cvSubtitle.textContent = 'MY COMMENT CANVAS';
    Object.assign(cvSubtitle.style, { fontSize: '7px', fontWeight: '600', color: 'rgba(216,180,254,0.85)', letterSpacing: '2px' });
    cvTextWrap.append(cvWordmark, cvDivider, cvSubtitle);
    const cvHdrInner = document.createElement('div');
    Object.assign(cvHdrInner.style, { display: 'flex', alignItems: 'center', position: 'relative', zIndex: '1' });
    cvHdrInner.append(cvLogoIcon, cvTextWrap);
    cvHdr.append(cvGlow1, cvGlow2, cvHdrInner);
    canvasView.appendChild(cvHdr);

    // Scrollable list
    const cvList = document.createElement('div');
    Object.assign(cvList.style, { flex: '1', minHeight: '0', overflowY: 'auto', padding: '2px 0 6px' });
    canvasView.appendChild(cvList);

    // Footer buttons
    const cvFooter = document.createElement('div');
    Object.assign(cvFooter.style, { display: 'flex', gap: '6px', paddingTop: '10px', paddingBottom: '6px', borderTop: '1px solid rgba(139,92,246,0.1)' });
    const backBtn  = mkBtn('← Back',    { border: '1.5px solid #e2e8f0', background: 'transparent', color: '#64748b' });
    const shareBtn = mkBtn('Share 📤',  { border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', boxShadow: '0 3px 12px rgba(99,102,241,0.3)' });
    backBtn.addEventListener('click', () => showMainView());
    shareBtn.addEventListener('click', () => shareCanvasAsImage());
    cvFooter.append(backBtn, shareBtn);
    canvasView.appendChild(cvFooter);

    // ── Share as image ─────────────────────────────────────────────────────────
    async function shareCanvasAsImage() {
      if (!_canvasItems.length) return;
      const W = 380, PAD = 18, CARD_GAP = 12, LINE_H = 19, EMO_W = 80;
      const CARD_PAD = 14, HDR_H = 76, FTR_H = 36, DPR = 2;
      const ff = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const ENERGY_ACCENT = { subtle: '#a78bfa', balanced: '#818cf8', bold: '#6366f1', powerful: '#4338ca' };
      const tmp = document.createElement('canvas').getContext('2d');
      tmp.font = `13px ${ff}`;
      const TEXT_W = W - PAD * 2 - EMO_W - CARD_PAD - 8;
      function wrapHeight(text) {
        let line = '', rows = 1;
        text.split(/\s+/).forEach(w => {
          const t = line ? line + ' ' + w : w;
          if (tmp.measureText(t).width > TEXT_W) { rows++; line = w; } else line = t;
        });
        return CARD_PAD * 2 + 24 + rows * LINE_H;
      }
      const cardHeights = _canvasItems.map(i => wrapHeight(i.text));
      const totalH = HDR_H + PAD + cardHeights.reduce((a, h) => a + h + CARD_GAP, 0) + PAD + FTR_H;
      const cv = document.createElement('canvas');
      cv.width = W * DPR; cv.height = totalH * DPR;
      const ctx = cv.getContext('2d');
      ctx.scale(DPR, DPR);
      const bgGrad = ctx.createLinearGradient(0, 0, W, totalH);
      bgGrad.addColorStop(0, '#eef2ff'); bgGrad.addColorStop(1, '#faf5ff');
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, totalH);
      ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(99,102,241,0.13)'; ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.roundRect(0, 0, W, HDR_H, [0, 0, 16, 16]); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      const barGrad = ctx.createLinearGradient(0, 0, W, 0);
      barGrad.addColorStop(0, '#6366f1'); barGrad.addColorStop(0.5, '#a78bfa'); barGrad.addColorStop(1, '#818cf8');
      ctx.fillStyle = barGrad;
      ctx.beginPath(); ctx.roundRect(0, 0, W, 5, [0, 0, 0, 0]); ctx.fill();
      const hdrImg = new Image();
      hdrImg.src = LOGO_URL;
      await new Promise(r => { hdrImg.onload = r; hdrImg.onerror = r; });
      const ICON_H = 28, ICON_W = hdrImg.width ? Math.round(hdrImg.width * (ICON_H / hdrImg.height)) : 28;
      ctx.drawImage(hdrImg, PAD, (HDR_H - ICON_H) / 2, ICON_W, ICON_H);
      ctx.font = `700 15px ${ff}`; ctx.fillStyle = '#6366f1';
      ctx.fillText('tapfill', PAD + ICON_W + 8, HDR_H / 2 - 4);
      ctx.font = `400 13px ${ff}`; ctx.fillStyle = '#cbd5e1';
      ctx.fillText('·  My Canvas', PAD + ICON_W + 8, HDR_H / 2 + 9);
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, HDR_H); ctx.lineTo(W, HDR_H); ctx.stroke();
      let y = HDR_H + PAD;
      _canvasItems.forEach((item, i) => {
        const ch = cardHeights[i], cx = PAD, cw = W - PAD * 2;
        const accent = ENERGY_ACCENT[(item.energyLabel || '').toLowerCase()] || '#818cf8';
        ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(99,102,241,0.10)'; ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.roundRect(cx, y, cw, ch, 14); ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.roundRect(cx, y, 5, ch, [14, 0, 0, 14]); ctx.fill();
        ctx.font = `32px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, serif`;
        ctx.fillStyle = '#000'; ctx.fillText(item.toneEmoji, cx + 16, y + CARD_PAD + 18);
        ctx.font = `bold 9px ${ff}`; ctx.fillStyle = accent;
        ctx.fillText(item.toneLabel.toUpperCase(), cx + 16, y + CARD_PAD + 34);
        ctx.font = `8px ${ff}`; ctx.fillStyle = '#94a3b8';
        ctx.fillText(item.energyLabel, cx + 16, y + CARD_PAD + 46);
        ctx.font = `13px ${ff}`; ctx.fillStyle = '#1e293b';
        const tx = cx + EMO_W + 8; let line = '', ty = y + CARD_PAD + LINE_H;
        item.text.split(/\s+/).forEach(w => {
          const t = line ? line + ' ' + w : w;
          if (ctx.measureText(t).width > TEXT_W) { ctx.fillText(line, tx, ty); line = w; ty += LINE_H; } else line = t;
        });
        if (line) ctx.fillText(line, tx, ty);
        y += ch + CARD_GAP;
      });
      const fy = totalH - FTR_H + 14;
      const wmGrad = ctx.createLinearGradient(PAD, 0, PAD + 200, 0);
      wmGrad.addColorStop(0, '#6366f1'); wmGrad.addColorStop(1, '#a78bfa');
      ctx.font = `bold 11px ${ff}`; ctx.fillStyle = wmGrad;
      ctx.fillText('✦  Made with Tapfill', PAD, fy);
      ctx.font = `9px ${ff}`; ctx.fillStyle = '#94a3b8';
      ctx.fillText('tapfill.io', W - PAD - ctx.measureText('tapfill.io').width, fy);
      cv.toBlob(async blob => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          const orig = shareBtn.textContent;
          shareBtn.textContent = '✓ Copied!';
          shareBtn.style.background = '#10b981';
          setTimeout(() => {
            shareBtn.textContent = orig;
            shareBtn.style.background = 'linear-gradient(135deg,#6366f1,#818cf8)';
          }, 1800);
        } catch (e) {
          console.warn('[Tapfill] clipboard blocked:', e.message);
        }
      }, 'image/png');
    }

    let _savedDisplays = [];

    function renderCanvasInline() {
      cvList.innerHTML = '';
      if (!_canvasItems.length) {
        const empty = document.createElement('p');
        Object.assign(empty.style, { margin: '0', textAlign: 'center', color: '#94a3b8', fontSize: '12px', padding: '32px 0' });
        empty.textContent = 'No comments saved yet.';
        cvList.appendChild(empty);
        return;
      }
      _canvasItems.forEach(item => {
        const card = document.createElement('div');
        Object.assign(card.style, { background: '#fff', borderRadius: '14px', boxShadow: '0 2px 14px rgba(99,102,241,0.08), 0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden', marginBottom: '8px' });
        const cardTop = document.createElement('div');
        Object.assign(cardTop.style, { display: 'flex', gap: '5px', flexWrap: 'wrap', padding: '9px 12px 7px', background: '#fafbff', borderBottom: '1px solid rgba(139,92,246,0.06)' });
        const toneBadge = document.createElement('span');
        toneBadge.textContent = `${item.toneEmoji} ${item.toneLabel}`;
        Object.assign(toneBadge.style, { fontSize: '9px', fontWeight: '700', color: '#7C3AED', background: 'rgba(139,92,246,0.1)', padding: '2px 8px', borderRadius: '20px' });
        const energyBadge = document.createElement('span');
        energyBadge.textContent = item.energyLabel;
        Object.assign(energyBadge.style, { fontSize: '9px', fontWeight: '600', color: '#059669', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: '20px' });
        cardTop.append(toneBadge, energyBadge);
        const cardBody = document.createElement('div');
        Object.assign(cardBody.style, { display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '10px 12px' });
        const textEl = document.createElement('p');
        Object.assign(textEl.style, { margin: '0', flex: '1', fontSize: '12px', lineHeight: '1.65', color: '#0F172A', wordBreak: 'break-word' });
        textEl.textContent = item.text;
        const discardBtn = document.createElement('button');
        discardBtn.type = 'button'; discardBtn.textContent = '×';
        Object.assign(discardBtn.style, { background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: '16px', lineHeight: '1', padding: '0 2px', fontFamily: 'inherit', flexShrink: '0' });
        discardBtn.addEventListener('mousedown', e => e.preventDefault());
        discardBtn.addEventListener('mouseenter', () => { discardBtn.style.color = '#ef4444'; });
        discardBtn.addEventListener('mouseleave', () => { discardBtn.style.color = '#cbd5e1'; });
        discardBtn.addEventListener('click', () => { _canvasItems = _canvasItems.filter(c => c.id !== item.id); renderCanvasInline(); });
        cardBody.append(textEl, discardBtn);
        card.append(cardTop, cardBody);
        cvList.appendChild(card);
      });
    }

    function showCanvasView() {
      _savedDisplays = mainViewEls.map(el => el.style.display);
      mainViewEls.forEach(el => { el.style.display = 'none'; });
      menu.style.overflow = 'hidden';
      canvasView.style.display = 'flex';
      renderCanvasInline();
      requestAnimationFrame(() => {
        const GAP = 8;
        const mTop = parseFloat(menu.style.top) || menu.getBoundingClientRect().top;
        const avail = window.innerHeight - mTop - GAP;
        menu.style.maxHeight = `${Math.min(avail, 520)}px`;
        const mRect = menu.getBoundingClientRect();
        if (mRect.bottom > window.innerHeight - GAP) {
          const shift = mRect.bottom - (window.innerHeight - GAP);
          menu.style.top = `${Math.max(GAP, parseFloat(menu.style.top) - shift)}px`;
          menu.style.maxHeight = `${Math.min(window.innerHeight - parseFloat(menu.style.top) - GAP, 520)}px`;
        }
      });
    }

    function showMainView() {
      mainViewEls.forEach((el, i) => { el.style.display = _savedDisplays[i] !== undefined ? _savedDisplays[i] : ''; });
      canvasView.style.display = 'none';
      menu.style.maxHeight = '';
      clampPosition();
    }

    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_currentTone) generateForTone(_currentTone);
    });

    canvasBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCanvasView();
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
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '5px', padding: '8px 6px', border: '2px solid transparent',
        borderRadius: '12px', background: '#f8fafc', cursor: 'pointer',
        fontFamily: 'inherit', transition: 'background 0.15s, border-color 0.15s',
        minWidth: '54px', flexShrink: '0',
      });
      const emojiEl = document.createElement('span');
      emojiEl.textContent = toneObj.emoji;
      Object.assign(emojiEl.style, { fontSize: '32px', lineHeight: '1' });
      const labelEl = document.createElement('span');
      labelEl.textContent = toneObj.label;
      Object.assign(labelEl.style, {
        fontSize: '10px', fontWeight: '600', color: '#64748b',
        lineHeight: '1.2', textAlign: 'center',
      });
      chip.append(emojiEl, labelEl);
      chipsRow.appendChild(chip);
      chip.addEventListener('mousedown', e => e.preventDefault());
      chip.addEventListener('mouseenter', () => { if (_selectedChip !== chip) chip.style.background = '#f1f5f9'; });
      chip.addEventListener('mouseleave', () => { if (_selectedChip !== chip) chip.style.background = '#f8fafc'; });
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
        if (_currentEnergyIdx !== 1) {
          energyDots[_currentEnergyIdx].style.boxShadow = 'none';
          energyDots[1].style.boxShadow = `0 0 0 2px #fff, 0 0 0 4px ${DOT_PALETTE[1].ring}`;
          _currentEnergyIdx = 1;
        }
        chip.style.background  = '#eef2ff';
        chip.style.borderColor = '#818cf8';
        labelEl.style.color    = '#6366f1';
        generateAllAndShow(toneObj);
      });
    });

    document.body.appendChild(menu);
    return { menu };
  }

  // ─── Open / close menu ───────────────────────────────────────────────────────

  function openTapMenu(tapRootBtn) {
    closeTapMenu();

    _menuActiveTextbox = document.querySelector(TEXTBOX_SEL);
    _menuPinText       = scrapePinText();

    const { menu } = buildTapMenu();

    const bRect   = tapRootBtn.getBoundingClientRect();
    const POPUP_W = 320;
    const menuH   = menu.offsetHeight || 320;

    const GAP = 8;
    let top  = bRect.top - menuH - GAP;
    let left = bRect.left;

    if (top < GAP) top = bRect.bottom + GAP;
    if (top + menuH > window.innerHeight - GAP) top = window.innerHeight - menuH - GAP;
    if (left + POPUP_W > window.innerWidth - GAP) left = window.innerWidth - POPUP_W - GAP;
    if (left < GAP) left = GAP;

    menu.style.top        = `${top}px`;
    menu.style.left       = `${left}px`;
    menu.style.visibility = '';

    setTimeout(() => document.addEventListener('click', onClickAway, true), 0);
  }

  function closeTapMenu() {
    document.getElementById(TAP_MENU_ID)?.remove();
    document.removeEventListener('click', onClickAway, true);
    _menuActiveTextbox = null;
    _menuPinText       = '';
  }

  function onClickAway(e) {
    const menu   = document.getElementById(TAP_MENU_ID);
    const tapBtn = document.getElementById(TAP_ROOT_ID);
    if (!menu) { document.removeEventListener('click', onClickAway, true); return; }
    if (!menu.contains(e.target) && !tapBtn?.contains(e.target)) closeTapMenu();
  }

  // ─── Build / position the T button ───────────────────────────────────────────

  function getOrCreateTapRoot() {
    const existing = document.getElementById(TAP_ROOT_ID);
    if (existing) {
      existing.style.height = '32px';
      const img = existing.querySelector('img');
      if (img) { img.style.height = '32px'; img.style.width = 'auto'; img.removeAttribute('height'); }
      return existing;
    }

    const btn = document.createElement('button');
    btn.id   = TAP_ROOT_ID;
    btn.type = 'button';
    btn.title = 'Pintfill – Comment Assistant';
    btn.setAttribute('aria-label', 'Comment Assistant');

    Object.assign(btn.style, {
      position:       'fixed',
      display:        'none',
      alignItems:     'center',
      justifyContent: 'center',
      width:          'auto',
      height:         '32px',
      padding:        '0',
      border:         'none',
      background:     'transparent',
      cursor:         'pointer',
      zIndex:         '999999',
      outline:        'none',
      transition:     'transform 0.12s ease',
    });

    btn.innerHTML = `<img src="${LOGO_URL}" style="display:block;height:32px;width:auto" draggable="false">`;

    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.12)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
    btn.addEventListener('mousedown',  (e) => e.preventDefault());

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

    document.body.appendChild(btn);
    return btn;
  }

  // ─── Find the leftmost anchor button in the comment toolbar ─────────────────
  //
  //  Walk up from the textbox until we reach a container that holds Pinterest's
  //  native icon buttons (emoji, Send, sticker…).  Return the leftmost one so
  //  T can be placed just to its left with a consistent gap.

  // Returns { first, second } DOMRects of the two leftmost toolbar buttons
  // so the caller can compute center-to-center spacing.
  function findFirstToolbarBtn(textbox) {
    let el = textbox.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!el || el === document.body) break;
      const btns = [...el.querySelectorAll('button, [role="button"]')]
        .filter(b => b.id !== TAP_ROOT_ID)
        .filter(b => {
          const br = b.getBoundingClientRect();
          return br.width > 0 && br.height > 0;
        });
      if (btns.length >= 2) {
        const r = textbox.getBoundingClientRect();
        const rightBtns = btns
          .map(b => b.getBoundingClientRect())
          .filter(br => br.left > r.left)
          .sort((a, b) => a.left - b.left);
        if (rightBtns.length >= 2) {
          return { first: rightBtns[0], second: rightBtns[1] };
        }
        if (rightBtns.length === 1) {
          return { first: rightBtns[0], second: null };
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function positionTapRoot(textbox) {
    const r = textbox.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    const btn    = getOrCreateTapRoot();
    const result = findFirstToolbarBtn(textbox);
    const first  = result?.first;
    const second = result?.second;

    // Make visible (hidden) so we can measure the actual rendered width of the T button.
    btn.style.visibility = 'hidden';
    btn.style.display    = 'inline-flex';

    requestAnimationFrame(() => {
      const tW = btn.getBoundingClientRect().width || 14;

      let leftPos, topPos;
      if (first && second) {
        // Mirror the exact center-to-center spacing between emoji and sticker icons.
        const c2c = (second.left + second.width / 2) - (first.left + first.width / 2);
        leftPos   = (first.left + first.width / 2) - c2c - tW / 2;
        topPos    = first.top + (first.height - 32) / 2;
      } else if (first) {
        leftPos = first.left - tW - 8;
        topPos  = first.top + (first.height - 32) / 2;
      } else {
        leftPos = r.right + 8;
        topPos  = r.top + (r.height - 32) / 2;
      }

      btn.style.left       = `${leftPos}px`;
      btn.style.top        = `${topPos}px`;
      btn.style.visibility = '';
    });
  }

  function hideTapRoot() {
    closeTapMenu();
    stopToolbarObserver();
    const btn = document.getElementById(TAP_ROOT_ID);
    if (btn) btn.style.display = 'none';
  }

  // ─── MutationObserver — reposition when Send button appears / disappears ──────
  //
  //  Pinterest injects a "Send" button into the toolbar as soon as the user
  //  types, shifting all icons left.  Observing childList mutations on the
  //  toolbar container is the most reliable way to catch that change.

  let _toolbarObserver = null;

  function startToolbarObserver(textbox) {
    stopToolbarObserver();
    // Find the toolbar container (same logic as findFirstToolbarBtn)
    let container = textbox.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!container || container === document.body) break;
      const btns = container.querySelectorAll('button, [role="button"]');
      if (btns.length >= 2) break;
      container = container.parentElement;
    }
    if (!container || container === document.body) return;

    _toolbarObserver = new MutationObserver(() => {
      if (textboxFocused) positionTapRoot(textbox);
    });
    _toolbarObserver.observe(container, { childList: true, subtree: true });
  }

  function stopToolbarObserver() {
    if (_toolbarObserver) { _toolbarObserver.disconnect(); _toolbarObserver = null; }
  }

  // ─── Scroll / resize reposition ───────────────────────────────────────────────

  let textboxFocused = false;
  let tapHideTimer   = null;

  function reposition() {
    if (!textboxFocused) return;
    const textbox = document.querySelector(TEXTBOX_SEL);
    if (textbox) positionTapRoot(textbox);
  }

  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });

  // ─── focusin / focusout ───────────────────────────────────────────────────────

  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (
      target.nodeType === Node.ELEMENT_NODE &&
      target.getAttribute('contenteditable') === 'true' &&
      target.getAttribute('role') === 'combobox' &&
      target.getAttribute('aria-label')?.startsWith('Add a comment')
    ) {
      textboxFocused = true;
      clearTimeout(tapHideTimer);

      setTimeout(() => { if (textboxFocused) positionTapRoot(target); }, 100);
      setTimeout(() => {
        if (!textboxFocused) return;
        positionTapRoot(target);
        startToolbarObserver(target); // begin watching for Send btn changes
      }, 350);
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    const target = e.target;
    if (
      target.nodeType === Node.ELEMENT_NODE &&
      target.getAttribute('contenteditable') === 'true' &&
      target.getAttribute('role') === 'combobox' &&
      target.getAttribute('aria-label')?.startsWith('Add a comment')
    ) {
      textboxFocused = false;
      tapHideTimer = setTimeout(hideTapRoot, 200);
    }
  }, true);

  // ── Heartbeat — keeps extension_sessions.last_active fresh ──────────────────
  function sendHeartbeat() {
    chrome.runtime.sendMessage({ type: 'HEARTBEAT' }, () => { void chrome.runtime.lastError; });
  }
  setTimeout(sendHeartbeat, 10000);
  setInterval(sendHeartbeat, 30 * 60 * 1000);

})();
