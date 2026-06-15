

// ============================================================
//  customer/js/dashboard.js  —  Firebase onSnapshot version
//
//  3 Live Hooks:
//  1. onSnapshot(users/mobile)       → points, visits, UI update
//  2. onSnapshot(settings/config)    → banner, offers update
//  3. renderAll()                    → full UI bind from data
//
//  No more setInterval jugaad — pure real-time!
// ============================================================

import { LS, SHOP, DEFAULTS, COLLECTIONS } from '../../shared/constants.js';
import { getCurrentUserSync, logoutUser, generateCouponCode } from './auth.js';

// ── Firebase ─────────────────────────────────────────────────
let db, docFn, onSnapshotFn, getDocFn, FIREBASE_READY = false;

async function initFirebase() {
  try {
    const cfg   = await import('../../shared/firebase-config.js');
    db           = cfg.db;
    docFn        = cfg.doc;
    onSnapshotFn = cfg.onSnapshot;
    getDocFn     = cfg.getDoc;
    FIREBASE_READY = true;
    console.log('[dashboard.js] Firebase connected ✅');
  } catch (e) {
    FIREBASE_READY = false;
    console.warn('[dashboard.js] Firebase offline — polling fallback', e.message);
  }
}

// ── State ─────────────────────────────────────────────────────
let user      = null;
let settings  = {};
let unsubUser = null;   // Firestore unsubscribe fn
let unsubSett = null;   // Firestore settings unsubscribe
let _polls    = [];     // setInterval handles (fallback only)

// ============================================================
//  initDashboard()
//  DOMContentLoaded pe call karo
// ============================================================
export async function initDashboard() {

  // ── Auth guard ──────────────────────────────────────────
  user = getCurrentUserSync();
  if (!user) { window.location.href = 'index.html'; return; }

  // ── Load cached settings ────────────────────────────────
  settings = JSON.parse(localStorage.getItem(LS.settings) || '{}');

  // ── Initial render with cached data ─────────────────────
  renderAll(user, settings);

  // ── Firebase connect then start live listeners ───────────
  await initFirebase();

  // ── HOOK 1: Real-time user data ──────────────────────────
  _startUserListener(user.mobile);

  // ── HOOK 2: Real-time settings / admin offers ────────────
  _startSettingsListener();
}

// ============================================================
//  HOOK 1 — Real-time User Listener
//  Firebase: onSnapshot → instant update
//  Fallback: 3s polling if Firebase not available
// ============================================================
function _startUserListener(mobile) {
  if (FIREBASE_READY) {
    // ── Firebase onSnapshot ─────────────────────────────────
    unsubUser = onSnapshotFn(
      docFn(db, COLLECTIONS.users, mobile),
      (snap) => {
        if (!snap.exists()) return;
        const fresh = snap.data();

        // Sync to LS cache
        _syncToLS(fresh);

        // Detect actual changes before re-render
        if (JSON.stringify(fresh) !== JSON.stringify(user)) {
          user = fresh;
          renderAll(user, settings);
          // Subtle flash on points change
          _flashElement('stat-pts');
        }
      },
      (err) => {
        console.error('[onSnapshot user] Error:', err);
        _fallbackUserPoll(mobile);
      }
    );

  } else {
    _fallbackUserPoll(mobile);
  }
}

function _fallbackUserPoll(mobile) {
  let lastSeen = JSON.stringify(user);
  const id = setInterval(() => {
    const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
    const fresh = users.find(u => u.mobile === mobile);
    if (!fresh) return;
    const str = JSON.stringify(fresh);
    if (str !== lastSeen) {
      lastSeen = str;
      user = fresh;
      renderAll(user, settings);
    }
  }, 3000);
  _polls.push(id);
}

// ============================================================
//  HOOK 2 — Admin Settings / Announcement Listener
//  Admin settings change → banner/offers turant update
// ============================================================
function _startSettingsListener() {
  if (FIREBASE_READY) {
    // COLLECTIONS.settings = "rollhub_config"
    // Document ID = "settings" (ya "config" — constants.js se)
    unsubSett = onSnapshotFn(
      docFn(db, COLLECTIONS.settings, 'settings'),
      (snap) => {
        if (!snap.exists()) return;
        const fresh = snap.data();

        // Sync to LS
        localStorage.setItem(LS.settings, JSON.stringify(fresh));

        if (JSON.stringify(fresh) !== JSON.stringify(settings)) {
          settings = fresh;
          // Partial re-render — sirf offer-related UI
          renderOfferBanner(user, settings);
          renderStreak(user, settings);
          renderReferral(user, settings);
          renderCoupon(user, settings);
        }
      },
      (err) => {
        console.warn('[onSnapshot settings] Error:', err);
        _fallbackSettingsPoll();
      }
    );

  } else {
    _fallbackSettingsPoll();
  }
}

function _fallbackSettingsPoll() {
  let lastSett = JSON.stringify(settings);
  const id = setInterval(() => {
    const fresh = JSON.parse(localStorage.getItem(LS.settings) || '{}');
    const str   = JSON.stringify(fresh);
    if (str !== lastSett) {
      lastSett = str;
      settings = fresh;
      renderOfferBanner(user, settings);
      renderStreak(user, settings);
      renderReferral(user, settings);
      renderCoupon(user, settings);
    }
  }, 5000);
  _polls.push(id);
}

// ============================================================
//  HOOK 3 — renderAll()
//  Single source of truth — user + settings → poora UI
// ============================================================
function renderAll(u, s) {
  renderHero(u, s);
  renderStats(u);
  renderOfferBanner(u, s);
  renderCoupon(u, s);
  renderStreak(u, s);
  renderReferral(u, s);
}

// ── 3a. Hero / Greeting ──────────────────────────────────────
function renderHero(u, s) {
  const hr    = new Date().getHours();
  const greet = hr < 12 ? 'Good Morning ☀️' : hr < 17 ? 'Good Afternoon 🌤️' : 'Good Evening 🌙';
  setText('dash-greeting', greet);
  setText('dash-name',     u.name);
  setText('dash-pts',      u.points || 0);

  // First-time vs returning hero style
  const heroEl = document.getElementById('dash-hero');
  if (heroEl) {
    heroEl.className = u.dashVisited ? 'dash-hero returning' : 'dash-hero first-time';
  }

  // First visit celebration — mark once
  if (!u.dashVisited) {
    show('first-banner', true);
    // Mark in Firestore + LS (fire and forget)
    _markDashVisited(u.mobile);
  }
}

async function _markDashVisited(mobile) {
  if (FIREBASE_READY) {
    try {
      const { updateDoc } = await import('../../shared/firebase-config.js');
      await updateDoc(docFn(db, COLLECTIONS.users, mobile), { dashVisited: true });
    } catch (e) { /* non-critical */ }
  }
  // LS
  const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
  const idx   = users.findIndex(u => u.mobile === mobile);
  if (idx !== -1) { users[idx].dashVisited = true; localStorage.setItem(LS.users, JSON.stringify(users)); }
}

// ── 3b. Stats strip ─────────────────────────────────────────
function renderStats(u) {
  setText('stat-visits', u.visits    || 0);
  setText('stat-pts',    u.points    || 0);
  setText('stat-saved',  '₹' + (u.saved || 0));
  setText('stat-refs',   u.referrals || 0);
}

// ── 3c. Offer / Announcement Banner (HOOK 2 output) ─────────
//  Priority: Admin message > Birthday > Birthday soon > Special offer
export function renderOfferBanner(u, s) {
  const today    = new Date();
  const dob      = u.dob ? new Date(u.dob) : null;
  const isBday   = dob && dob.getDate()===today.getDate() && dob.getMonth()===today.getMonth();
  const bannerEl = document.getElementById('offer-banner');
  if (!bannerEl) return;

  // Priority 1: Admin announcement (from Firestore settings)
  if (s.announcement_show && s.announcement_text) {
    bannerEl.style.display = 'flex';
    setText('banner-icon',  s.announcement_icon || '📢');
    setText('banner-title', s.announcement_text);
    setText('banner-sub',   s.announcement_sub  || '');
    return;
  }

  // Legacy field support
  if (s.todayMessage) {
    bannerEl.style.display = 'flex';
    setText('banner-icon',  s.todayMessageIcon || '📢');
    setText('banner-title', s.todayMessage);
    setText('banner-sub',   s.todayMessageSub || '');
    return;
  }

  // Priority 2: Birthday today
  if (isBday) {
    bannerEl.style.display = 'flex';
    setText('banner-icon',  '🎂');
    setText('banner-title', `Happy Birthday ${u.name.split(' ')[0]}! 🎉`);
    setText('banner-sub',   'FREE Roll ya Momos + 15% off — aaj sirf aapke liye!');
    return;
  }

  // Priority 3: Birthday coming soon (7 days)
  if (dob) {
    const next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    if (next < today) next.setFullYear(today.getFullYear() + 1);
    const diff = Math.ceil((next - today) / 864e5);
    if (diff <= 7) {
      bannerEl.style.display = 'flex';
      setText('banner-icon',  '🎂');
      setText('banner-title', `Birthday ${diff} din mein!`);
      setText('banner-sub',   'Kuch khaas wait kar raha hai aapke liye!');
      return;
    }
  }

  // Priority 4: Win-back / special offer
  if (u.specialOffer?.active) {
    bannerEl.style.display = 'flex';
    setText('banner-icon',  '🎁');
    setText('banner-title', u.specialOffer.label || 'Special Offer!');
    setText('banner-sub',   `Sirf ${u.specialOffer.validDays || 7} din ke liye valid`);
    return;
  }

  // No banner
  bannerEl.style.display = 'none';
}

// ── 3d. Coupon ───────────────────────────────────────────────
export function renderCoupon(u, s) {
  const code    = generateCouponCode(u.mobile, 'welcome');
  const discPct = s.defaultWelcomeDisc || DEFAULTS.welcomeDiscPct || 10;
  setText('coupon-code',  code);
  setText('coupon-pct',   discPct + '% OFF');
  setText('coupon-label', 'Welcome Discount');

  const copyBtn = document.getElementById('copy-btn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(code).catch(() => {});
      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('ok');
      setTimeout(() => {
        copyBtn.textContent = '📋 Copy';
        copyBtn.classList.remove('ok');
      }, 2200);
    };
  }
}

// ── 3e. Visit Streak / Progress bar ─────────────────────────
export function renderStreak(u, s) {
  const mob    = u.mobile;
  const goal   = s.visitRewards?.[mob]?.threshold
               || s.defaultVisitThreshold
               || DEFAULTS.visitGoal
               || 5;
  const rew    = s.visitRewards?.[mob]?.reward
               || s.defaultVisitReward
               || DEFAULTS.visitReward
               || 'FREE Roll ya Momos';
  const visits = u.visits || 0;
  const cycle  = visits % goal;

  setText('streak-title', rew + ' Reward');
  setText('streak-badge', cycle + '/' + goal);
  setText('streak-sub',   goal + ' visits pe ' + rew + '!');

  // ── Progress bar (if present) ─────────────────────────
  const bar = document.getElementById('streak-bar');
  if (bar) {
    const pct = Math.round((cycle / goal) * 100);
    bar.style.width = pct + '%';
  }

  // ── Dots ──────────────────────────────────────────────
  const dotsEl = document.getElementById('streak-dots');
  if (dotsEl) {
    dotsEl.innerHTML = '';
    for (let i = 0; i < goal; i++) {
      const d = document.createElement('div');
      d.className = 'dot'
        + (i < cycle     ? ' done' : '')
        + (i === goal-1  ? ' goal' : '');
      dotsEl.appendChild(d);
    }
  }

  // ── Message ───────────────────────────────────────────
  const msgEl = document.getElementById('streak-msg');
  if (msgEl) {
    if (cycle === 0 && visits > 0) {
      msgEl.textContent = '🎉 Aaj FREE item eligible! Counter pe batao.';
      msgEl.className   = 's-msg win';
    } else {
      const left = goal - cycle;
      msgEl.textContent = left + ' aur visit' + (left===1?'':'s') + ' chahiye — ' + rew + ' milega!';
      msgEl.className   = 's-msg';
    }
  }
}

// ── 3f. Referral Card ────────────────────────────────────────
export function renderReferral(u, s) {
  const mob   = u.mobile;
  const steps = s.referralRewards?.[mob]?.steps
              || s.defaultRefSteps
              || DEFAULTS.refSteps
              || [50, 120, 200];
  const count = u.referrals || 0;

  setText('ref-sub', `Har dost = ${steps[0]} pts! ${steps.length} dost = ${steps[steps.length-1]} pts!`);

  const tiersEl = document.getElementById('ref-tiers');
  if (tiersEl) {
    tiersEl.innerHTML = steps.map((pts, i) => `
      <div class="ref-tier ${count > i ? 'done' : ''}">
        <div class="rt-num">${i + 1}</div>
        <div class="rt-pts">${pts} pts</div>
      </div>`).join('');
  }

  // Share button
  const shareBtn = document.getElementById('ref-share-btn');
  if (shareBtn) {
    shareBtn.onclick = () => {
      const base = window.location.href.replace('dashboard.html','');
      const link = `${base}index.html?ref=${mob}`;
      const txt  = `Yaar! ${SHOP.name} mein amazing rolls milte hain 🌯 Mere referral se join karo — discount milega! ${link}`;
      if (navigator.share) {
        navigator.share({ title: SHOP.name, text: txt, url: link });
      } else {
        navigator.clipboard.writeText(txt).catch(() => {});
        const orig = shareBtn.textContent;
        shareBtn.textContent = '✓ Link Copied!';
        setTimeout(() => shareBtn.textContent = orig, 2200);
      }
    };
  }
}

// ============================================================
//  LOGOUT — cleanup listeners before leaving
// ============================================================
export function handleLogout() {
  // Stop Firestore listeners
  if (unsubUser) { unsubUser(); unsubUser = null; }
  if (unsubSett) { unsubSett(); unsubSett = null; }

  // Stop fallback polls
  _polls.forEach(clearInterval);
  _polls = [];

  logoutUser();
  window.location.href = 'index.html';
}

// ============================================================
//  PRIVATE HELPERS
// ============================================================
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function show(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? 'flex' : 'none';
}

function _syncToLS(user) {
  const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
  const idx   = users.findIndex(u => u.mobile === user.mobile);
  if (idx !== -1) users[idx] = user; else users.push(user);
  localStorage.setItem(LS.users, JSON.stringify(users));
}

function _flashElement(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transition = 'color .15s';
  el.style.color      = '#22c55e';
  setTimeout(() => { el.style.color = ''; }, 600);
}

