// Tapfill background service worker v5
//
// Responsibilities:
//  1. Receive TAPFILL_AUTH_TOKEN from the SaaS dashboard (externally_connectable)
//     and store it in chrome.storage.local.
//  2. Proxy AI_FETCH port messages from content scripts → SaaS /api/ext/generate
//     using the stored Bearer token.
//  3. Proxy FEEDBACK messages → SaaS /api/ext/feedback.
//  4. Auto-refresh expired tokens via /api/ext/refresh before each API call.
//
// No API keys are stored here — all AI calls go through the user's account.

const SAAS_URL = 'https://tapfill-saas.vercel.app';

// ── 1. Receive auth token from SaaS dashboard ─────────────────────────────────
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'TAPFILL_AUTH_TOKEN') return;

  const tokenData = {
    access_token:  message.access_token,
    refresh_token: message.refresh_token,
    expires_at:    message.expires_at,
  };
  const userData = {
    user_email: message.user_email,
    user_name:  message.user_name,
    plan:       'free',
  };

  chrome.storage.local.set({ tapfill_token: tokenData, tapfill_user: userData }, () => {
    console.log('[Tapfill] auth token saved for', message.user_email);
    sendResponse({ ok: true });
  });
  return true;
});

// ── 2a. Simple message handler — open connect tab from content scripts ────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'OPEN_CONNECT') {
    console.log('[Tapfill background] OPEN_CONNECT received, opening tab');
    const extId = chrome.runtime.id;
    chrome.tabs.create({ url: `${SAAS_URL}/auth/extension-connect?ext_id=${extId}` });
    sendResponse({ ok: true });
  }
  return true;
});

// ── 2b. Port-based handler for content scripts ────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'AI_FETCH') return;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'GENERATE') {
      handleGenerate(msg, port);
    } else if (msg.type === 'FEEDBACK') {
      handleFeedback(msg);
    }
  });
});

// ── Token refresh helper ───────────────────────────────────────────────────────
// Returns a fresh tokenData object, or null if session is fully expired.
async function getFreshToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['tapfill_token'], async (result) => {
      const tokenData = result.tapfill_token;
      if (!tokenData?.access_token) { resolve(null); return; }

      // Check if token expires within the next 60 seconds
      const expiresAt  = tokenData.expires_at ?? 0;          // unix seconds
      const nowSeconds = Math.floor(Date.now() / 1000);
      const isExpired  = expiresAt - nowSeconds < 60;

      if (!isExpired) { resolve(tokenData); return; }

      // Token is expiring — refresh it
      if (!tokenData.refresh_token) {
        chrome.storage.local.remove(['tapfill_token', 'tapfill_user']);
        resolve(null);
        return;
      }

      try {
        const res = await fetch(`${SAAS_URL}/api/ext/refresh`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ refresh_token: tokenData.refresh_token }),
        });

        if (!res.ok) {
          console.warn('[Tapfill] token refresh failed:', res.status);
          chrome.storage.local.remove(['tapfill_token', 'tapfill_user']);
          resolve(null);
          return;
        }

        const fresh = await res.json();
        const newTokenData = {
          access_token:  fresh.access_token,
          refresh_token: fresh.refresh_token,
          expires_at:    fresh.expires_at,
        };
        chrome.storage.local.set({ tapfill_token: newTokenData });
        console.log('[Tapfill] token refreshed successfully');
        resolve(newTokenData);
      } catch (err) {
        console.warn('[Tapfill] token refresh error:', err.message);
        resolve(tokenData); // use old token as fallback
      }
    });
  });
}

// ── Generate: call /api/ext/generate with Bearer token ────────────────────────
async function handleGenerate(msg, port) {
  const tokenData = await getFreshToken();

  if (!tokenData?.access_token) {
    port.postMessage({ ok: false, error: 'NOT_CONNECTED', notConnected: true });
    return;
  }

  try {
    const res = await fetch(`${SAAS_URL}/api/ext/generate`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        postText: msg.postText,
        tone:     msg.tone,
        platform: msg.platform || 'web',
      }),
    });

    // Read as text first — avoids crash if server returns HTML error page
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      console.error('[Tapfill] non-JSON response from generate:', res.status, text.slice(0, 120));
      if (res.status === 401) {
        chrome.storage.local.remove(['tapfill_token', 'tapfill_user']);
        port.postMessage({ ok: false, error: 'NOT_CONNECTED', notConnected: true });
      } else {
        port.postMessage({ ok: false, error: `Server error (${res.status}) — is the app running?` });
      }
      return;
    }

    if (!res.ok) {
      if (res.status === 401) {
        chrome.storage.local.remove(['tapfill_token', 'tapfill_user']);
      }
      port.postMessage({
        ok:           false,
        error:        data.error || `HTTP ${res.status}`,
        detail:       data.detail || null,
        notConnected: res.status === 401,
        rateLimit:    res.status === 429,
      });
      return;
    }

    port.postMessage({ ok: true, variants: data.variants, commentId: data.commentId });
  } catch (err) {
    port.postMessage({ ok: false, error: err.message });
  }
}

// ── Feedback: fire-and-forget ─────────────────────────────────────────────────
async function handleFeedback(msg) {
  const tokenData = await getFreshToken();
  if (!tokenData?.access_token) return;

  try {
    await fetch(`${SAAS_URL}/api/ext/feedback`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({ commentId: msg.commentId, signal: msg.signal }),
    });
  } catch (err) {
    console.warn('[Tapfill] feedback failed:', err.message);
  }
}
