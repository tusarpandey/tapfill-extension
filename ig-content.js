// ==UserScript==
// @name         Igfill – Instagram Comment Assistant
// @namespace    https://tapfill.io
// @version      2.0.0
// @description  Injects an AI comment-assistant button into every Instagram comment box.
// @author       Tapfill
// @match        https://www.instagram.com/*
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────────

  const TAP_ROOT_ID = 'ig-tap-root';
  const TAP_MENU_ID = 'ig-tap-menu';

  // Instagram uses a plain <textarea> (not contenteditable)
  const TEXTBOX_SEL = 'textarea[aria-label*="Add a comment"]';

  // ─── Tones ────────────────────────────────────────────────────────────────────

  const TONES = [
    { emoji: '🎩', label: 'Classic',   desc: 'Polished and timeless.',             tone: 'professional', temp: 0.2 },
    { emoji: '🌻', label: 'Friendly',  desc: 'Warm, heartfelt, caring.',           tone: 'friendly',     temp: 0.5 },
    { emoji: '💎', label: 'Confident', desc: 'Direct. Clear. No second-guessing.', tone: 'confident',   temp: 0.3 },
    { emoji: '😄', label: 'Funny',     desc: 'Playful and clever. Makes you smile.', tone: 'funny',      temp: 0.9 },
    { emoji: '🎬', label: 'Filmy',     desc: 'Full cinematic. Dramatic flair.',    tone: 'filmy',        temp: 0.8 },
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
        const res = await fetch('https://tapfill-saas.vercel.app/api/ext/profile', {
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

  // ─── Devanagari → Hinglish transliteration ───────────────────────────────────
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
    if (document.getElementById('ig-tap-styles')) return;
    const s = document.createElement('style');
    s.id = 'ig-tap-styles';
    s.textContent = `
      @keyframes ig-tap-spin{to{transform:rotate(360deg)}}
      @keyframes ig-tap-word-magic{
        0%{opacity:0;transform:translateY(4px) scale(0.92)}
        60%{opacity:1;transform:translateY(-1px) scale(1.04)}
        100%{opacity:1;transform:translateY(0) scale(1)}
      }
      .ig-tap-word-magic{display:inline-block;animation:ig-tap-word-magic 0.35s ease forwards}
      @keyframes ig-tap-sparkle{
        0%{opacity:1;transform:translate(-50%,-50%) scale(1)}
        100%{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(0)}
      }
    `;
    document.head.appendChild(s);
  }

  // ─── Tapfill logo ─────────────────────────────────────────────────────────────

  const LOGO_URL = chrome.runtime.getURL('icons/icon-48.png');

  // ─── React-compatible text insertion for <textarea> ───────────────────────────

  function insertTextReact(textarea, text) {
    textarea.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeSetter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  }

  // ─── Instagram post content scraper ──────────────────────────────────────────

  function scrapePostText() {
    for (const sel of [
      'article h1',
      'div[role="dialog"] article span[dir="auto"]',
      'article span[dir="auto"]',
      'section article h2 ~ div span',
    ]) {
      const t = document.querySelector(sel)?.textContent.trim();
      if (t && t.length > 5) return t.slice(0, 500);
    }
    for (const sel of [
      'div[role="dialog"] img[alt]:not([alt=""])',
      'article img[alt]:not([alt=""])',
    ]) {
      const img = document.querySelector(sel);
      if (img?.alt && img.alt.length > 5) return img.alt.slice(0, 300);
    }
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

  const IG_IMG_SELS = [
    'div[role="dialog"] article img[src*="cdninstagram"]:not([alt=""])',
    'div[role="dialog"] article img[srcset]:not([alt=""])',
    'article img[src*="cdninstagram"]:not([alt=""])',
    'article img[srcset]:not([alt=""])',
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

  // ─── AI call via background port ─────────────────────────────────────────────

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
    if (wordCount > 20) {
      imageMode = 'text-only';
      console.log(`[Tapfill] text-only mode — caption has ${wordCount} words`);
    } else if (wordCount >= 1) {
      imageMode = 'image+text';
      console.log(`[Tapfill] image+text mode — caption has ${wordCount} words`);
      imageData = await extractPostImage(IG_IMG_SELS, document);
      if (!imageData) { console.log('[Tapfill] image extraction failed — falling back to text only'); imageMode = 'text-only'; }
    } else {
      imageMode = 'image-only';
      console.log('[Tapfill] image-only mode — no meaningful caption found');
      imageData = await extractPostImage(IG_IMG_SELS, document);
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
        if (response?.rateLimit) {
          return reject(Object.assign(new Error('RATE_LIMIT'), { rateLimit: true }));
        }
        if (!response?.ok) return reject(new Error(response?.error || 'AI request failed'));
        resolve({ variants: response.variants, commentId: response.commentId || null, toneOrder: response.toneOrder || null });
      });
      port.onDisconnect.addListener(() => {
        if (settled) return; settled = true;
        reject(new Error(chrome.runtime.lastError?.message || 'Port disconnected'));
      });
      port.postMessage({ type: 'GENERATE', postText, tone: toneObj.tone, platform: 'instagram', language, tonePrompt: toneObj.tonePrompt || null, imageMode, imageData });
    });
  }

  // ─── Canvas — persists across menu opens ──────────────────────────────────────

  let _canvasItems = []; // { id, text, toneEmoji, toneLabel, energyLabel }

  let _wordmarkFont = null;
  async function getWordmarkFont() {
    if (_wordmarkFont !== null) return _wordmarkFont;
    try {
      const cssRes = await fetch('https://fonts.googleapis.com/css2?family=Nunito:wght@800&display=swap');
      if (!cssRes.ok) throw new Error('css fetch failed');
      const css = await cssRes.text();
      const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/);
      if (!match) throw new Error('url not found');
      const face = new FontFace('TapfillWM', `url('${match[1]}') format('woff2')`);
      await face.load();
      document.fonts.add(face);
      _wordmarkFont = 'TapfillWM';
    } catch (e) {
      _wordmarkFont = '"Futura", "Century Gothic", "Avenir Next", "Avenir", sans-serif';
    }
    return _wordmarkFont;
  }

  async function buildCanvasBlob() {
    if (!_canvasItems.length) return null;

    const W = 400, PAD = 20, CARD_GAP = 12, LINE_H = 20;
    const CARD_PAD = 16, HDR_H = 90, FTR_H = 54, DPR = 2;
    const ff  = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const wff = await getWordmarkFont();
    const INNER_W = W - PAD * 2 - CARD_PAD * 2;
    const BADGE_H = 24, LABEL_H = 18;

    const tmp = document.createElement('canvas').getContext('2d');
    tmp.font = `13px ${ff}`;

    function wrapLines(text, maxW) {
      let line = '', lines = [];
      text.split(/\s+/).forEach(w => {
        const t = line ? line + ' ' + w : w;
        if (tmp.measureText(t).width > maxW) { lines.push(line); line = w; }
        else line = t;
      });
      if (line) lines.push(line);
      return lines;
    }

    function cardHeight(item) {
      const lines = wrapLines(item.text, INNER_W);
      return CARD_PAD + LABEL_H + 8 + BADGE_H + 12 + Math.max(1, lines.length) * LINE_H + CARD_PAD;
    }

    const cardHeights = _canvasItems.map(i => cardHeight(i));
    const totalH = HDR_H + PAD
      + cardHeights.reduce((a, h) => a + h + CARD_GAP, 0)
      - CARD_GAP + PAD + FTR_H;

    const cv = document.createElement('canvas');
    cv.width = W * DPR; cv.height = totalH * DPR;
    const ctx = cv.getContext('2d');
    ctx.scale(DPR, DPR);

    // Dark navy background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, totalH);
    bgGrad.addColorStop(0, '#050816');
    bgGrad.addColorStop(1, '#0B1023');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, totalH);

    // Header: T icon + wordmark
    const iconImg = new Image();
    iconImg.src = chrome.runtime.getURL('icons/icon-128.png');
    await new Promise(r => { iconImg.onload = r; iconImg.onerror = r; });

    const LOGO = 44;
    const logoX = PAD, logoY = (HDR_H - LOGO) / 2;
    if (iconImg.width) ctx.drawImage(iconImg, logoX, logoY, LOGO, LOGO);

    ctx.font = `800 18px ${wff}`; ctx.fillStyle = '#ffffff';
    ctx.fillText('Tapfill', logoX + LOGO + 12, logoY + LOGO / 2 - 2);

    ctx.font = `500 10px ${ff}`; ctx.fillStyle = '#a78bfa';
    ctx.fillText('MY COMMENT CANVAS', logoX + LOGO + 12, logoY + LOGO / 2 + 13);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, HDR_H); ctx.lineTo(W, HDR_H); ctx.stroke();

    // Cards
    let y = HDR_H + PAD;
    _canvasItems.forEach((item, idx) => {
      const ch = cardHeights[idx];
      const cx = PAD, cw = W - PAD * 2;

      ctx.shadowBlur = 18; ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowOffsetY = 5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.roundRect(cx, y, cw, ch, 14); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

      let iy = y + CARD_PAD;

      ctx.font = `600 9px ${ff}`; ctx.fillStyle = '#94a3b8';
      ctx.fillText(`COMMENT ${String(idx + 1).padStart(2, '0')}`, cx + CARD_PAD, iy + 10);
      iy += LABEL_H + 8;

      const toneText = `${item.toneEmoji}  ${item.toneLabel}`;
      ctx.font = `600 11px ${ff}`;
      const tonePW = ctx.measureText(toneText).width + 20;
      ctx.fillStyle = 'rgba(139,92,246,0.12)';
      ctx.beginPath(); ctx.roundRect(cx + CARD_PAD, iy, tonePW, BADGE_H, 12); ctx.fill();
      ctx.fillStyle = '#7C3AED';
      ctx.fillText(toneText, cx + CARD_PAD + 10, iy + 16);

      if (item.energyLabel) {
        ctx.font = `600 11px ${ff}`;
        const energyPW = ctx.measureText(item.energyLabel).width + 20;
        const ex = cx + CARD_PAD + tonePW + 8;
        ctx.fillStyle = 'rgba(16,185,129,0.1)';
        ctx.beginPath(); ctx.roundRect(ex, iy, energyPW, BADGE_H, 12); ctx.fill();
        ctx.fillStyle = '#059669';
        ctx.fillText(item.energyLabel, ex + 10, iy + 16);
      }
      iy += BADGE_H + 12;

      ctx.font = `400 13px ${ff}`; ctx.fillStyle = '#0F172A';
      wrapLines(item.text, INNER_W).forEach(l => {
        ctx.fillText(l, cx + CARD_PAD, iy + 13);
        iy += LINE_H;
      });

      y += ch + CARD_GAP;
    });

    // Footer
    const fy = totalH - FTR_H + 18;
    const count = _canvasItems.length;
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    ctx.font = `700 11px ${ff}`; ctx.fillStyle = '#6366f1';
    ctx.fillText('Tapfill', PAD, fy);
    ctx.font = `400 11px ${ff}`; ctx.fillStyle = '#64748b';
    ctx.fillText(' · tapfill.io', PAD + ctx.measureText('Tapfill').width, fy);

    const rightTxt = `${count} comment${count !== 1 ? 's' : ''}  ·  ${dateStr}`;
    ctx.font = `400 10px ${ff}`; ctx.fillStyle = '#94a3b8';
    ctx.fillText(rightTxt, W - PAD - ctx.measureText(rightTxt).width, fy);

    const tagline = 'TAPFILL.IO — AI POWERED SOCIAL MEDIA COMMENTS';
    ctx.font = `500 9px ${ff}`; ctx.fillStyle = 'rgba(167,139,250,0.5)';
    ctx.fillText(tagline, (W - ctx.measureText(tagline).width) / 2, fy + 20);

    return new Promise(resolve => cv.toBlob(resolve, 'image/png'));
  }

  // ─── Menu state ───────────────────────────────────────────────────────────────

  let _menuActiveTextbox = null;
  let _menuPostText      = '';

  // ─── Build #ig-tap-menu ───────────────────────────────────────────────────────

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

    // ── Language section ──────────────────────────────────────────────────────
    const ALL_LANGS_GROUPED = [
      { group: 'Indian',      langs: ['English', 'Hindi', 'Hinglish', 'Bengali', 'Telugu', 'Marathi'] },
      { group: 'Middle East', langs: ['Arabic', 'Urdu', 'Turkish'] },
      { group: 'East Asian',  langs: ['Japanese', 'Korean', 'Mandarin'] },
      { group: 'SE Asian',    langs: ['Bahasa Indonesia', 'Filipino', 'Vietnamese', 'Thai'] },
      { group: 'European',    langs: ['German', 'French', 'Spanish', 'Italian', 'Portuguese', 'Russian'] },
    ];

    const langSection = document.createElement('div');
    Object.assign(langSection.style, { marginTop: '8px' });

    const langHdrRow = document.createElement('div');
    Object.assign(langHdrRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' });
    const langLbl = document.createElement('span');
    langLbl.textContent = 'LANGUAGE';
    Object.assign(langLbl.style, { fontSize: '9px', fontWeight: '700', color: '#94a3b8', letterSpacing: '1.5px', fontFamily: 'inherit' });
    const changeLangBtn = document.createElement('button');
    changeLangBtn.type = 'button'; changeLangBtn.textContent = '✎ Change';
    Object.assign(changeLangBtn.style, { fontSize: '9px', fontWeight: '600', color: '#6366f1', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '12px', padding: '2px 7px', cursor: 'pointer', fontFamily: 'inherit' });
    changeLangBtn.addEventListener('mousedown', e => e.preventDefault());
    langHdrRow.append(langLbl, changeLangBtn);
    langSection.appendChild(langHdrRow);

    const langRow = document.createElement('div');
    Object.assign(langRow.style, { display: 'flex', gap: '6px' });
    langSection.appendChild(langRow);

    const langPicker = document.createElement('div');
    Object.assign(langPicker.style, { display: 'none', marginTop: '8px', borderTop: '1px solid rgba(99,102,241,0.1)', paddingTop: '8px', maxHeight: '160px', overflowY: 'auto' });
    langSection.appendChild(langPicker);

    let _activeLangBtn = null;
    let _chipLabels = ['English', 'Hindi', 'Hinglish'];
    let _pickerSlot = 0;
    let _pickerOpen = false;

    function setLangActive(btn) {
      if (_activeLangBtn) Object.assign(_activeLangBtn.style, { background: '#f8fafc', borderColor: 'transparent', color: '#64748b', fontWeight: '500' });
      _activeLangBtn = btn;
      Object.assign(btn.style, { background: '#eef2ff', borderColor: '#818cf8', color: '#6366f1', fontWeight: '600' });
    }

    function renderChips() {
      langRow.innerHTML = ''; _activeLangBtn = null;
      _chipLabels.forEach((label) => {
        const key = label.toLowerCase();
        const lb = document.createElement('button');
        lb.type = 'button'; lb.textContent = label;
        Object.assign(lb.style, { flex: '1', padding: '5px 4px', borderRadius: '8px', border: '1.5px solid transparent', background: '#f8fafc', color: '#64748b', fontSize: '11px', fontWeight: '500', fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.15s' });
        lb.addEventListener('mousedown', e => e.preventDefault());
        lb.addEventListener('click', () => {
          _selectedLanguage = key; setLangActive(lb);
          chrome.storage.local.set({ tapfill_language: key });
          if (_langCache[key]) {
            _currentVariants = _langCache[key];
            showComment(_currentVariants[ENERGIES[_currentEnergyIdx].key]);
          } else if (key === 'hinglish' && _langCache['hindi']) {
            const hl = transliterateVariants(_langCache['hindi']);
            _langCache['hinglish'] = hl; _currentVariants = hl;
            showComment(_currentVariants[ENERGIES[_currentEnergyIdx].key]);
          } else if (_currentTone && _currentComment !== null) {
            generateForTone(_currentTone);
          }
        });
        langRow.appendChild(lb);
        chrome.storage.local.get('tapfill_language', (r) => {
          if (key === (r.tapfill_language || 'english')) setLangActive(lb);
        });
      });
    }

    function renderPicker() {
      langPicker.innerHTML = '';
      const slotLbl = document.createElement('div');
      slotLbl.textContent = 'Select chip to replace:';
      Object.assign(slotLbl.style, { fontSize: '9px', fontWeight: '700', color: '#94a3b8', letterSpacing: '1px', marginBottom: '6px', fontFamily: 'inherit' });
      langPicker.appendChild(slotLbl);
      const slotRow = document.createElement('div');
      Object.assign(slotRow.style, { display: 'flex', gap: '5px', marginBottom: '8px' });
      _chipLabels.forEach((label, idx) => {
        const sb = document.createElement('button'); sb.type = 'button'; sb.textContent = label;
        Object.assign(sb.style, { flex: '1', padding: '4px 0', borderRadius: '8px', border: 'none', fontSize: '10px', fontWeight: '600', fontFamily: 'inherit', cursor: 'pointer', background: _pickerSlot === idx ? '#6366f1' : 'rgba(99,102,241,0.08)', color: _pickerSlot === idx ? '#fff' : '#5A5A72' });
        sb.addEventListener('mousedown', e => e.preventDefault());
        sb.addEventListener('click', () => { _pickerSlot = idx; renderPicker(); });
        slotRow.appendChild(sb);
      });
      langPicker.appendChild(slotRow);
      ALL_LANGS_GROUPED.forEach(({ group, langs }) => {
        const grpLbl = document.createElement('div'); grpLbl.textContent = group;
        Object.assign(grpLbl.style, { fontSize: '8px', fontWeight: '700', color: '#94a3b8', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '6px 0 4px', fontFamily: 'inherit' });
        langPicker.appendChild(grpLbl);
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' });
        langs.forEach(lang => {
          const lb = document.createElement('button'); lb.type = 'button'; lb.textContent = lang;
          const isCur = _chipLabels[_pickerSlot] === lang;
          Object.assign(lb.style, { padding: '3px 8px', borderRadius: '12px', fontSize: '10px', fontFamily: 'inherit', cursor: 'pointer', border: '1px solid rgba(99,102,241,0.2)', background: isCur ? '#6366f1' : 'rgba(99,102,241,0.05)', color: isCur ? '#fff' : '#5A5A72' });
          lb.addEventListener('mousedown', e => e.preventDefault());
          lb.addEventListener('click', () => {
            _chipLabels[_pickerSlot] = lang;
            chrome.storage.local.set({ tapfill_chip_languages: JSON.stringify(_chipLabels) });
            renderChips();
            chrome.storage.local.get('tapfill_language', (r) => {
              langRow.querySelectorAll('button').forEach(b => { if (b.textContent.toLowerCase() === (r.tapfill_language || 'english')) setLangActive(b); });
            });
            _pickerOpen = false; langPicker.style.display = 'none'; changeLangBtn.textContent = '✎ Change';
          });
          row.appendChild(lb);
        });
        langPicker.appendChild(row);
      });
    }

    changeLangBtn.addEventListener('click', () => {
      _pickerOpen = !_pickerOpen;
      if (_pickerOpen) {
        renderPicker(); langPicker.style.display = 'block'; changeLangBtn.textContent = '✕ Close';
        requestAnimationFrame(() => {
          const GAP = 8, vh = window.innerHeight;
          const mRect = menu.getBoundingClientRect();
          if (mRect.bottom > vh - GAP) {
            menu.style.top = `${Math.max(GAP, parseFloat(menu.style.top) - (mRect.bottom - (vh - GAP)))}px`;
          }
        });
      } else { langPicker.style.display = 'none'; changeLangBtn.textContent = '✎ Change'; }
    });

    chrome.storage.local.get('tapfill_chip_languages', (r) => {
      if (r.tapfill_chip_languages) { try { _chipLabels = JSON.parse(r.tapfill_chip_languages); } catch {} }
      renderChips();
    });

    menu.appendChild(langSection);

    // ── Express with AI button (appears after tone chip is selected) ────────────
    const writeBtn = document.createElement('button');
    writeBtn.type = 'button';
    writeBtn.textContent = '✦ Express with AI';
    Object.assign(writeBtn.style, {
      display: 'none', marginTop: '10px', width: '100%',
      padding: '11px 0', borderRadius: '12px',
      background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
      color: '#fff', border: 'none', fontSize: '13px', fontWeight: '700',
      cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.01em',
      boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
    });
    writeBtn.addEventListener('mousedown', e => e.preventDefault());
    writeBtn.addEventListener('click', () => { if (_currentTone) generateForTone(_currentTone); });
    menu.appendChild(writeBtn);

    // ── Gradient separator ────────────────────────────────────────────────────
    const sep = document.createElement('div');
    Object.assign(sep.style, {
      height: '1px',
      background: 'linear-gradient(to right, transparent, #e2e8f0, transparent)',
      margin: '12px 0 0',
      display: 'none',
    });
    menu.appendChild(sep);

    // ── Result card ───────────────────────────────────────────────────────────
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

    // Action buttons row — [Canvas] [+ Canvas] [Use this →]
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

    actionRow.append(refreshBtn, canvasBtn, addToCanvasBtn, useBtn);
    resultCard.appendChild(actionRow);

    // ── Energy bar ────────────────────────────────────────────────────────────
    const ENERGIES = [
      { label: 'Subtle',   key: 'subtle'   },
      { label: 'Balanced', key: 'balanced' },
      { label: 'Bold',     key: 'bold'     },
      { label: 'Powerful', key: 'powerful' },
    ];
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

    const energyDotsRow = document.createElement('div');
    Object.assign(energyDotsRow.style, {
      display: 'flex', justifyContent: 'space-between',
    });
    energyBar.appendChild(energyDotsRow);

    const energyDots = [];
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

      item.append(dot, energyLabelEl);
      energyDotsRow.appendChild(item);
      item.addEventListener('mousedown', e => e.preventDefault());
      item.addEventListener('click', () => {
        if (_currentEnergyIdx === idx) return;
        energyDots[_currentEnergyIdx].style.boxShadow = 'none';
        energyDots[idx].style.boxShadow = `0 0 0 2px #fff, 0 0 0 4px ${DOT_PALETTE[idx].ring}`;
        _currentEnergyIdx = idx;
        if (_currentVariants) showComment(_currentVariants[ENERGIES[idx].key]);
      });
    });
    resultCard.insertBefore(energyBar, actionRow);

    let _selectedChip     = null;
    let _currentTone      = null;
    let _currentComment   = null;
    let _currentCommentId = null;
    let _currentVariants  = null;
    let _lastCopied       = false;
    let _langCache        = {};
    let _currentEnergyIdx = 1;
    let _retryTone        = null;

    const SPINNER_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" style="animation:ig-tap-spin 0.7s linear infinite;flex-shrink:0"><circle cx="8" cy="8" r="6" fill="none" stroke="#818cf8" stroke-width="2" stroke-dasharray="25" stroke-dashoffset="9"/></svg>`;

    function clampPosition() {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const mRect = menu.getBoundingClientRect();
        const vw    = document.documentElement.clientWidth;
        const GAP   = 12;
        if (mRect.bottom > window.innerHeight - GAP) {
          const newTop = parseFloat(menu.style.top) - (mRect.bottom - (window.innerHeight - GAP));
          menu.style.top = `${Math.max(GAP, newTop)}px`;
        }
        if (parseFloat(menu.style.top) < GAP) menu.style.top = `${GAP}px`;
        if (mRect.right > vw - GAP) {
          const newLeft = parseFloat(menu.style.left) - (mRect.right - (vw - GAP));
          menu.style.left = `${Math.max(GAP, newLeft)}px`;
        }
        if (parseFloat(menu.style.left) < GAP) menu.style.left = `${GAP}px`;
      }));
    }

    function showLoading() {
      _currentComment   = null;
      _currentCommentId = null;
      _currentVariants  = null;
      sep.style.display = '';
      resultCard.style.display = 'flex';
      spinnerWrap.innerHTML = SPINNER_SVG + ' Building your vibe\u2026';
      spinnerWrap.style.display = 'flex';
      commentEl.style.display = 'none';
      energyBar.style.display = 'none';
      actionRow.style.display = 'none';
      clampPosition();
    }

    function spawnSparkles(span) {
      const rect = span.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      for (let i = 0; i < 4; i++) {
        const spark = document.createElement('span');
        const angle = (Math.PI * 2 * i) / 4;
        const dist  = 8 + Math.random() * 6;
        spark.style.cssText = `
          position:fixed;left:${cx}px;top:${cy}px;pointer-events:none;
          width:4px;height:4px;border-radius:50%;background:#818cf8;z-index:99999999;
          --dx:${Math.cos(angle)*dist}px;--dy:${Math.sin(angle)*dist}px;
          animation:ig-tap-sparkle 0.45s ease forwards;
        `;
        document.body.appendChild(spark);
        spark.addEventListener('animationend', () => spark.remove());
      }
    }

    function renderWithDiff(oldText, newText) {
      const oldWords = oldText.trim().split(/\s+/).filter(Boolean);
      commentEl.innerHTML = '';
      newText.trim().split(/\s+/).filter(Boolean).forEach((word, i) => {
        if (i > 0) commentEl.appendChild(document.createTextNode(' '));
        const span = document.createElement('span');
        span.textContent = word;
        if (oldWords[i] !== word) {
          span.className = 'ig-tap-word-magic';
          requestAnimationFrame(() => spawnSparkles(span));
        }
        commentEl.appendChild(span);
      });
    }

    function showComment(text) {
      const prevText = _currentComment || '';
      _currentComment = text;
      spinnerWrap.style.display = 'none';
      commentEl.style.display   = '';
      energyBar.style.display   = '';
      actionRow.style.display   = 'flex';
      renderWithDiff(prevText, text);
      clampPosition();
    }

    function showError(notConnected, isLimit) {
      _currentComment = null;
      if (isLimit) {
        spinnerWrap.innerHTML = '';
        const limitDiv = document.createElement('div');
        Object.assign(limitDiv.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '4px 0' });
        const limitSpan = document.createElement('span');
        Object.assign(limitSpan.style, { color: '#f59e0b', fontSize: '12px', textAlign: 'center', fontWeight: '600' });
        limitSpan.textContent = 'Free limit exhausted for today.';
        const upgradeBtn = document.createElement('button');
        Object.assign(upgradeBtn.style, {
          background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#fff', border: 'none',
          borderRadius: '20px', padding: '6px 18px', fontSize: '12px', fontWeight: '600',
          cursor: 'pointer', fontFamily: 'inherit',
        });
        upgradeBtn.textContent = 'Upgrade Plan \u2192';
        upgradeBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
        upgradeBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_URL', url: 'https://tapfill.io/pricing' }));
        limitDiv.append(limitSpan, upgradeBtn);
        spinnerWrap.appendChild(limitDiv);
        spinnerWrap.style.display = 'flex';
      } else if (notConnected) {
        spinnerWrap.innerHTML = '';
        const div = document.createElement('div');
        Object.assign(div.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '4px 0' });
        const span = document.createElement('span');
        Object.assign(span.style, { color: '#ef4444', fontSize: '12px', textAlign: 'center' });
        span.textContent = 'Not signed in to Tapfill.';
        const connectBtn = document.createElement('button');
        Object.assign(connectBtn.style, {
          background: 'linear-gradient(135deg,#818cf8,#5B54F5)', color: '#fff', border: 'none',
          borderRadius: '20px', padding: '6px 18px', fontSize: '12px', fontWeight: '600',
          cursor: 'pointer', fontFamily: 'inherit',
        });
        connectBtn.textContent = 'Connect account \u2192';
        connectBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
        connectBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_CONNECT' }));
        div.append(span, connectBtn);
        spinnerWrap.appendChild(div);
        spinnerWrap.style.display = 'flex';
      } else {
        spinnerWrap.innerHTML = '';
        const errDiv = document.createElement('div');
        Object.assign(errDiv.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '4px 0' });
        const errSpan = document.createElement('span');
        Object.assign(errSpan.style, { color: '#ef4444', fontSize: '12px', textAlign: 'center' });
        errSpan.textContent = 'Generation failed — try again.';
        const retryBtn = document.createElement('button');
        Object.assign(retryBtn.style, {
          background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
          borderRadius: '20px', padding: '6px 18px', fontSize: '12px', fontWeight: '600',
          cursor: 'pointer', fontFamily: 'inherit',
        });
        retryBtn.textContent = '\u21ba Retry';
        retryBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
        retryBtn.addEventListener('click', () => { if (_retryTone) generateForTone(_retryTone); });
        errDiv.append(errSpan, retryBtn);
        spinnerWrap.appendChild(errDiv);
        spinnerWrap.style.display = 'flex';
      }
      commentEl.style.display  = 'none';
      energyBar.style.display  = 'none';
      actionRow.style.display  = 'none';
      clampPosition();
    }

    async function generateForTone(toneObj) {
      _retryTone = toneObj;
      // Fast pre-check: bail immediately if no token in storage
      const _preCheck = await new Promise(r => chrome.storage.local.get('tapfill_token', r));
      if (!_preCheck.tapfill_token?.access_token) { showError(true, false); return; }
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
        const isRateLimit = err.rateLimit || err.message.includes('429') || err.message.toLowerCase().includes('daily limit');
        console.error('[Tapfill] generate failed:', err);
        if (isRateLimit) { showError(false, true); return; }
        showError(err.notConnected, false);
      }
    }

    // ── Canvas View ───────────────────────────────────────────────────────────
    const mainViewEls = [header, chipsRow, langSection, writeBtn, sep, resultCard];

    const canvasView = document.createElement('div');
    Object.assign(canvasView.style, {
      display: 'none', flexDirection: 'column',
      flex: '1', minHeight: '0', overflow: 'hidden', paddingBottom: '10px',
    });
    canvasView.addEventListener('mousedown', e => e.preventDefault());
    menu.appendChild(canvasView);

    // ── Canvas header: deep navy with glow
    const cvHdr = document.createElement('div');
    Object.assign(cvHdr.style, {
      background: 'linear-gradient(135deg,#050816,#0B1023,#171B46)',
      borderRadius: '12px', marginBottom: '10px',
      padding: '12px 14px', position: 'relative', overflow: 'hidden',
    });
    const cvGlow1 = document.createElement('div');
    Object.assign(cvGlow1.style, { position: 'absolute', top: '-20px', left: '-20px', width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(99,102,241,0.2)', pointerEvents: 'none' });
    const cvGlow2 = document.createElement('div');
    Object.assign(cvGlow2.style, { position: 'absolute', bottom: '-15px', right: '-15px', width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(139,92,246,0.15)', pointerEvents: 'none' });
    const cvLogoIcon = document.createElement('img');
    cvLogoIcon.src = chrome.runtime.getURL('icons/icon-128.png');
    cvLogoIcon.draggable = false;
    Object.assign(cvLogoIcon.style, { width: '32px', height: '32px', borderRadius: '8px', marginRight: '10px', flexShrink: '0', display: 'block' });
    const cvTextWrap = document.createElement('div');
    Object.assign(cvTextWrap.style, { display: 'inline-flex', flexDirection: 'column', verticalAlign: 'middle' });
    const cvWordmark = document.createElement('span');
    cvWordmark.textContent = 'Tapfill';
    Object.assign(cvWordmark.style, { fontSize: '12px', fontWeight: '800', color: '#fff', lineHeight: '1.2', textShadow: '0 0 12px rgba(139,92,246,0.55)' });
    const cvDivider = document.createElement('div');
    Object.assign(cvDivider.style, { height: '1px', background: 'rgba(255,255,255,0.18)', margin: '4px 0 3px' });
    const cvTitle = document.createElement('span');
    cvTitle.textContent = 'MY COMMENT CANVAS';
    Object.assign(cvTitle.style, { fontSize: '7px', fontWeight: '600', color: 'rgba(216,180,254,0.85)', letterSpacing: '2px' });
    cvTextWrap.append(cvWordmark, cvDivider, cvTitle);
    const cvHdrInner = document.createElement('div');
    Object.assign(cvHdrInner.style, { display: 'flex', alignItems: 'center', position: 'relative', zIndex: '1' });
    cvHdrInner.append(cvLogoIcon, cvTextWrap);
    cvHdr.append(cvGlow1, cvGlow2, cvHdrInner);
    canvasView.appendChild(cvHdr);

    const cvList = document.createElement('div');
    Object.assign(cvList.style, {
      flex: '1', minHeight: '0', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: '8px', padding: '2px 0 6px',
    });
    canvasView.appendChild(cvList);

    const cvFooter = document.createElement('div');
    Object.assign(cvFooter.style, {
      display: 'flex', gap: '6px',
      paddingTop: '10px', paddingBottom: '2px',
      borderTop: '1px solid rgba(139,92,246,0.1)',
    });

    let _capturedBlob = null;

    const backBtn = mkBtn('← Back', {
      border: '1.5px solid #e2e8f0', background: 'transparent', color: '#64748b',
      flex: '0 0 auto', padding: '7px 12px',
    });
    const saveImgBtn = mkBtn('📸 Save as Image', {
      border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
      color: '#fff', boxShadow: '0 3px 12px rgba(99,102,241,0.3)',
    });
    const dlBtn = mkBtn('💾 Save', {
      border: '1.5px solid #6366f1', background: 'transparent', color: '#6366f1',
    });
    const shareApiBtn = mkBtn('↗ Share', {
      border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
      color: '#fff', boxShadow: '0 3px 12px rgba(99,102,241,0.3)',
    });
    dlBtn.style.display = 'none';
    shareApiBtn.style.display = 'none';

    function resetToStage1() {
      _capturedBlob = null;
      saveImgBtn.textContent = '📸 Save as Image';
      saveImgBtn.disabled = false;
      saveImgBtn.style.display = '';
      dlBtn.style.display = 'none';
      shareApiBtn.style.display = 'none';
    }

    backBtn.addEventListener('click', () => { resetToStage1(); showMainView(); });

    saveImgBtn.addEventListener('click', async () => {
      if (!_canvasItems.length) return;
      saveImgBtn.textContent = '⏳ Generating…';
      saveImgBtn.disabled = true;
      try {
        _capturedBlob = await buildCanvasBlob();
        if (!_capturedBlob) { resetToStage1(); return; }
        saveImgBtn.style.display = 'none';
        dlBtn.style.display = '';
        shareApiBtn.style.display = '';
      } catch { resetToStage1(); }
    });

    dlBtn.addEventListener('click', () => {
      if (!_capturedBlob) return;
      const url = URL.createObjectURL(_capturedBlob);
      const a = document.createElement('a');
      a.href = url; a.download = 'tapfill-canvas.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      const orig = dlBtn.textContent;
      dlBtn.textContent = '✓ Saved!';
      setTimeout(() => { dlBtn.textContent = orig; }, 2000);
    });

    shareApiBtn.addEventListener('click', async () => {
      if (!_capturedBlob) return;
      const file = new File([_capturedBlob], 'tapfill-canvas.png', { type: 'image/png' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'My Tapfill Canvas' });
        } else {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': _capturedBlob })]);
          const orig = shareApiBtn.textContent;
          shareApiBtn.textContent = '✓ Copied!';
          setTimeout(() => { shareApiBtn.textContent = orig; }, 2000);
        }
      } catch { dlBtn.click(); }
    });

    cvFooter.append(backBtn, saveImgBtn, dlBtn, shareApiBtn);
    canvasView.appendChild(cvFooter);

    let _savedDisplays = [];

    function showMainView() {
      mainViewEls.forEach((el, i) => { el.style.display = _savedDisplays[i] !== undefined ? _savedDisplays[i] : ''; });
      canvasView.style.display = 'none';
      menu.style.maxHeight = '';
      menu.style.overflow  = 'hidden';
      clampPosition();
    }

    function showCanvasView() {
      _savedDisplays = mainViewEls.map(el => el.style.display);
      mainViewEls.forEach(el => { el.style.display = 'none'; });
      menu.style.overflow  = 'hidden';
      canvasView.style.display = 'flex';
      renderCanvasInline();
      requestAnimationFrame(() => {
        const GAP   = 8;
        const mTop  = parseFloat(menu.style.top) || menu.getBoundingClientRect().top;
        const avail = window.innerHeight - mTop - GAP;
        menu.style.maxHeight = `${Math.min(avail, 520)}px`;
        const mRect = menu.getBoundingClientRect();
        if (mRect.bottom > window.innerHeight - GAP) {
          const shift = mRect.bottom - (window.innerHeight - GAP);
          menu.style.top = `${Math.max(GAP, parseFloat(menu.style.top) - shift)}px`;
          const newTop = parseFloat(menu.style.top);
          menu.style.maxHeight = `${Math.min(window.innerHeight - newTop - GAP, 520)}px`;
        }
      });
    }

    function renderCanvasInline() {
      cvList.innerHTML = '';
      if (!_canvasItems.length) {
        const empty = document.createElement('p');
        Object.assign(empty.style, { margin: '0', textAlign: 'center', color: '#94a3b8', fontSize: '12px', padding: '24px 0' });
        empty.textContent = 'No comments saved yet.';
        cvList.appendChild(empty);
        return;
      }
      _canvasItems.forEach(item => {
        const card = document.createElement('div');
        Object.assign(card.style, { background: '#fff', borderRadius: '14px', boxShadow: '0 2px 14px rgba(99,102,241,0.08), 0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' });
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
        discardBtn.addEventListener('click', () => {
          _canvasItems = _canvasItems.filter(c => c.id !== item.id);
          renderCanvasInline();
        });
        cardBody.append(textEl, discardBtn);
        card.append(cardTop, cardBody);
        cvList.appendChild(card);
      });
    }

    refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); if (_currentTone) generateForTone(_currentTone); });

    canvasBtn.addEventListener('click', (e) => { e.stopPropagation(); showCanvasView(); });

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
      const orig = addToCanvasBtn.textContent;
      addToCanvasBtn.textContent = '✓ Saved!';
      addToCanvasBtn.style.color  = '#10b981';
      addToCanvasBtn.style.border = '1.5px solid #10b981';
      setTimeout(() => {
        addToCanvasBtn.textContent = orig;
        addToCanvasBtn.style.color  = '#6366f1';
        addToCanvasBtn.style.border = '1.5px solid #818cf8';
      }, 1500);
      if (canvasView.style.display !== 'none') renderCanvasInline();
    });

    useBtn.addEventListener('click', () => {
      if (!_currentComment) return;
      const textarea = _menuActiveTextbox || document.querySelector(TEXTBOX_SEL);
      if (textarea) {
        insertTextReact(textarea, _currentComment);
        requestAnimationFrame(() => textarea.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
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
        chip.style.background  = '#eef2ff';
        chip.style.borderColor = '#818cf8';
        labelEl.style.color    = '#6366f1';
        writeBtn.textContent   = `✦ Express with AI · ${toneObj.emoji} ${toneObj.label}`;
        writeBtn.style.display = '';
      });
    });

    document.body.appendChild(menu);
    return { menu, clampPosition };
  }

  // ─── Open / close menu ───────────────────────────────────────────────────────

  async function openTapMenu(tapRootBtn) {
    closeTapMenu();

    _userPlan = await getUserPlan();

    _menuActiveTextbox = document.querySelector(TEXTBOX_SEL);
    _menuPostText      = scrapePostText();

    const { menu, clampPosition } = buildTapMenu();

    const bRect     = tapRootBtn.getBoundingClientRect();
    const POPUP_W   = 320;
    const ESTIMATED_H = 420;
    const GAP = 8;

    let top  = bRect.top - ESTIMATED_H - GAP;
    let left = bRect.left;

    if (top < GAP) top = bRect.bottom + GAP;
    if (top + ESTIMATED_H > window.innerHeight - GAP) top = Math.max(GAP, window.innerHeight - ESTIMATED_H - GAP);
    if (left + POPUP_W > document.documentElement.clientWidth - GAP) left = document.documentElement.clientWidth - POPUP_W - GAP;
    if (left < GAP) left = GAP;

    menu.style.top        = `${top}px`;
    menu.style.left       = `${left}px`;
    menu.style.visibility = '';
    clampPosition();

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
    btn.title = 'Igfill – Comment Assistant';
    btn.setAttribute('aria-label', 'Comment Assistant');

    Object.assign(btn.style, {
      position:       'fixed',
      display:        'none',
      alignItems:     'center',
      justifyContent: 'center',
      width:          'auto',
      height:         '36px',
      padding:        '0',
      border:         'none',
      background:     'transparent',
      cursor:         'pointer',
      zIndex:         '999999',
      outline:        'none',
      transition:     'transform 0.12s ease',
    });

    btn.innerHTML = `<img src="${LOGO_URL}" height="36" style="display:block;width:auto" draggable="false">`;

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

  // ─── Find the leftmost anchor button in the comment toolbar ──────────────────

  function findFirstToolbarBtn(textarea) {
    let el = textarea.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!el || el === document.body) break;
      const btns = [...el.querySelectorAll('button, [role="button"], svg[role="img"]')]
        .filter(b => b.id !== TAP_ROOT_ID)
        .filter(b => {
          const br = b.getBoundingClientRect();
          return br.width > 0 && br.height > 0;
        });
      if (btns.length >= 1) {
        const r = textarea.getBoundingClientRect();
        const rightBtns = btns.filter(b => b.getBoundingClientRect().left >= r.right - 10);
        if (rightBtns.length) {
          return rightBtns
            .map(b => b.getBoundingClientRect())
            .reduce((a, b) => a.left < b.left ? a : b);
        }
        if (btns.length >= 2) {
          return btns
            .map(b => b.getBoundingClientRect())
            .reduce((a, b) => a.left < b.left ? a : b);
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function positionTapRoot(textarea) {
    const r = textarea.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    const btn   = getOrCreateTapRoot();
    const first = findFirstToolbarBtn(textarea);

    const leftPos = first
      ? first.left - 28 - 10
      : r.right + 8;

    const topPos = first
      ? first.top + (first.height - 28) / 2
      : r.top + (r.height - 28) / 2;

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

  // ─── MutationObserver ─────────────────────────────────────────────────────────

  let _toolbarObserver = null;

  function startToolbarObserver(textarea) {
    stopToolbarObserver();
    let container = textarea.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!container || container === document.body) break;
      const btns = container.querySelectorAll('button, [role="button"]');
      if (btns.length >= 1) break;
      container = container.parentElement;
    }
    if (!container || container === document.body) return;

    _toolbarObserver = new MutationObserver(() => {
      if (textboxFocused) positionTapRoot(textarea);
    });
    _toolbarObserver.observe(container, { childList: true, subtree: true });
  }

  function stopToolbarObserver() {
    if (_toolbarObserver) { _toolbarObserver.disconnect(); _toolbarObserver = null; }
  }

  // ─── Scroll / resize ─────────────────────────────────────────────────────────

  let textboxFocused = false;
  let tapHideTimer   = null;

  function reposition() {
    if (!textboxFocused) return;
    const textarea = document.querySelector(TEXTBOX_SEL);
    if (textarea) positionTapRoot(textarea);
  }

  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });

  // ─── focusin / focusout ───────────────────────────────────────────────────────

  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (
      target.tagName === 'TEXTAREA' &&
      target.getAttribute('aria-label')?.includes('Add a comment')
    ) {
      textboxFocused = true;
      clearTimeout(tapHideTimer);

      setTimeout(() => { if (textboxFocused) positionTapRoot(target); }, 100);
      setTimeout(() => {
        if (!textboxFocused) return;
        positionTapRoot(target);
        startToolbarObserver(target);
      }, 350);
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    const target = e.target;
    if (
      target.tagName === 'TEXTAREA' &&
      target.getAttribute('aria-label')?.includes('Add a comment')
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
