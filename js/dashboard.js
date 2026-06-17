
























// ============================================================
//  customer/js/dashboard.js  —  Firebase onSnapshot version
// ============================================================

import { LS, SHOP, DEFAULTS, COLLECTIONS } from '../shared/constants.js';
import { getCurrentUserSync, logoutUser, generateCouponCode } from './auth.js';

let db, docFn, onSnapshotFn, getDocs, queryFn, whereFn, collFn, FIREBASE_READY = false;

async function initFirebase() {
  try {
    const cfg   = await import('../shared/firebase-config.js');
    db           = cfg.db;
    docFn        = cfg.doc;
    onSnapshotFn = cfg.onSnapshot;
    getDocs      = cfg.getDocs;
    queryFn      = cfg.query;
    whereFn      = cfg.where;
    collFn       = cfg.collection;
    FIREBASE_READY = true;
    console.log('[dashboard.js] Firebase connected ✅');
  } catch (e) {
    FIREBASE_READY = false;
    console.warn('[dashboard.js] Firebase offline', e.message);
  }
}

let user = null, settings = {}, unsubUser = null, unsubSett = null, _polls = [];

export async function initDashboard() {
  user = getCurrentUserSync();
  if (!user) { window.location.href = 'index.html'; return; }
  settings = JSON.parse(localStorage.getItem(LS.settings) || '{}');
  renderAll(user, settings);
  await initFirebase();
  _startUserListener(user.mobile);
  _startSettingsListener();
  _loadActiveRewards();
  _setupCopyDelegation();
  _startRewardsPoll();
}

function _startUserListener(mobile) {
  if (FIREBASE_READY) {
    unsubUser = onSnapshotFn(
      docFn(db, COLLECTIONS.users, mobile),
      (snap) => {
        if (!snap.exists()) return;
        const fresh = snap.data();
        _syncToLS(fresh);
        if (JSON.stringify(fresh) !== JSON.stringify(user)) {
          user = fresh;
          renderAll(user, settings);
          _flashElement('stat-pts');
        }
      },
      (err) => { console.error('[onSnapshot user]', err); _fallbackUserPoll(mobile); }
    );
  } else { _fallbackUserPoll(mobile); }
}

function _fallbackUserPoll(mobile) {
  let last = JSON.stringify(user);
  const id = setInterval(() => {
    const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
    const fresh = users.find(u => u.mobile === mobile);
    if (!fresh) return;
    const str = JSON.stringify(fresh);
    if (str !== last) { last = str; user = fresh; renderAll(user, settings); }
  }, 3000);
  _polls.push(id);
}

function _startSettingsListener() {
  if (FIREBASE_READY) {
    unsubSett = onSnapshotFn(
      docFn(db, COLLECTIONS.settings, 'settings'),
      (snap) => {
        if (!snap.exists()) return;
        const fresh = snap.data();
        localStorage.setItem(LS.settings, JSON.stringify(fresh));
        if (JSON.stringify(fresh) !== JSON.stringify(settings)) {
          settings = fresh;
          renderOfferBanner(user, settings);
          renderStreak(user, settings);
          renderReferral(user, settings);
          renderCoupon(user, settings);
        }
      },
      (err) => { console.warn('[onSnapshot settings]', err); _fallbackSettingsPoll(); }
    );
  } else { _fallbackSettingsPoll(); }
}

function _fallbackSettingsPoll() {
  let last = JSON.stringify(settings);
  const id = setInterval(() => {
    const fresh = JSON.parse(localStorage.getItem(LS.settings) || '{}');
    const str = JSON.stringify(fresh);
    if (str !== last) {
      last = str; settings = fresh;
      renderOfferBanner(user, settings);
      renderStreak(user, settings);
      renderReferral(user, settings);
      renderCoupon(user, settings);
    }
  }, 5000);
  _polls.push(id);
}

// ── Poll rewards every 15s so used/expired coupons disappear live ──
function _startRewardsPoll() {
  const id = setInterval(_loadActiveRewards, 15000);
  _polls.push(id);
}

// ── Event delegation for copy buttons — NO inline onclick needed ──
function _setupCopyDelegation() {
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.rw-copy-btn');
    if (!btn) return;
    const code = btn.getAttribute('data-code') || '';
    navigator.clipboard.writeText(code).catch(function(){});
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.style.background = '#22c55e';
    setTimeout(function() {
      btn.textContent = '📋 Copy';
      btn.style.background = '#ffd600';
    }, 2000);
  });
}

// ── Rewards from admin ───────────────────────────────────────
async function _loadActiveRewards() {
  if (!FIREBASE_READY) return;
  try {
    const snap = await getDocs(
      queryFn(collFn(db, 'rewards'), whereFn('active', '==', true))
    );
    const allRewards = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // ── Filter out rewards this customer already used (singleUse) ──
    const mobile0 = user ? user.mobile : null;
    const rewards = allRewards.filter(function(rw) {
      if (rw.singleUse && rw.usedBy && mobile0 && rw.usedBy.indexOf(mobile0) !== -1) {
        return false; // already used by this customer — hide it
      }
      if (rw.maxUses && (rw.usageCount || 0) >= rw.maxUses) {
        return false; // global limit reached — hide for everyone
      }
      return true;
    });

    if (!rewards.length) {
      // No active rewards left for this user — hide section
      const secEl = document.getElementById('rewards-section');
      if (secEl) secEl.style.display = 'none';
      _loadRewardsHistory(allRewards);
      return;
    }

    // ── 1. Show first reward in offer-banner (only if no birthday) ──
    const bannerEl   = document.getElementById('offer-banner');
    const currentTxt = document.getElementById('banner-title');
    const hasBirthday = bannerEl &&
      bannerEl.style.display === 'flex' &&
      currentTxt &&
      (currentTxt.textContent.indexOf('Birthday') !== -1);

    if (!hasBirthday && bannerEl) {
      const r = rewards[0];
      bannerEl.style.display = 'flex';
      const iconEl  = document.getElementById('banner-icon');
      const titleEl = document.getElementById('banner-title');
      const subEl   = document.getElementById('banner-sub');
      if (iconEl)  iconEl.textContent  = '🎁';
      if (titleEl) titleEl.textContent = r.title || r.label || r.name || 'Special Offer!';
      let sub = '';
      if (r.description) sub += r.description;
      const dpct = parseInt(r.discountPct) || 0;
      if (dpct > 0) sub += (sub ? ' — ' : '') + dpct + '% OFF';
      if (r.code) sub += (sub ? ' · ' : '') + 'Code: ' + r.code;
      if (subEl) subEl.textContent = sub || 'Counter pe batao!';
    }

    // ── 2. Show ALL rewards in dedicated section ──────────────────
    const secEl  = document.getElementById('rewards-section');
    const listEl = document.getElementById('rewards-list');
    if (secEl && listEl) {
      secEl.style.display = 'block';
      let html = '';
      rewards.forEach(function(rw) {
        const dpct    = parseInt(rw.discountPct) || 0;
        const title   = rw.title || rw.label || rw.name || 'Special Offer';
        const expiry  = rw.expiryDate
          ? 'Valid till: ' + new Date(rw.expiryDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})
          : 'No expiry — hamesha valid';
        const maxUses = rw.maxUses ? (rw.usageCount||0) + '/' + rw.maxUses + ' used' : '';
        const code    = rw.code || '';

        // Build card pieces separately
        var topBar = '<div style="background:linear-gradient(90deg,#fff8cc,#fff3b0);padding:14px 16px;border-bottom:1.5px dashed #ffe58f;display:flex;align-items:center;gap:10px">'
          + '<div style="font-size:26px">🎁</div>'
          + '<div style="flex:1">'
          + '<div style="font-size:15px;font-weight:800;color:#1a1a1a">' + title + '</div>';
        if (rw.description) topBar += '<div style="font-size:12px;color:#998a4a;font-weight:600;margin-top:2px;line-height:1.4">' + rw.description + '</div>';
        if (dpct > 0) topBar += '<div style="font-size:13px;font-weight:700;color:#e5221a;margin-top:4px">' + dpct + '% OFF — Har order pe discount!</div>';
        topBar += '</div>';
        if (maxUses) topBar += '<div style="font-size:11px;font-weight:700;color:#aaa;flex-shrink:0">' + maxUses + '</div>';
        topBar += '</div>';

        var codeSection = '';
        if (code) {
          codeSection = '<div style="padding:12px 16px;background:#fff">'
            + '<div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Coupon Code</div>'
            + '<div style="display:flex;align-items:center;gap:8px;background:#f8f8f8;border:1.5px dashed #e0e0e0;border-radius:10px;padding:10px 14px">'
            + '<div style="font-family:monospace;font-size:18px;font-weight:800;letter-spacing:3px;color:#1a1a1a;flex:1">' + code + '</div>'
            + '<button class="rw-copy-btn" data-code="' + code + '" style="background:#ffd600;border:none;border-radius:8px;padding:7px 14px;font-weight:800;font-size:12px;cursor:pointer;color:#1a1a1a;white-space:nowrap">📋 Copy</button>'
            + '</div>'
            + '<div style="font-size:11px;color:#bbb;font-weight:600;margin-top:8px">👆 Counter pe yeh code dikhao — discount turant milega!</div>'
            + '</div>';
        }

        var footer = '<div style="padding:8px 16px;background:#fffdf0;border-top:1px solid #fff3b0;display:flex;justify-content:space-between;align-items:center">'
          + '<div style="font-size:11px;color:#aaa;font-weight:600">🕐 ' + expiry + '</div>';
        if (dpct > 0) footer += '<div style="font-size:12px;font-weight:800;color:#e5221a">' + dpct + '% Discount</div>';
        footer += '</div>';

        html += '<div style="background:#fff;border:1.5px solid #ffe58f;border-radius:16px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 10px rgba(0,0,0,.06)">'
          + topBar + codeSection + footer + '</div>';
      });
      listEl.innerHTML = html;
    }

    // ── 3. Save to LS for admin tracking ─────────────────────────
    const mobile = user ? user.mobile : 'guest';
    const track  = JSON.parse(localStorage.getItem('krh_user_rewards') || '{}');
    track[mobile] = {
      rewards:   rewards.map(r => ({ id: r.id, label: r.title || r.label || r.name, code: r.code })),
      seenAt:    new Date().toISOString(),
    };
    localStorage.setItem('krh_user_rewards', JSON.stringify(track));
    console.log('[rewards] Loaded ' + rewards.length + ' rewards for ' + mobile);

    // ── 4. Load history (used + expired) — needs ALL rewards, not just active ──
    _loadRewardsHistory(null);

  } catch(e) {
    console.warn('[rewards] fetch failed:', e.message);
  }
}

// ============================================================
//  REWARDS HISTORY — Used + Expired (builds trust + FOMO)
// ============================================================
async function _loadRewardsHistory(preloadedAllActive) {
  if (!FIREBASE_READY || !user) return;
  try {
    // Fetch the COMPLETE rewards collection (active + inactive, all of them)
    const snap = await getDocs(collFn(db, 'rewards'));
    const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const today = new Date();
    const mobile = user.mobile;

    const used = [];
    const expired = [];

    all.forEach(function(rw) {
      const wasUsedByMe = rw.usedBy && rw.usedBy.indexOf(mobile) !== -1;
      const isExpired = rw.expiryDate && new Date(rw.expiryDate) < today;
      const isMaxedOut = rw.maxUses && (rw.usageCount || 0) >= rw.maxUses;

      if (wasUsedByMe) {
        used.push(rw);
      } else if ((isExpired || isMaxedOut || !rw.active) && !wasUsedByMe) {
        // Only show as "missed" if it was potentially relevant — skip silently otherwise
        // (we don't have per-user eligibility history, so show generically as expired)
        if (isExpired || (!rw.active && rw.createdAt)) expired.push(rw);
      }
    });

    const histSecEl = document.getElementById('rewards-history-section');
    const histListEl = document.getElementById('rewards-history-list');
    const savedEl = document.getElementById('rewards-total-saved');

    if (!histSecEl) return;

    if (used.length === 0 && expired.length === 0) {
      histSecEl.style.display = 'none';
      return;
    }
    histSecEl.style.display = 'block';

    // ── Calculate THIS customer's total savings from savedAmounts map ──
    let totalSaved = 0;
    used.forEach(function(rw) {
      const myAmt = rw.savedAmounts && rw.savedAmounts[mobile] ? parseInt(rw.savedAmounts[mobile]) || 0 : 0;
      totalSaved += myAmt;
    });
    if (savedEl) {
      savedEl.textContent = totalSaved > 0 ? ('₹' + totalSaved) : (used.length + ' offers redeemed');
    }

    // ── Build history list (used first, then expired) ──
    let html = '';

    used.forEach(function(rw) {
      const title = rw.title || rw.label || rw.name || 'Special Offer';
      const dpct  = parseInt(rw.discountPct) || 0;
      const myAmt = rw.savedAmounts && rw.savedAmounts[mobile] ? parseInt(rw.savedAmounts[mobile]) || 0 : 0;
      let subTxt = dpct > 0 ? (dpct + '% OFF redeem kiya') : 'Redeem kiya';
      if (myAmt > 0) subTxt += ' · ₹' + myAmt + ' bachaye';
      html += '<div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:14px;padding:13px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px">'
        + '<div style="font-size:20px;flex-shrink:0">✅</div>'
        + '<div style="flex:1">'
        + '<div style="font-size:13px;font-weight:800;color:#166534">' + title + '</div>'
        + '<div style="font-size:11px;color:#16a34a;font-weight:600;margin-top:2px">' + subTxt + '</div>'
        + '</div>'
        + (myAmt > 0 ? '<div style="font-size:13px;font-weight:800;color:#16a34a;flex-shrink:0">₹' + myAmt + '</div>' : '<div style="font-size:10px;font-weight:800;color:#16a34a;background:#dcfce7;padding:3px 9px;border-radius:99px;flex-shrink:0">USED</div>')
        + '</div>';
    });

    expired.forEach(function(rw) {
      const title = rw.title || rw.label || rw.name || 'Special Offer';
      const dpct  = parseInt(rw.discountPct) || 0;
      html += '<div style="background:#fafafa;border:1.5px solid #e8e8e8;border-radius:14px;padding:13px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px;opacity:.75">'
        + '<div style="font-size:20px;flex-shrink:0">⏳</div>'
        + '<div style="flex:1">'
        + '<div style="font-size:13px;font-weight:800;color:#888;text-decoration:line-through">' + title + '</div>'
        + '<div style="font-size:11px;color:#bbb;font-weight:600;margin-top:2px">' + (dpct > 0 ? dpct + '% OFF — miss ho gaya' : 'Expire ho gaya') + '</div>'
        + '</div>'
        + '<div style="font-size:10px;font-weight:800;color:#999;background:#eee;padding:3px 9px;border-radius:99px;flex-shrink:0">EXPIRED</div>'
        + '</div>';
    });

    if (expired.length > 0) {
      html += '<div style="text-align:center;font-size:11.5px;color:#e5221a;font-weight:700;margin-top:6px">😬 Agli baar jaldi karo — offers limited time ke liye hote hain!</div>';
    }

    if (histListEl) histListEl.innerHTML = html;

    // ── Toggle expand/collapse ──
    const toggleBtn = document.getElementById('rewards-history-toggle');
    const arrowEl   = document.getElementById('rewards-history-arrow');
    if (toggleBtn && !toggleBtn._bound) {
      toggleBtn._bound = true;
      toggleBtn.addEventListener('click', function() {
        const isOpen = histListEl.style.display !== 'none';
        histListEl.style.display = isOpen ? 'none' : 'block';
        if (arrowEl) arrowEl.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
      });
    }

  } catch (e) {
    console.warn('[rewards history] fetch failed:', e.message);
  }
}

function renderAll(u, s) {
  renderHero(u, s);
  renderStats(u);
  renderOfferBanner(u, s);
  renderCoupon(u, s);
  renderStreak(u, s);
  renderReferral(u, s);
}

function renderHero(u, s) {
  const hr    = new Date().getHours();
  const greet = hr < 12 ? 'Good Morning ☀️' : hr < 17 ? 'Good Afternoon 🌤️' : 'Good Evening 🌙';
  setText('dash-greeting', greet);
  setText('dash-name',     u.name);
  setText('dash-pts',      u.points || 0);
  const heroEl = document.getElementById('dash-hero');
  if (heroEl) heroEl.className = u.dashVisited ? 'dash-hero returning' : 'dash-hero first-time';
  if (!u.dashVisited) { show('first-banner', true); _markDashVisited(u.mobile); }
}

async function _markDashVisited(mobile) {
  if (FIREBASE_READY) {
    try {
      const { updateDoc } = await import('../shared/firebase-config.js');
      await updateDoc(docFn(db, COLLECTIONS.users, mobile), { dashVisited: true });
    } catch (e) {}
  }
  const users = JSON.parse(localStorage.getItem(LS.users) || '[]');
  const idx   = users.findIndex(u => u.mobile === mobile);
  if (idx !== -1) { users[idx].dashVisited = true; localStorage.setItem(LS.users, JSON.stringify(users)); }
}

function renderStats(u) {
  setText('stat-visits', u.visits    || 0);
  setText('stat-pts',    u.points    || 0);
  setText('stat-saved',  '₹' + (u.saved || 0));
  setText('stat-refs',   u.referrals || 0);
}

export function renderOfferBanner(u, s) {
  const today    = new Date();
  const dob      = u.dob ? new Date(u.dob) : null;
  const isBday   = dob && dob.getDate()===today.getDate() && dob.getMonth()===today.getMonth();
  const bannerEl = document.getElementById('offer-banner');
  if (!bannerEl) return;
  if (s.announcement_show && s.announcement_text) {
    bannerEl.style.display = 'flex';
    setText('banner-icon', s.announcement_icon || '📢');
    setText('banner-title', s.announcement_text);
    setText('banner-sub', s.announcement_sub || '');
    return;
  }
  if (s.todayMessage) {
    bannerEl.style.display = 'flex';
    setText('banner-icon', s.todayMessageIcon || '📢');
    setText('banner-title', s.todayMessage);
    setText('banner-sub', s.todayMessageSub || '');
    return;
  }
  if (isBday) {
    bannerEl.style.display = 'flex';
    setText('banner-icon', '🎂');
    setText('banner-title', `Happy Birthday ${u.name.split(' ')[0]}! 🎉`);
    setText('banner-sub', 'FREE Roll ya Momos + 15% off — aaj sirf aapke liye!');
    return;
  }
  if (dob) {
    const next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    if (next < today) next.setFullYear(today.getFullYear() + 1);
    const diff = Math.ceil((next - today) / 864e5);
    if (diff <= 7) {
      bannerEl.style.display = 'flex';
      setText('banner-icon', '🎂');
      setText('banner-title', `Birthday ${diff} din mein!`);
      setText('banner-sub', 'Kuch khaas wait kar raha hai aapke liye!');
      return;
    }
  }
  if (u.specialOffer?.active) {
    bannerEl.style.display = 'flex';
    setText('banner-icon', '🎁');
    setText('banner-title', u.specialOffer.label || 'Special Offer!');
    setText('banner-sub', `Sirf ${u.specialOffer.validDays || 7} din ke liye valid`);
    return;
  }
  bannerEl.style.display = 'none';
}

export function renderCoupon(u, s) {
  const code    = generateCouponCode(u.mobile, 'welcome');
  const discPct = s.defaultWelcomeDisc || DEFAULTS.welcomeDiscPct || 10;
  setText('coupon-code', code);
  setText('coupon-pct', discPct + '% OFF');
  setText('coupon-label', 'Welcome Discount');
  const copyBtn = document.getElementById('copy-btn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(code).catch(() => {});
      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('ok');
      setTimeout(() => { copyBtn.textContent = '📋 Copy'; copyBtn.classList.remove('ok'); }, 2200);
    };
  }
}

export function renderStreak(u, s) {
  const goal   = s.defaultVisitThreshold || DEFAULTS.visitGoal || 5;
  const rew    = s.defaultVisitReward    || DEFAULTS.visitReward || 'FREE Roll ya Momos';
  const visits = u.visits || 0;
  const cycle  = visits % goal;
  setText('streak-title', rew + ' Reward');
  setText('streak-badge', cycle + '/' + goal);
  setText('streak-sub',   goal + ' visits pe ' + rew + '!');
  const bar = document.getElementById('streak-bar');
  if (bar) bar.style.width = Math.round((cycle / goal) * 100) + '%';
  const dotsEl = document.getElementById('streak-dots');
  if (dotsEl) {
    dotsEl.innerHTML = '';
    for (let i = 0; i < goal; i++) {
      const d = document.createElement('div');
      d.className = 'dot' + (i < cycle ? ' done' : '') + (i === goal-1 ? ' goal' : '');
      dotsEl.appendChild(d);
    }
  }
  const msgEl = document.getElementById('streak-msg');
  if (msgEl) {
    if (cycle === 0 && visits > 0) { msgEl.textContent = '🎉 Aaj FREE item eligible! Counter pe batao.'; msgEl.className = 's-msg win'; }
    else { msgEl.textContent = (goal - cycle) + ' aur visits chahiye — ' + rew + ' milega!'; msgEl.className = 's-msg'; }
  }
}

export function renderReferral(u, s) {
  const steps = s.defaultRefSteps || DEFAULTS.refSteps || [50, 120, 200];
  const count = u.referrals || 0;
  setText('ref-sub', `Har dost = ${steps[0]} pts! ${steps.length} dost = ${steps[steps.length-1]} pts!`);
  const tiersEl = document.getElementById('ref-tiers');
  if (tiersEl) {
    tiersEl.innerHTML = steps.map((pts, i) =>
      `<div class="ref-tier ${count > i ? 'done' : ''}"><div class="rt-num">${i+1}</div><div class="rt-pts">${pts} pts</div></div>`
    ).join('');
  }
  const shareBtn = document.getElementById('ref-share-btn');
  if (shareBtn) {
    shareBtn.onclick = () => {
      const base = window.location.href.replace('dashboard.html', '');
      const link = `${base}index.html?ref=${u.mobile}`;
      const txt  = `Yaar! ${SHOP.name} mein amazing rolls milte hain 🌯 Mere referral se join karo — discount milega! ${link}`;
      if (navigator.share) navigator.share({ title: SHOP.name, text: txt, url: link });
      else {
        navigator.clipboard.writeText(txt).catch(() => {});
        const orig = shareBtn.textContent;
        shareBtn.textContent = '✓ Link Copied!';
        setTimeout(() => shareBtn.textContent = orig, 2200);
      }
    };
  }
}

export function handleLogout() {
  if (unsubUser) { unsubUser(); unsubUser = null; }
  if (unsubSett) { unsubSett(); unsubSett = null; }
  _polls.forEach(clearInterval);
  _polls = [];
  logoutUser();
  window.location.href = 'index.html';
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function show(id, v) { const el = document.getElementById(id); if (el) el.style.display = v ? 'flex' : 'none'; }
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
  el.style.color = '#22c55e';
  setTimeout(() => { el.style.color = ''; }, 600);
}