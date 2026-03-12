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
    { emoji: '🌻', label: 'Warm',      desc: 'Genuine. Heart-first.',              tone: 'friendly',     temp: 0.5 },
    { emoji: '💎', label: 'Confident', desc: 'Direct. Clear. No second-guessing.', tone: 'supportive',  temp: 0.3 },
    { emoji: '😄', label: 'Witty',     desc: 'Sharp edge, light touch.',           tone: 'funny',        temp: 0.9 },
    { emoji: '🎬', label: 'Filmy',     desc: 'Full cinematic. Dramatic flair.',    tone: 'disagree',     temp: 0.8 },
  ];

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

  // ─── AI call via background port ─────────────────────────────────────────────

  async function generateAllVariants(postText, toneObj) {
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
        resolve({ variants: response.variants, commentId: response.commentId || null });
      });
      port.onDisconnect.addListener(() => {
        if (settled) return; settled = true;
        reject(new Error(chrome.runtime.lastError?.message || 'Port disconnected'));
      });
      port.postMessage({ type: 'GENERATE', postText, tone: toneObj.tone, platform: 'instagram' });
    });
  }

  // ─── Canvas — persists across menu opens ──────────────────────────────────────

  let _canvasItems = []; // { id, text, toneEmoji, toneLabel, energyLabel }

  async function shareCanvasAsImage(shareBtn) {
    if (!_canvasItems.length) return;

    const W = 380, PAD = 18, CARD_GAP = 12, LINE_H = 19, EMO_W = 50;
    const CARD_PAD = 14, HDR_H = 76, FTR_H = 36, DPR = 2;
    const ff = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

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
    const totalH = HDR_H + PAD
      + cardHeights.reduce((a, h) => a + h + CARD_GAP, 0)
      + PAD + FTR_H;

    const cv = document.createElement('canvas');
    cv.width = W * DPR; cv.height = totalH * DPR;
    const ctx = cv.getContext('2d');
    ctx.scale(DPR, DPR);

    const bgGrad = ctx.createLinearGradient(0, 0, W, totalH);
    bgGrad.addColorStop(0, '#eef2ff');
    bgGrad.addColorStop(1, '#faf5ff');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, totalH);

    // Header
    const logoImg = new Image();
    logoImg.src = LOGO_URL;
    await new Promise(r => { logoImg.onload = r; logoImg.onerror = r; });
    const logoH = 28, logoW = logoImg.width ? Math.round(logoImg.width * (logoH / logoImg.height)) : 28;
    ctx.drawImage(logoImg, PAD, (HDR_H - logoH) / 2, logoW, logoH);
    ctx.font = `700 15px ${ff}`;
    ctx.fillStyle = '#6366f1';
    ctx.fillText('tapfill', PAD + logoW + 8, HDR_H / 2 - 4);
    ctx.font = `400 13px ${ff}`;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText('·  My Canvas', PAD + logoW + 8, HDR_H / 2 + 9);

    // Cards
    let y = HDR_H + PAD;
    const ENERGY_ACCENT = { subtle: '#a78bfa', balanced: '#818cf8', bold: '#6366f1', powerful: '#4338ca' };
    _canvasItems.forEach((item, i) => {
      const h = cardHeights[i];
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(PAD, y, W - PAD * 2, h, 12);
      ctx.fill();
      const accent = ENERGY_ACCENT[item.energyLabel.toLowerCase()] || '#818cf8';
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(PAD, y, 6, h, [12, 0, 0, 12]);
      ctx.fill();
      ctx.font = `20px ${ff}`;
      ctx.fillText(item.toneEmoji, PAD + 14, y + CARD_PAD + 16);
      ctx.font = `600 9px ${ff}`;
      ctx.fillStyle = '#6366f1';
      ctx.fillText(item.toneLabel, PAD + 14, y + CARD_PAD + 28);
      ctx.font = `400 9px ${ff}`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(item.energyLabel, PAD + 14, y + CARD_PAD + 38);
      ctx.font = `400 13px ${ff}`;
      ctx.fillStyle = '#1e293b';
      let line = '', lx = PAD + EMO_W, ly = y + CARD_PAD + 13;
      item.text.split(/\s+/).forEach(w => {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > TEXT_W) {
          ctx.fillText(line, lx, ly); ly += LINE_H; line = w;
        } else line = t;
      });
      if (line) ctx.fillText(line, lx, ly);
      y += h + CARD_GAP;
    });

    // Footer
    ctx.font = `500 11px ${ff}`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Generated by Tapfill · tapfill.io', PAD, totalH - FTR_H / 2 + 4);

    const orig = shareBtn.textContent;
    try {
      shareBtn.textContent = 'Copying…';
      shareBtn.disabled = true;
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      shareBtn.textContent = '✓ Copied!';
      setTimeout(() => { shareBtn.textContent = orig; shareBtn.disabled = false; }, 2000);
    } catch {
      shareBtn.textContent = orig;
      shareBtn.disabled = false;
    }
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
      display: 'flex', gap: '6px', flexWrap: 'nowrap', overflowX: 'auto',
      justifyContent: 'center',
    });
    menu.appendChild(chipsRow);

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
    let _currentEnergyIdx = 1;

    const SPINNER_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" style="animation:ig-tap-spin 0.7s linear infinite;flex-shrink:0"><circle cx="8" cy="8" r="6" fill="none" stroke="#818cf8" stroke-width="2" stroke-dasharray="25" stroke-dashoffset="9"/></svg>`;

    function clampPosition() {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const mRect = menu.getBoundingClientRect();
        const GAP = 8;
        if (mRect.bottom > window.innerHeight - GAP) {
          const newTop = parseFloat(menu.style.top) - (mRect.bottom - (window.innerHeight - GAP));
          menu.style.top = `${Math.max(GAP, newTop)}px`;
        }
        if (parseFloat(menu.style.top) < GAP) menu.style.top = `${GAP}px`;
        if (mRect.right > window.innerWidth - GAP) {
          const newLeft = parseFloat(menu.style.left) - (mRect.right - (window.innerWidth - GAP));
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
        upgradeBtn.addEventListener('click', () => chrome.tabs.create({ url: 'https://tapfill.io/pricing' }));
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
        spinnerWrap.innerHTML = `<span style="color:#ef4444;font-size:12px">Generation failed — try a different tone.</span>`;
        spinnerWrap.style.display = 'flex';
      }
      commentEl.style.display  = 'none';
      energyBar.style.display  = 'none';
      actionRow.style.display  = 'none';
      clampPosition();
    }

    async function generateForTone(toneObj) {
      if (_currentEnergyIdx !== 1) {
        energyDots[_currentEnergyIdx].style.boxShadow = 'none';
        energyDots[1].style.boxShadow = `0 0 0 2px #fff, 0 0 0 4px ${DOT_PALETTE[1].ring}`;
        _currentEnergyIdx = 1;
      }
      showLoading();
      try {
        const { variants, commentId } = await generateAllVariants(_menuPostText, toneObj);
        _currentCommentId = commentId;
        _currentVariants  = variants;
        showComment(variants[ENERGIES[_currentEnergyIdx].key]);
      } catch (err) {
        const isRateLimit = err.rateLimit || err.message.includes('429') || err.message.toLowerCase().includes('daily limit');
        console.error('[Tapfill] generate failed:', err);
        if (isRateLimit) { showError(false, true); return; }
        showError(err.notConnected, false);
      }
    }

    // ── Canvas View ───────────────────────────────────────────────────────────
    const mainViewEls = [header, chipsRow, sep, resultCard];

    const canvasView = document.createElement('div');
    Object.assign(canvasView.style, {
      display: 'none', flexDirection: 'column',
      flex: '1', minHeight: '0', overflow: 'hidden', paddingBottom: '10px',
    });
    canvasView.addEventListener('mousedown', e => e.preventDefault());
    menu.appendChild(canvasView);

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

    const cvList = document.createElement('div');
    Object.assign(cvList.style, {
      flex: '1', minHeight: '0', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: '8px',
      padding: '2px 0 6px',
    });
    canvasView.appendChild(cvList);

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
        Object.assign(card.style, {
          display: 'flex', alignItems: 'flex-start', gap: '8px',
          padding: '10px', background: '#f8fafc',
          borderRadius: '12px', border: '1px solid #e2e8f0',
        });
        const meta = document.createElement('div');
        Object.assign(meta.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', minWidth: '36px' });
        const emojiEl = document.createElement('span');
        emojiEl.textContent = item.toneEmoji;
        emojiEl.style.fontSize = '18px';
        const lblTone = document.createElement('span');
        lblTone.textContent = item.toneLabel;
        Object.assign(lblTone.style, { fontSize: '8px', color: '#6366f1', fontWeight: '600', textAlign: 'center' });
        const lblEnergy = document.createElement('span');
        lblEnergy.textContent = item.energyLabel;
        Object.assign(lblEnergy.style, { fontSize: '8px', color: '#94a3b8', textAlign: 'center' });
        meta.append(emojiEl, lblTone, lblEnergy);
        const textEl = document.createElement('p');
        Object.assign(textEl.style, { margin: '0', flex: '1', fontSize: '12px', lineHeight: '1.55', color: '#1e293b', wordBreak: 'break-word' });
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
        card.append(meta, textEl, discardBtn);
        cvList.appendChild(card);
      });
    }

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
      closeTapMenu();
    });

    TONES.forEach((toneObj) => {
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
        if (_selectedChip && _selectedChip !== chip) {
          _selectedChip.style.background  = '#f8fafc';
          _selectedChip.style.borderColor = 'transparent';
          _selectedChip.querySelector('span:last-child').style.color = '#64748b';
        }
        _selectedChip = chip;
        _currentTone  = toneObj;
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

  function openTapMenu(tapRootBtn) {
    closeTapMenu();

    _menuActiveTextbox = document.querySelector(TEXTBOX_SEL);
    _menuPostText      = scrapePostText();

    const { menu } = buildTapMenu();

    const bRect     = tapRootBtn.getBoundingClientRect();
    const POPUP_W   = 320;
    const ESTIMATED_H = 420;
    const GAP = 8;

    let top  = bRect.top - ESTIMATED_H - GAP;
    let left = bRect.left;

    if (top < GAP) top = bRect.bottom + GAP;
    if (top + ESTIMATED_H > window.innerHeight - GAP) top = Math.max(GAP, window.innerHeight - ESTIMATED_H - GAP);
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

})();
