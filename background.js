// Tapfill background service worker v6
//
// Responsibilities:
//  1. Receive TAPFILL_AUTH_TOKEN from the SaaS dashboard (externally_connectable)
//     and store it in chrome.storage.local.
//  2. Proxy AI_FETCH port messages from content scripts → SaaS /api/ext/generate
//     using the stored Bearer token.
//  3. Proxy FEEDBACK messages → SaaS /api/ext/feedback.
//  4. Auto-refresh expired tokens via /api/ext/refresh before each API call.
//  5. Create/end extension_sessions records on login/logout.
//  6. Handle HEARTBEAT messages from content scripts → /api/ext/heartbeat.
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
    // Fetch real plan from server immediately after saving token
    refreshUserPlan(tokenData.access_token);
    // Create an extension_sessions record for this login
    createExtensionSession(tokenData.access_token);
    sendResponse({ ok: true });
  });
  return true;
});

// ── 2a. Simple message handler — open connect tab / heartbeat ─────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'OPEN_CONNECT') {
    console.log('[Tapfill background] OPEN_CONNECT received, opening tab');
    const extId = chrome.runtime.id;
    chrome.tabs.create({ url: `${SAAS_URL}/auth/extension-connect?ext_id=${extId}` });
    sendResponse({ ok: true });
  }
  if (msg?.type === 'OPEN_URL' && msg.url) {
    chrome.tabs.create({ url: msg.url });
    sendResponse({ ok: true });
  }
  if (msg?.type === 'HEARTBEAT') {
    handleHeartbeat();
    sendResponse({ ok: true });
  }
  if (msg?.type === 'LOGOUT') {
    chrome.storage.local.get('tapfill_token', (result) => {
      const accessToken = result.tapfill_token?.access_token;
      endExtensionSession(accessToken).finally(() => sendResponse({ ok: true }));
    });
    return true; // async sendResponse
  }
  return true;
});

// ── Plan refresh — fetches real plan from server and updates storage ───────────
async function refreshUserPlan(accessToken) {
  try {
    const res = await fetch(`${SAAS_URL}/api/ext/profile`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.plan) return;
    const stored = await chrome.storage.local.get('tapfill_user');
    if (stored.tapfill_user) {
      chrome.storage.local.set({ tapfill_user: { ...stored.tapfill_user, plan: data.plan } });
      console.log('[Tapfill] plan refreshed:', data.plan);
    }
  } catch (e) {
    console.warn('[Tapfill] plan refresh failed:', e);
  }
}

// Refresh plan on every service worker startup (handles Supabase plan changes)
chrome.storage.local.get(['tapfill_token', 'tapfill_session_id'], (result) => {
  if (result.tapfill_token?.access_token) {
    refreshUserPlan(result.tapfill_token.access_token);
    // Create session record if one doesn't exist yet (e.g. first startup after session tracking was added)
    if (!result.tapfill_session_id) {
      createExtensionSession(result.tapfill_token.access_token);
    }
  }
});

// ── Session management ────────────────────────────────────────────────────────

// Creates a record in extension_sessions on login.
async function createExtensionSession(accessToken) {
  try {
    const browserType = navigator.userAgent;
    const res = await fetch(`${SAAS_URL}/api/ext/session`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ browser_type: browserType }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.session_id) {
      chrome.storage.local.set({ tapfill_session_id: data.session_id });
      console.log('[Tapfill] session created:', data.session_id);
    }
  } catch (e) {
    console.warn('[Tapfill] session create failed:', e);
  }
}

// Marks the current session inactive on logout (fire-and-forget).
async function endExtensionSession(accessToken) {
  try {
    const stored = await chrome.storage.local.get('tapfill_session_id');
    const sessionId = stored.tapfill_session_id;
    if (!sessionId || !accessToken) return;
    await fetch(`${SAAS_URL}/api/ext/session`, {
      method:  'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ session_id: sessionId }),
    });
    chrome.storage.local.remove('tapfill_session_id');
    console.log('[Tapfill] session ended');
  } catch (e) {
    console.warn('[Tapfill] session end failed:', e);
  }
}

// Called by content script HEARTBEAT messages — updates last_active and syncs plan.
async function handleHeartbeat() {
  try {
    const stored = await chrome.storage.local.get(['tapfill_token', 'tapfill_session_id']);
    const tokenData = stored.tapfill_token;
    const sessionId = stored.tapfill_session_id;
    if (!tokenData?.access_token) return;

    const res = await fetch(`${SAAS_URL}/api/ext/heartbeat`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({ session_id: sessionId || null }),
    });
    if (!res.ok) return;
    const data = await res.json();
    // Sync plan if heartbeat returns an updated value
    if (data.plan) {
      const userStored = await chrome.storage.local.get('tapfill_user');
      if (userStored.tapfill_user && userStored.tapfill_user.plan !== data.plan) {
        chrome.storage.local.set({ tapfill_user: { ...userStored.tapfill_user, plan: data.plan } });
        console.log('[Tapfill] plan synced via heartbeat:', data.plan);
      }
    }
  } catch (e) {
    console.warn('[Tapfill] heartbeat failed:', e);
  }
}

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
        endExtensionSession(tokenData.access_token);
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
          endExtensionSession(tokenData.access_token);
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
        postText:   msg.postText,
        tone:       msg.tone,
        platform:   msg.platform || 'web',
        language:   msg.language || 'english',
        tonePrompt: msg.tonePrompt || null,
        imageMode:  msg.imageMode  || 'text-only',
        imageData:  msg.imageData  || null,
      }),
    });

    // Read as text first — avoids crash if server returns HTML error page
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      console.error('[Tapfill] non-JSON response from generate:', res.status, text.slice(0, 120));
      if (res.status === 401) {
        endExtensionSession(tokenData.access_token);
        chrome.storage.local.remove(['tapfill_token', 'tapfill_user']);
        port.postMessage({ ok: false, error: 'NOT_CONNECTED', notConnected: true });
      } else {
        port.postMessage({ ok: false, error: `Server error (${res.status}) — is the app running?` });
      }
      return;
    }

    if (!res.ok) {
      if (res.status === 401) {
        endExtensionSession(tokenData.access_token);
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

    // Refresh stored plan if server returned an updated value
    if (data.plan) {
      chrome.storage.local.get('tapfill_user', (stored) => {
        if (stored.tapfill_user && stored.tapfill_user.plan !== data.plan) {
          chrome.storage.local.set({ tapfill_user: { ...stored.tapfill_user, plan: data.plan } });
        }
      });
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
