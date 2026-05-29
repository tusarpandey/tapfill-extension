// Tapfill popup — connection status, energy level, language, and usage bar.

const SAAS_URL = 'https://tapfill.io';

const PLAN_LIMITS = {
  free: 5, community_plus: 300, community_pro: 600, creator: 1500,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loadingView      = document.getElementById('loadingView');
const connectedView    = document.getElementById('connectedView');
const notConnectedView = document.getElementById('notConnectedView');
const statusDot        = document.getElementById('statusDot');
const userEmailEl      = document.getElementById('userEmail');
const userNameEl       = document.getElementById('userName');
const planBadgeEl      = document.getElementById('planBadge');

const usedCountEl      = document.getElementById('usedCount');
const usageLimitEl     = document.getElementById('usageLimit');
const usageFillComment = document.getElementById('usageFillComment');
const usageFillCaption = document.getElementById('usageFillCaption');
const commentCountLbl  = document.getElementById('commentCountLbl');
const captionCountLbl  = document.getElementById('captionCountLbl');
const usagePeriodLabel = document.getElementById('usagePeriodLabel');

// ── Views ─────────────────────────────────────────────────────────────────────
function showLoading() {
  loadingView.style.display      = '';
  connectedView.style.display    = 'none';
  notConnectedView.style.display = 'none';
  statusDot.className = 'status-dot dot-orange';
}

function showNotConnected() {
  loadingView.style.display      = 'none';
  connectedView.style.display    = 'none';
  notConnectedView.style.display = '';
  statusDot.className = 'status-dot dot-grey';
}

function showConnected(data) {
  loadingView.style.display      = 'none';
  connectedView.style.display    = 'flex';
  notConnectedView.style.display = 'none';
  statusDot.className = 'status-dot dot-green';

  userEmailEl.textContent = data.user_email || '—';
  userNameEl.textContent  = data.user_name  || data.user_email || '—';

  const plan   = data.plan || 'free';
  const isFree = plan === 'free';
  const limit  = PLAN_LIMITS[plan] ?? 5;

  planBadgeEl.textContent      = plan.replace(/_/g, ' ');
  usageLimitEl.textContent     = limit;
  usagePeriodLabel.textContent = isFree ? 'Used today' : 'Used this month';
}

// ── Usage bar ─────────────────────────────────────────────────────────────────
function applyUsage(commentsUsed, captionsUsed, limit, isFree) {
  const used       = commentsUsed + captionsUsed;
  const commentPct = Math.min((commentsUsed / limit) * 100, 100);
  const captionPct = Math.min((captionsUsed / limit) * 100, Math.max(0, 100 - commentPct));

  usedCountEl.textContent      = used;
  usageLimitEl.textContent     = limit;
  usageFillComment.style.width = commentPct + '%';
  usageFillCaption.style.width = captionPct + '%';
  commentCountLbl.textContent  = 'Comments ' + commentsUsed;
  captionCountLbl.textContent  = 'Captions ' + captionsUsed;
  usagePeriodLabel.textContent = isFree ? 'Used today' : 'Used this month';
}

async function fetchUsage(token, plan) {
  try {
    const res = await fetch(`${SAAS_URL}/api/ext/usage`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!res.ok) return;
    const data   = await res.json();
    const isFree = (plan || 'free') === 'free';
    const limit  = PLAN_LIMITS[plan || 'free'] ?? 5;
    applyUsage(data.comments_used ?? 0, data.captions_used ?? 0, limit, isFree);
  } catch {
    // Silent — counts stay as "—"
  }
}

// ── Session init ──────────────────────────────────────────────────────────────
showLoading();
chrome.storage.local.get(['tapfill_token', 'tapfill_user'], (result) => {
  if (result.tapfill_token && result.tapfill_user) {
    showConnected(result.tapfill_user);
    fetchUsage(result.tapfill_token.access_token, result.tapfill_user.plan);
  } else {
    showNotConnected();
  }
});

// ── Listen for storage changes (token saved after extension-connect) ──────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.tapfill_token && changes.tapfill_user) {
    const userData  = changes.tapfill_user.newValue;
    const tokenData = changes.tapfill_token.newValue;
    showConnected(userData);
    if (tokenData?.access_token) {
      fetchUsage(tokenData.access_token, userData.plan);
    }
  }
  if (changes.tapfill_token && !changes.tapfill_token.newValue) {
    showNotConnected();
  }
});

// ── Connect button ────────────────────────────────────────────────────────────
document.getElementById('connectBtn').addEventListener('click', () => {
  const extId      = chrome.runtime.id;
  const connectUrl = `${SAAS_URL}/auth/extension-connect?ext_id=${extId}`;

  notConnectedView.querySelector('p').textContent = 'Opening sign-in page…';
  const connectBtn = document.getElementById('connectBtn');
  connectBtn.disabled  = true;
  connectBtn.textContent = 'Opening…';

  function resetBtn() {
    const btn = document.getElementById('connectBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in via Tapfill →'; }
    notConnectedView.querySelector('p').textContent =
      'Sign in to Tapfill so your comments are saved, personalised, and tracked in your dashboard.';
  }

  chrome.tabs.create({ url: connectUrl }, (tab) => {
    if (chrome.runtime.lastError || !tab) { resetBtn(); return; }
    setTimeout(resetBtn, 60000);
  });
});

// ── Open dashboard ────────────────────────────────────────────────────────────
document.getElementById('openDashboardBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: `${SAAS_URL}/dashboard` });
  window.close();
});

// ── Disconnect ────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'LOGOUT' }, () => {
    chrome.storage.local.remove(['tapfill_token', 'tapfill_user', 'tapfill_session_id'], () => {
      showNotConnected();
    });
  });
});

// ── Energy selector ───────────────────────────────────────────────────────────
const energyItems = document.querySelectorAll('.energy-item');

function setActiveEnergy(level) {
  energyItems.forEach(el => el.classList.toggle('active', el.dataset.energy === level));
}

chrome.storage.local.get(['tapfill_energy'], (result) => {
  setActiveEnergy(result.tapfill_energy || 'balanced');
});

energyItems.forEach(item => {
  item.addEventListener('click', () => {
    const level = item.dataset.energy;
    setActiveEnergy(level);
    chrome.storage.local.set({ tapfill_energy: level });
  });
});

// ── Language selector ─────────────────────────────────────────────────────────
const langBtns = document.querySelectorAll('.lang-btn');

function setActiveLang(lang) {
  langBtns.forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

chrome.storage.local.get(['tapfill_language'], (result) => {
  setActiveLang(result.tapfill_language || 'english');
});

langBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const lang = btn.dataset.lang;
    setActiveLang(lang);
    chrome.storage.local.set({ tapfill_language: lang });
  });
});
