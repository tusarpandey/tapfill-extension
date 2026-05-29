// ==UserScript==
// @name         Lifill – LinkedIn Comment Assistant
// @namespace    https://tapfill.io
// @version      1.0.0
// @description  Injects an AI comment-assistant button into every LinkedIn comment box.
// @author       Tapfill
// @match        https://www.linkedin.com/*
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Config ───────────────────────────────────────────────────────────────────

  // API key is stored securely in background.js only.
  // (model handled server-side via Tapfill SaaS)

  // ─── Constants ────────────────────────────────────────────────────────────────

  const TAP_ROOT_ID = 'li-tap-root';
  const TAP_MENU_ID = 'li-tap-menu';

  // LinkedIn uses contenteditable divs for comment boxes.
  // The aria-label contains "comment" in any language variation.
  const TEXTBOX_SEL = 'div[contenteditable="true"][role="textbox"]';

  // ─── Tones ────────────────────────────────────────────────────────────────────

  const TONES = [
    { emoji: '🎩', label: 'Classic',   desc: 'Polished and timeless.',            tone: 'classic',      temp: 0.2 },
    { emoji: '🌻', label: 'Friendly',  desc: 'Warm, heartfelt, caring.',          tone: 'friendly',     temp: 0.5 },
    { emoji: '💎', label: 'Confident', desc: 'Direct. Clear. No second-guessing.', tone: 'confident',   temp: 0.3 },
    { emoji: '😄', label: 'Funny',     desc: 'Playful and clever. Makes you smile.', tone: 'funny',     temp: 0.9 },
    { emoji: '🎬', label: 'Filmy',     desc: 'Full cinematic. Dramatic flair.',   tone: 'filmy',        temp: 0.8 },
  ];

  const CREATOR_TONES = [
    { emoji: '🔥', label: 'Bold',       desc: 'Sharp. Direct. No filter.',   tone: 'bold_tone', temp: 0.9, tonePrompt: 'Write a sharp, edgy, unapologetic comment. Says what everyone is thinking but nobody says out loud. Strong take delivered with conviction. No softening, no hedging.' },
    { emoji: '🧘', label: 'Wise',       desc: 'Deep insight. Quotable.',     tone: 'wise',      temp: 0.4, tonePrompt: 'Write a thoughtful, philosophical comment like a mentor speaking. Deep insight, quotable, the kind of comment people screenshot and share.' },
    { emoji: '💫', label: 'Hype',       desc: 'High energy. Celebratory.',   tone: 'hype',      temp: 0.9, tonePrompt: 'Write an energetic, enthusiastic comment full of excitement. Like a best friend cheering someone on. High energy, motivating, celebratory.' },
    { emoji: '😏', label: 'Sarcastic',  desc: 'Dry. Clever. Smart.',         tone: 'sarcastic', temp: 0.8, tonePrompt: 'Write a dry, clever, subtly sarcastic comment. The kind that makes people laugh and think at the same time. Smart sarcasm, not mean or offensive.' },
    { emoji: '🌶️', label: 'Desi',       desc: 'Indian humor. Relatable.',    tone: 'desi',      temp: 0.9, tonePrompt: 'Write a funny, relatable, quintessentially Indian humor comment. Use cultural references, Indian expressions, light sarcasm. The kind of comment that makes an Indian say yaar yeh toh bilkul sach hai.' },
  ];

  let _userPlan = 'free';
  chrome.storage.local.get('tapfill_user', (r) => { _userPlan = r.tapfill_user?.plan || 'free'; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tapfill_user) _userPlan = changes.tapfill_user.newValue?.plan || 'free';
  });

  async function getUserPlan() {
    const stored = await new Promise(resolve =>
      chrome.storage.local.get(['tapfill_user', 'tapfill_token'], resolve)
    );
    const token = stored.tapfill_token?.access_token;
    if (token) {
      try {
        const res = await fetch('https://tapfill.io/api/ext/profile', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.plan) {
            const existing = stored.tapfill_user || {};
            chrome.storage.local.set({ tapfill_user: { ...existing, plan: data.plan } });
            return data.plan;
          }
        }
      } catch (e) { /* ignore */ }
    }
    // API did not confirm plan — always default to free (never trust stale cache for plan gating)
    return 'free';
  }

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
    if (document.getElementById('li-tap-styles')) return;
    const s = document.createElement('style');
    s.id = 'li-tap-styles';
    s.textContent = '@keyframes li-tap-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  // ─── Tapfill logo (height 24, auto width) ────────────────────────────────────

  const LOGO_URL = chrome.runtime.getURL('icons/icon-48.png');

  // ─── React-compatible text insertion (contenteditable) ────────────────────────

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

  // ─── LinkedIn post / article text scraper ─────────────────────────────────────

  function scrapePostText(textbox) {
    // Walk up to find the post container, then look for post text
    const container =
      textbox.closest('.comments-comment-box')?.closest('article') ||
      textbox.closest('[data-id]') ||
      textbox.closest('.feed-shared-update-v2') ||
      document.body;

    for (const sel of [
      '.feed-shared-update-v2__description span[dir="ltr"]',
      '.feed-shared-text span[dir="ltr"]',
      '.feed-shared-text-view span',
      'span[dir="ltr"]',
      'article h2',
    ]) {
      const t = container.querySelector(sel)?.textContent.trim();
      if (t && t.length > 10) return t.slice(0, 600);
    }

    // Image alt text
    const img = container.querySelector('img[alt]:not([alt=""])');
    if (img?.alt && img.alt.length > 5) return img.alt.slice(0, 300);

    return '';
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

  const LI_IMG_SELS = [
    '.feed-shared-image__image',
    '.feed-shared-update-v2__content img[src*="licdn"]',
    'img.ivm-view-attr__img--centered',
    '.update-components-image__image',
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

  async function generateAllVariants(postText, toneObj) {
    const language = _selectedLanguage === 'hinglish' ? 'hindi' : _selectedLanguage;

    // ── Filmy tone enrichment (Bollywood agent) ───────────────────────────
    if (toneObj.label === 'Filmy') {
      toneObj = { ...toneObj, tonePrompt: await getFilmyTonePrompt() };
    }

    // ── Opt-2: smart image sending ──────────────────────────────────────────
    const wordCount = countMeaningfulWords(postText);
    let imageMode = 'text-only';
    let imageData  = null;
    const liRoot = _menuActiveTextbox
      ? (_menuActiveTextbox.closest('.feed-shared-update-v2') || document)
      : document;
    if (wordCount > 20) {
      imageMode = 'text-only';
      console.log(`[Tapfill] text-only mode — caption has ${wordCount} words`);
    } else if (wordCount >= 1) {
      imageMode = 'image+text';
      console.log(`[Tapfill] image+text mode — caption has ${wordCount} words`);
      imageData = await extractPostImage(LI_IMG_SELS, liRoot);
      if (!imageData) { console.log('[Tapfill] image extraction failed — falling back to text only'); imageMode = 'text-only'; }
    } else {
      imageMode = 'image-only';
      console.log('[Tapfill] image-only mode — no meaningful caption found');
      imageData = await extractPostImage(LI_IMG_SELS, liRoot);
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
      port.postMessage({ type: 'GENERATE', postText, tone: toneObj.tone, platform: 'linkedin', language, tonePrompt: toneObj.tonePrompt || null, imageMode, imageData });
    });
  }

  // ─── Menu state ───────────────────────────────────────────────────────────────

  let _menuActiveTextbox = null;
  let _menuPostText      = '';

  // ─── Build #li-tap-menu ───────────────────────────────────────────────────────

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
    header.textContent = 'Choose a tone';
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
          generateForTone(_currentTone);
        }
      });
      langRow.appendChild(lb);
      chrome.storage.local.get('tapfill_language', (r) => { if ((r.tapfill_language || 'english') === key) setLangActive(lb); });
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

    // Action buttons row
    const actionRow = document.createElement('div');
    Object.assign(actionRow.style, { display: 'none', gap: '6px' });

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = '↺ Refresh';
    Object.assign(retryBtn.style, {
      flex: '1', padding: '7px 0', border: '1.5px solid #e2e8f0',
      borderRadius: '10px', background: 'transparent',
      color: '#64748b', fontSize: '12px', cursor: 'pointer',
      fontFamily: 'inherit', fontWeight: '500',
    });
    retryBtn.addEventListener('mousedown', e => e.preventDefault());

    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.textContent = 'Use this →';
    Object.assign(useBtn.style, {
      flex: '2', padding: '7px 0', border: 'none',
      borderRadius: '10px',
      background: 'linear-gradient(135deg,#6366f1,#818cf8)',
      color: '#fff', fontSize: '12px', fontWeight: '600',
      cursor: 'pointer', fontFamily: 'inherit',
    });
    useBtn.addEventListener('mousedown', e => e.preventDefault());

    actionRow.append(retryBtn, useBtn);
    resultCard.appendChild(actionRow);

    // ── Energy bar ────────────────────────────────────────────────────────────
    const ENERGIES = [
      { label: 'Subtle',   key: 'subtle'   },
      { label: 'Balanced', key: 'balanced' },
      { label: 'Strong',   key: 'bold'     },
      { label: 'Powerful', key: 'powerful' },
    ];
    const ENERGY_LABEL_STYLES = [
      { color: '#c0c8d8', weight: '300' },
      { color: '#94a3b8', weight: '400' },
      { color: '#475569', weight: '600' },
      { color: '#1e293b', weight: '700' },
    ];

    const energyBar = document.createElement('div');
    Object.assign(energyBar.style, {
      display: 'none', position: 'relative', padding: '10px 4px 4px',
    });

    const energyLine = document.createElement('div');
    Object.assign(energyLine.style, {
      position: 'absolute', top: '20px', left: '14px', right: '14px',
      height: '2px',
      background: 'linear-gradient(to right, #6366f1, #818cf8)',
      borderRadius: '1px',
    });
    energyBar.appendChild(energyLine);

    const energyDotsRow = document.createElement('div');
    Object.assign(energyDotsRow.style, {
      display: 'flex', justifyContent: 'space-between', position: 'relative',
    });
    energyBar.appendChild(energyDotsRow);

    const energyDots = [];
    ENERGIES.forEach((energy, idx) => {
      const item = document.createElement('div');
      Object.assign(item.style, {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '4px', cursor: 'pointer',
      });
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        width: '20px', height: '20px', borderRadius: '50%',
        border: '2px solid #6366f1',
        background: idx === 1 ? '#6366f1' : 'transparent',
        transition: 'background 0.15s', boxSizing: 'border-box',
      });
      energyDots.push(dot);
      const energyLabelEl = document.createElement('span');
      energyLabelEl.textContent = energy.label;
      Object.assign(energyLabelEl.style, {
        fontSize: '9px', fontWeight: ENERGY_LABEL_STYLES[idx].weight,
        color: ENERGY_LABEL_STYLES[idx].color, lineHeight: '1.2', whiteSpace: 'nowrap',
      });
      item.append(dot, energyLabelEl);
      energyDotsRow.appendChild(item);
      item.addEventListener('mousedown', e => e.preventDefault());
      item.addEventListener('click', () => {
        if (_currentEnergyIdx === idx || !_currentTone) return;
        energyDots[_currentEnergyIdx].style.background = 'transparent';
        energyDots[idx].style.background = '#6366f1';
        _currentEnergyIdx = idx;
        if (_currentVariants) {
          showComment(_currentVariants[ENERGIES[idx].key]);
        } else {
          generateForTone(_currentTone);
        }
      });
    });
    resultCard.insertBefore(energyBar, actionRow);

    let _selectedChip     = null;
    let _currentTone      = null;
    let _currentComment   = null;
    let _currentCommentId = null;
    let _langCache        = {};
    let _currentVariants  = null;
    let _currentEnergyIdx = 1;
    let _lastCopied       = false;

    const SPINNER_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" style="animation:li-tap-spin 0.7s linear infinite;flex-shrink:0"><circle cx="8" cy="8" r="6" fill="none" stroke="#818cf8" stroke-width="2" stroke-dasharray="25" stroke-dashoffset="9"/></svg>`;

    function clampPosition() {
      requestAnimationFrame(() => {
        const mRect = menu.getBoundingClientRect();
        const vw    = document.documentElement.clientWidth;
        const vh    = window.innerHeight;
        const GAP   = 12;
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

    function showLoading(msg) {
      _currentComment   = null;
      _currentCommentId = null;
      _currentVariants  = null;
      sep.style.display = '';
      resultCard.style.display = 'flex';
      spinnerWrap.innerHTML = SPINNER_SVG + ' ' + (msg || 'Generating…');
      spinnerWrap.style.display = 'flex';
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
      retryBtn.style.display = '';
      useBtn.style.display = '';
      actionRow.style.display = 'flex';
      clampPosition();
    }

    function showError(notConnected) {
      _currentComment = null;
      sep.style.display = '';
      resultCard.style.display = 'flex';
      if (notConnected) {
        spinnerWrap.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:4px 0">
            <span style="color:#ef4444;font-size:12px;text-align:center">Not signed in to Tapfill.</span>
            <button id="tapfill-connect-btn" style="
              background:linear-gradient(135deg,#818cf8,#5B54F5);color:#fff;border:none;
              border-radius:20px;padding:6px 18px;font-size:12px;font-weight:600;
              cursor:pointer;font-family:inherit
            ">Connect account →</button>
          </div>`;
        const connectBtn = spinnerWrap.querySelector('#tapfill-connect-btn');
        if (connectBtn) {
          connectBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
          connectBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_CONNECT' }));
        }
      } else {
        spinnerWrap.innerHTML = `<span style="color:#ef4444;font-size:12px">Generation failed — try again.</span>`;
      }
      spinnerWrap.style.display = 'flex';
      commentEl.style.display = 'none';
      retryBtn.style.display = '';
      useBtn.style.display = 'none';
      actionRow.style.display = 'flex';
      clampPosition();
    }

    async function generateForTone(toneObj, attempt = 0) {
      // Fast pre-check: bail immediately if no token in storage
      if (attempt === 0) {
        const _preCheck = await new Promise(r => chrome.storage.local.get('tapfill_token', r));
        if (!_preCheck.tapfill_token?.access_token) { showError(true); return; }
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
        const isRateLimit = err.message.includes('429');
        console.error('[Tapfill] generate failed:', err);
        if (isRateLimit && attempt < 1) {
          showLoading('Rate limited — retrying…');
          setTimeout(() => generateForTone(toneObj, attempt + 1), 5000);
          return;
        }
        showError(err.notConnected);
      }
    }

    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_currentTone) generateForTone(_currentTone);
    });

    useBtn.addEventListener('click', () => {
      if (!_currentComment) return;
      const textbox = _menuActiveTextbox || document.querySelector(TEXTBOX_SEL);
      if (textbox) {
        insertTextReact(textbox, _currentComment);
        requestAnimationFrame(() =>
          textbox.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        );
      }
      if (_currentCommentId) {
        const port = chrome.runtime.connect({ name: 'AI_FETCH' });
        port.postMessage({ type: 'FEEDBACK', commentId: _currentCommentId, signal: 'use' });
        setTimeout(() => port.disconnect(), 1000);
      }
      _lastCopied = true;
      closeTapMenu();
    });

    const visibleTones = (['community_pro', 'creator'].includes(_userPlan) ? [...TONES, ...CREATOR_TONES] : TONES)
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
        if (_currentEnergyIdx !== 1) {
          energyDots[_currentEnergyIdx].style.background = 'transparent';
          energyDots[1].style.background = '#6366f1';
          _currentEnergyIdx = 1;
        }
        chip.style.background  = '#eef2ff';
        chip.style.borderColor = '#818cf8';
        labelEl.style.color    = '#6366f1';
        generateForTone(toneObj);
      });
    });

    document.body.appendChild(menu);
    return { menu };
  }

  // ─── Open / close menu ───────────────────────────────────────────────────────

  async function openTapMenu(tapRootBtn) {
    closeTapMenu();

    _userPlan = await getUserPlan();

    _menuActiveTextbox = document.querySelector(TEXTBOX_SEL);
    _menuPostText      = _menuActiveTextbox ? scrapePostText(_menuActiveTextbox) : '';

    const { menu } = buildTapMenu();

    const bRect   = tapRootBtn.getBoundingClientRect();
    const POPUP_W = 320;
    const menuH   = menu.offsetHeight || 320;

    const GAP = 8;
    let top  = bRect.top - menuH - GAP;
    let left = bRect.left;

    if (top < GAP) top = bRect.bottom + GAP;
    if (top + menuH > window.innerHeight - GAP) top = window.innerHeight - menuH - GAP;
    if (left + POPUP_W > document.documentElement.clientWidth - GAP) left = document.documentElement.clientWidth - POPUP_W - GAP;
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
    _menuPostText      = '';
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
    if (existing) return existing;

    const btn = document.createElement('button');
    btn.id    = TAP_ROOT_ID;
    btn.type  = 'button';
    btn.title = 'Lifill – Comment Assistant';
    btn.setAttribute('aria-label', 'Comment Assistant');

    Object.assign(btn.style, {
      position:       'fixed',
      display:        'none',
      alignItems:     'center',
      justifyContent: 'center',
      width:          'auto',
      height:         '31px',
      padding:        '0',
      border:         'none',
      background:     'transparent',
      cursor:         'pointer',
      zIndex:         '999999',
      outline:        'none',
      transition:     'transform 0.12s ease',
    });

    btn.innerHTML = `<img src="${LOGO_URL}" height="31" style="display:block;width:auto" draggable="false">`;

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

  // ─── Find the first toolbar button next to the comment box ───────────────────
  //
  //  LinkedIn's comment toolbar sits in the same form as the textbox.
  //  Walk up until we find a container with ≥ 1 visible button, then return
  //  the leftmost button to the right of the textbox as the anchor.

  function findFirstToolbarBtn(textbox) {
    let el = textbox.parentElement;
    for (let i = 0; i < 10; i++) {
      if (!el || el === document.body) break;
      const btns = [...el.querySelectorAll('button, [role="button"]')]
        .filter(b => b.id !== TAP_ROOT_ID)
        .filter(b => {
          const br = b.getBoundingClientRect();
          return br.width > 0 && br.height > 0;
        });
      if (btns.length >= 1) {
        const r = textbox.getBoundingClientRect();
        // Buttons to the right of textbox
        const rightBtns = btns.filter(b => b.getBoundingClientRect().left >= r.right - 10);
        if (rightBtns.length) {
          return rightBtns
            .map(b => b.getBoundingClientRect())
            .reduce((a, b) => a.left < b.left ? a : b);
        }
        // Buttons below the textbox (LinkedIn toolbar is often below).
        // Return the RIGHTMOST below button (the Comment/Post button) so that T
        // sits just to its left — keeping T inside the comment box border.
        const belowBtns = btns.filter(b => b.getBoundingClientRect().top >= r.bottom - 4);
        if (belowBtns.length) {
          return belowBtns
            .map(b => b.getBoundingClientRect())
            .reduce((a, b) => a.right > b.right ? a : b); // rightmost = Comment btn
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function positionTapRoot(textbox) {
    const r = textbox.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    const btn   = getOrCreateTapRoot();
    const first = findFirstToolbarBtn(textbox);

    let leftPos, topPos;

    if (first) {
      // Toolbar to the RIGHT  → first = leftmost icon (emoji)   → T goes left of emoji, outside box
      // Toolbar BELOW        → first = rightmost btn (Comment) → T goes left of Comment, inside box
      leftPos = first.left - 24 - 8;
      topPos  = first.top + (first.height - 24) / 2;
    } else {
      // No toolbar yet — sit to the left of the textbox, vertically centred
      leftPos = r.left - 24 - 8;
      topPos  = r.top + (r.height - 24) / 2;
    }

    btn.style.left    = `${leftPos}px`;
    btn.style.top     = `${topPos}px`;
    btn.style.display = 'inline-flex';
  }

  function hideTapRoot() {
    closeTapMenu();
    stopToolbarObserver();
    const btn = document.getElementById(TAP_ROOT_ID);
    if (btn) btn.style.display = 'none';
  }

  // ─── MutationObserver — reposition when toolbar changes ──────────────────────

  let _toolbarObserver = null;

  function startToolbarObserver(textbox) {
    stopToolbarObserver();
    let container = textbox.parentElement;
    for (let i = 0; i < 10; i++) {
      if (!container || container === document.body) break;
      const btns = container.querySelectorAll('button, [role="button"]');
      if (btns.length >= 1) break;
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

  let textboxFocused  = false;
  let tapHideTimer    = null;
  let _activeTextbox  = null;   // keep ref to the focused comment box

  function reposition() {
    if (!textboxFocused || !_activeTextbox) return;
    positionTapRoot(_activeTextbox);
  }

  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });

  // ─── focusin / focusout ───────────────────────────────────────────────────────
  //
  //  LinkedIn uses contenteditable divs with role="textbox" for both the post
  //  composer and comment boxes.  We identify comment boxes by:
  //    1. aria-label containing "comment" (English / most locales)
  //    2. Ancestor element whose class name contains "comment" (most reliable)
  //    3. Ancestor with a data attribute containing "comment"
  //  We explicitly exclude the post composer (Share / Start a post dialog).

  function isCommentBox(target) {
    if (target.nodeType !== Node.ELEMENT_NODE) return false;
    if (target.getAttribute('contenteditable') !== 'true') return false;
    if (target.getAttribute('role') !== 'textbox') return false;

    // Exclude the post composer modal
    if (target.closest('[aria-label*="Create a post"]')) return false;
    if (target.closest('[aria-label*="Start a post"]')) return false;
    if (target.closest('.share-creation-state')) return false;

    const label = (target.getAttribute('aria-label') || '').toLowerCase();

    // 1. Explicit aria-label match (covers most locales)
    if (label.includes('comment')) return true;

    // 2. Inside a LinkedIn comment container (class-name based)
    if (target.closest('[class*="comment"]')) return true;

    // 3. Inside a container with a data attribute referencing comments
    if (target.closest('[data-test-id*="comment"]')) return true;
    if (target.closest('[id*="comment"]')) return true;

    return false;
  }

  document.addEventListener('focusin', (e) => {
    if (!isCommentBox(e.target)) return;

    textboxFocused = true;
    _activeTextbox = e.target;
    clearTimeout(tapHideTimer);
    const target = e.target;

    setTimeout(() => { if (textboxFocused) positionTapRoot(target); }, 100);
    setTimeout(() => {
      if (!textboxFocused) return;
      positionTapRoot(target);
      startToolbarObserver(target);
    }, 350);
  }, true);

  document.addEventListener('focusout', (e) => {
    if (!isCommentBox(e.target)) return;
    textboxFocused = false;
    _activeTextbox = null;
    tapHideTimer = setTimeout(hideTapRoot, 200);
  }, true);

  // ── Heartbeat — keeps extension_sessions.last_active fresh ──────────────────
  function sendHeartbeat() {
    chrome.runtime.sendMessage({ type: 'HEARTBEAT' }, () => { void chrome.runtime.lastError; });
  }
  setTimeout(sendHeartbeat, 10000);
  setInterval(sendHeartbeat, 30 * 60 * 1000);

})();
