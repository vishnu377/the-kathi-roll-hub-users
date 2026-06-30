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

import { LS, SHOP, DEFAULTS, COLLECTIONS } from '../shared/constants.js';
import { getCurrentUserSync, logoutUser, generateCouponCode } from './auth.js';

// ── Firebase ─────────────────────────────────────────────────
let db, docFn, onSnapshotFn, getDocFn, getDocs, queryFn, whereFn, collFn, FIREBASE_READY = false;

async function initFirebase() {
  try {
    const cfg   = await import('../shared/firebase-config.js');
    db           = cfg.db;
    docFn        = cfg.doc;
    onSnapshotFn = cfg.onSnapshot;
    getDocFn     = cfg.getDoc;
    getDocs      = cfg.getDocs;
    queryFn      = cfg.query;
    whereFn      = cfg.where;
    collFn       = cfg.collection;
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

// Menu category-tabs state
let _menuItemsCache  = [];
let _menuActiveCat   = 'All';

// Offers cache (simple scroll-list, no pagination)
let _rewardsCache = [];

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

  // ── HOOK 3: Active Rewards + History ─────────────────────
  _loadActiveRewards();
  _setupCopyDelegation();
  _startRewardsPoll();

  // ── HOOK 4: Menu ──────────────────────────────────────────
  _loadMenu();
}

// ============================================================
//  HOOK 1 — Real-time User Listener
//  Firebase: onSnapshot → instant update
//  Fallback: 3s polling if Firebase not available
// ============================================================
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
// ============================================================
function _startSettingsListener() {
  if (FIREBASE_READY) {
    unsubSett = onSnapshotFn(
      docFn(db, COLLECTIONS.settings, 'config'),
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

// ── Format reward value based on its type (%, ₹, or free item) ──
function _rewardLabel(rw) {
  const type = rw.type || 'discount';
  const val  = rw.value || rw.discountPct || 0;
  if (type === 'cashback')  return '₹' + val + ' OFF';
  if (type === 'free_item') return 'FREE ' + val;
  return (parseInt(val) || 0) + '% OFF';
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

// ── Poll rewards every 15s so used/expired coupons disappear live ──
function _startRewardsPoll() {
  const id = setInterval(_loadActiveRewards, 15000);
  _polls.push(id);
}

// ============================================================
//  ACTIVE REWARDS from admin — Top 3 + "Show All" pattern
// ============================================================
async function _loadActiveRewards() {
  if (!FIREBASE_READY) return;
  try {
    const snap = await getDocs(
      queryFn(collFn(db, 'rewards'), whereFn('active', '==', true))
    );
    const allRewards = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const mobile0 = user ? user.mobile : null;
    const rewards = allRewards.filter(function(rw) {
      // Personal targeting: if targetMobile is set, only show to that exact customer
      if (rw.targetMobile && rw.targetMobile !== mobile0) return false;
      if (rw.singleUse && rw.usedBy && mobile0 && rw.usedBy.indexOf(mobile0) !== -1) return false;
      if (rw.maxUses && (rw.usageCount || 0) >= rw.maxUses) return false;
      return true;
    });

    if (!rewards.length) {
      const secEl = document.getElementById('rewards-section');
      if (secEl) secEl.style.display = 'none';
      _loadRewardsHistory();
      return;
    }

    // Show first reward in offer banner (skip if birthday already showing)
    const bannerEl   = document.getElementById('offer-banner');
    const currentTxt = document.getElementById('banner-title');
    const hasBirthday = bannerEl && bannerEl.style.display === 'flex' &&
      currentTxt && currentTxt.textContent.indexOf('Birthday') !== -1;

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
      sub += (sub ? ' — ' : '') + _rewardLabel(r);
      if (r.code) sub += (sub ? ' · ' : '') + 'Code: ' + r.code;
      if (subEl) subEl.textContent = sub || 'Counter pe batao!';
    }

    // Cache full list, render scroll-list
    _rewardsCache = rewards;
    _renderRewardsList();

    const mobile = user ? user.mobile : 'guest';
    const track  = JSON.parse(localStorage.getItem('krh_user_rewards') || '{}');
    track[mobile] = { rewards: rewards.map(r => ({ id: r.id, label: r.title || r.label || r.name, code: r.code })), seenAt: new Date().toISOString() };
    localStorage.setItem('krh_user_rewards', JSON.stringify(track));

    _loadRewardsHistory();
  } catch(e) {
    console.warn('[rewards] fetch failed:', e.message);
  }
}

// ── Build a single reward-card's HTML ──────────────────────
function _buildRewardCard(rw, idx) {
  const offLabel = _rewardLabel(rw);
  const title   = rw.title || rw.label || rw.name || 'Special Offer';
  const expiry  = rw.expiryDate
    ? 'Valid till: ' + new Date(rw.expiryDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})
    : 'No expiry — hamesha valid';
  const maxUses = rw.maxUses ? (rw.usageCount||0) + '/' + rw.maxUses + ' used' : '';
  const code    = rw.code || '';
  const isPersonal = !!rw.targetMobile;

  var topBar = '<div style="background:' + (isPersonal ? 'linear-gradient(90deg,#f3e8ff,#ede9fe)' : 'linear-gradient(90deg,#fff8cc,#fff3b0)') + ';padding:14px 16px;border-bottom:1.5px dashed ' + (isPersonal ? '#c4b5fd' : '#ffe58f') + ';display:flex;align-items:center;gap:10px">'
    + '<div style="font-size:26px">' + (isPersonal ? '💜' : '🎁') + '</div>'
    + '<div style="flex:1">'
    + (isPersonal ? '<div style="font-size:10px;font-weight:800;color:#7c3aed;background:#ede9fe;display:inline-block;padding:2px 9px;border-radius:99px;margin-bottom:4px">🎁 Exclusive Offer for You!</div><br/>' : '')
    + '<div style="font-size:15px;font-weight:800;color:#1a1a1a">' + title + '</div>';
  if (rw.description) topBar += '<div style="font-size:12px;color:#998a4a;font-weight:600;margin-top:2px;line-height:1.4">' + rw.description + '</div>';
  topBar += '<div style="font-size:13px;font-weight:700;color:#e5221a;margin-top:4px">' + offLabel + ' — Har order pe discount!</div>';
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
    + '<div style="font-size:11px;color:#aaa;font-weight:600">🕐 ' + expiry + '</div>'
    + '<div style="font-size:12px;font-weight:800;color:#e5221a">' + offLabel + '</div></div>';

  return '<div class="rw-card" data-search="' + (title + ' ' + (rw.description||'')).toLowerCase() + '" '
    + 'style="background:#fff;border:1.5px solid ' + (isPersonal ? '#c4b5fd' : '#ffe58f') + ';border-radius:16px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 10px rgba(0,0,0,.06)">'
    + topBar + codeSection + footer + '</div>';
}

// ── Render rewards list — full cards, always visible, scrollable ──
function _renderRewardsList() {
  const secEl  = document.getElementById('rewards-section');
  const listEl = document.getElementById('rewards-list');
  if (!secEl || !listEl) return;

  secEl.style.display = 'block';

  let searchHtml = '<input type="text" id="rewards-search" placeholder="🔍 Offer search karo..." '
    + 'style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid #efefef;border-radius:12px;font-family:var(--font);font-size:13px;margin-bottom:10px;outline:none" '
    + 'oninput="window._filterRewards(this.value)"/>';

  let cardsHtml = '<div id="rewards-scroll" style="max-height:340px;overflow-y:auto;padding-right:2px">';
  _rewardsCache.forEach(function(rw, idx) {
    cardsHtml += _buildRewardCard(rw, idx);
  });
  cardsHtml += '</div>';

  listEl.innerHTML = searchHtml + cardsHtml;
}



window._filterRewards = function(q) {
  q = (q || '').toLowerCase();
  document.querySelectorAll('.rw-card').forEach(function(card) {
    const match = card.getAttribute('data-search').indexOf(q) !== -1;
    card.style.display = match ? 'block' : 'none';
  });
};


// ============================================================
//  REWARDS HISTORY — Used + Expired (builds trust + FOMO)
// ============================================================
async function _loadRewardsHistory() {
  if (!FIREBASE_READY || !user) return;
  try {
    const snap = await getDocs(collFn(db, 'rewards'));
    const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const today = new Date();
    const mobile = user.mobile;

    const used = [];
    const expired = [];

    all.forEach(function(rw) {
      const wasUsedByMe = rw.usedBy && rw.usedBy.indexOf(mobile) !== -1;
      const isExpired = rw.expiryDate && new Date(rw.expiryDate) < today;
      if (wasUsedByMe) { used.push(rw); }
      else if (isExpired || (!rw.active && rw.createdAt)) { expired.push(rw); }
    });

    const histSecEl  = document.getElementById('rewards-history-section');
    const histListEl = document.getElementById('rewards-history-list');
    const savedEl    = document.getElementById('rewards-total-saved');
    if (!histSecEl) return;

    if (used.length === 0 && expired.length === 0) { histSecEl.style.display = 'none'; return; }
    histSecEl.style.display = 'block';

    let totalSaved = 0;
    used.forEach(function(rw) {
      const myAmt = rw.savedAmounts && rw.savedAmounts[mobile] ? parseInt(rw.savedAmounts[mobile]) || 0 : 0;
      totalSaved += myAmt;
    });
    if (savedEl) savedEl.textContent = totalSaved > 0 ? ('₹' + totalSaved) : (used.length + ' offers redeemed');

    let html = '<div id="rewards-history-scroll" style="max-height:280px;overflow-y:auto;padding-right:2px">';
    used.forEach(function(rw) {
      const title = rw.title || rw.label || rw.name || 'Special Offer';
      const offLabel = _rewardLabel(rw);
      const myAmt = rw.savedAmounts && rw.savedAmounts[mobile] ? parseInt(rw.savedAmounts[mobile]) || 0 : 0;
      let subTxt = offLabel + ' redeem kiya';
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
      const offLabel = _rewardLabel(rw);
      html += '<div style="background:#fafafa;border:1.5px solid #e8e8e8;border-radius:14px;padding:13px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px;opacity:.75">'
        + '<div style="font-size:20px;flex-shrink:0">⏳</div>'
        + '<div style="flex:1">'
        + '<div style="font-size:13px;font-weight:800;color:#888;text-decoration:line-through">' + title + '</div>'
        + '<div style="font-size:11px;color:#bbb;font-weight:600;margin-top:2px">' + offLabel + ' — miss ho gaya</div>'
        + '</div>'
        + '<div style="font-size:10px;font-weight:800;color:#999;background:#eee;padding:3px 9px;border-radius:99px;flex-shrink:0">EXPIRED</div>'
        + '</div>';
    });
    if (expired.length > 0) html += '<div style="text-align:center;font-size:11.5px;color:#e5221a;font-weight:700;margin-top:6px">😬 Agli baar jaldi karo — offers limited time ke liye hote hain!</div>';
    html += '</div>';

    if (histListEl) histListEl.innerHTML = html;

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

// ============================================================
//  MENU — Category Tabs + items (replaces flat scroll-list)
// ============================================================
async function _loadMenu() {
  if (!FIREBASE_READY) return;
  try {
    const snap = await getDocs(collFn(db, 'menu'));
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(i => i.showOnApp !== false);

    const secEl  = document.getElementById('menu-section');
    if (!secEl) return;

    if (!items.length) { secEl.style.display = 'none'; return; }
    secEl.style.display = 'block';

    // Best sellers first within each category
    items.sort((a, b) => (b.isBestSeller ? 1 : 0) - (a.isBestSeller ? 1 : 0));

    _menuItemsCache = items;
    _menuActiveCat  = 'All';

    _renderMenuSearchBar();
    _renderMenuCatTabs();
    _renderMenuItems();
  } catch (e) {
    console.warn('[menu] fetch failed:', e.message);
  }
}

// ── Search bar (separate from tabs, always visible) ──────────
function _renderMenuSearchBar() {
  const wrap = document.getElementById('menu-search-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<input type="text" id="menu-search" placeholder="🔍 Item search karo..." '
    + 'style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid #efefef;border-radius:12px;font-family:var(--font);font-size:13px;margin-bottom:12px;outline:none" '
    + 'oninput="window._filterMenu(this.value)"/>';
}

// ── Category tabs — built from admin-defined categories ──────
function _renderMenuCatTabs() {
  const tabsEl = document.getElementById('menu-cat-tabs');
  if (!tabsEl) return;

  // Collect unique categories that actually have items, preserve a sane order
  const seen = new Set();
  const cats = [];
  _menuItemsCache.forEach(it => {
    const c = it.category || 'Other';
    if (!seen.has(c)) { seen.add(c); cats.push(c); }
  });

  const allTabs = ['All', ...cats];

  tabsEl.innerHTML = allTabs.map(cat => {
    const count = cat === 'All'
      ? _menuItemsCache.length
      : _menuItemsCache.filter(it => (it.category || 'Other') === cat).length;
    const isOn = cat === _menuActiveCat;
    return '<button type="button" class="cat-tab' + (isOn ? ' on' : '') + '" data-cat="' + cat.replace(/"/g,'&quot;') + '">'
      + cat + ' (' + count + ')'
      + '</button>';
  }).join('');

  tabsEl.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', function() {
      _menuActiveCat = this.getAttribute('data-cat');
      // Reset search when switching tabs, for a predictable view
      const searchInp = document.getElementById('menu-search');
      if (searchInp) searchInp.value = '';
      _renderMenuCatTabs();
      _renderMenuItems();
    });
  });
}

// ── Build a single menu item's card HTML ──────────────────────
function _buildMenuCard(it) {
  const isOut = it.available === false;
  const hasDisc = (parseFloat(it.discount) || 0) > 0;
  const price = parseFloat(it.price) || 0;
  const finalPrice = hasDisc ? Math.round(price * (1 - (parseFloat(it.discount)/100))) : price;
  const hasVariants = it.variants && it.variants.length > 0;

  let priceHtml;
  if (hasVariants) {
    const prices = it.variants.map(v => parseFloat(v.price) || 0);
    const minP = Math.min(...prices), maxP = Math.max(...prices);
    priceHtml = '<span style="font-weight:800;color:#1a1a1a;font-size:15px">₹' + minP + (minP !== maxP ? '–' + maxP : '') + '</span>';
  } else {
    priceHtml = hasDisc
      ? '<span style="text-decoration:line-through;color:#bbb;font-size:13px;margin-right:6px">₹' + price + '</span><span style="font-weight:800;color:#e5221a;font-size:16px">₹' + finalPrice + '</span>'
      : '<span style="font-weight:800;color:#1a1a1a;font-size:16px">₹' + price + '</span>';
  }

  let badges = '';
  if (it.isBestSeller) badges += '<span style="font-size:10px;font-weight:800;color:#92400e;background:#fef9c3;padding:2px 8px;border-radius:99px;margin-right:5px">⭐ Best Seller</span>';
  if (hasDisc && !hasVariants) badges += '<span style="font-size:10px;font-weight:800;color:#e5221a;background:#fff0f0;padding:2px 8px;border-radius:99px;margin-right:5px">' + it.discount + '% OFF</span>';
  if (it.prepTime) badges += '<span style="font-size:10px;font-weight:700;color:#888;background:#f5f5f5;padding:2px 8px;border-radius:99px">⏱️ ' + it.prepTime + ' min</span>';

  let variantChips = '';
  if (hasVariants) {
    variantChips = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'
      + it.variants.map(v =>
          '<span style="font-size:11px;font-weight:700;color:#555;background:#f5f5f5;border:1px solid #e8e8e8;padding:3px 10px;border-radius:99px">'
          + v.name + ' · ₹' + v.price + '</span>'
        ).join('')
      + '</div>';
  }

  return '<div class="menu-card" data-search="' + (it.name||'').toLowerCase() + '" '
    + 'style="background:#fff;border:1.5px solid #efefef;border-radius:14px;padding:13px 16px;margin-bottom:9px;display:flex;align-items:' + (hasVariants ? 'flex-start' : 'center') + ';gap:12px' + (isOut ? ';opacity:.5' : '') + '">'
    + '<div style="font-size:26px;flex-shrink:0">' + (it.emoji || '🌯') + '</div>'
    + '<div style="flex:1">'
    + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
    + '<span style="width:8px;height:8px;border-radius:50%;background:' + (it.type === 'veg' ? '#22c55e' : '#e5221a') + ';flex-shrink:0"></span>'
    + '<span style="font-size:14px;font-weight:700;color:#1a1a1a">' + (it.name||'') + '</span>'
    + '</div>'
    + (badges ? '<div style="margin-bottom:4px">' + badges + '</div>' : '')
    + (isOut ? '<div style="font-size:11px;color:#e5221a;font-weight:700">Abhi available nahi hai</div>' : '')
    + variantChips
    + '</div>'
    + '<div style="flex-shrink:0;text-align:right">' + priceHtml + '</div>'
    + '</div>';
}

// ── Render items for the currently-active category tab ───────
function _renderMenuItems() {
  const listEl = document.getElementById('menu-list');
  if (!listEl) return;

  const items = _menuActiveCat === 'All'
    ? _menuItemsCache
    : _menuItemsCache.filter(it => (it.category || 'Other') === _menuActiveCat);

  if (!items.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--txt3);font-size:13px;color:#bbb">Iss category mein abhi koi item nahi hai</div>';
    return;
  }

  let html = '<div id="menu-scroll" style="max-height:380px;overflow-y:auto;padding-right:2px">';
  items.forEach(function(it) {
    html += _buildMenuCard(it);
  });
  html += '</div>';

  listEl.innerHTML = html;
}

// ── Search works across ALL items regardless of active tab ───
window._filterMenu = function(q) {
  q = (q || '').toLowerCase().trim();

  if (!q) {
    // Empty search → go back to normal category view
    _renderMenuItems();
    return;
  }

  // While searching, search across everything (ignore category tabs)
  const matches = _menuItemsCache.filter(it => (it.name || '').toLowerCase().includes(q));
  const listEl = document.getElementById('menu-list');
  if (!listEl) return;

  if (!matches.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#bbb;font-size:13px">Koi item nahi mila</div>';
    return;
  }

  let html = '<div id="menu-scroll" style="max-height:380px;overflow-y:auto;padding-right:2px">';
  matches.forEach(function(it) {
    html += _buildMenuCard(it);
  });
  html += '</div>';
  listEl.innerHTML = html;
};

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

  const heroEl = document.getElementById('dash-hero');
  if (heroEl) {
    heroEl.className = u.dashVisited ? 'dash-hero returning' : 'dash-hero first-time';
  }

  if (!u.dashVisited) {
    show('first-banner', true);
    _markDashVisited(u.mobile);
  }
}

async function _markDashVisited(mobile) {
  if (FIREBASE_READY) {
    try {
      const { updateDoc } = await import('../shared/firebase-config.js');
      await updateDoc(docFn(db, COLLECTIONS.users, mobile), { dashVisited: true });
    } catch (e) { /* non-critical */ }
  }
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
//  NEW: Birthday section skips check if feature_birthdayOffer === false
export function renderOfferBanner(u, s) {
  const today    = new Date();
  const dob      = u.dob ? new Date(u.dob) : null;
  const isBday   = dob && dob.getDate()===today.getDate() && dob.getMonth()===today.getMonth();
  const bannerEl = document.getElementById('offer-banner');
  if (!bannerEl) return;

  if (s.announcement_show && s.announcement_text) {
    bannerEl.style.display = 'flex';
    setText('banner-icon',  s.announcement_icon || '📢');
    setText('banner-title', s.announcement_text);
    setText('banner-sub',   s.announcement_sub  || '');
    return;
  }

  if (s.todayMessage) {
    bannerEl.style.display = 'flex';
    setText('banner-icon',  s.todayMessageIcon || '📢');
    setText('banner-title', s.todayMessage);
    setText('banner-sub',   s.todayMessageSub || '');
    return;
  }

  // NEW CHECK: skip entire birthday block if admin turned it off
  const birthdayEnabled = s.feature_birthdayOffer !== false;

  if (birthdayEnabled && isBday) {
    const usedDate = u.couponUsed_birthday ? new Date(u.couponUsed_birthday) : null;
    const usedToday = usedDate && usedDate.toDateString() === today.toDateString();
    if (!usedToday) {
      bannerEl.style.display = 'flex';
      setText('banner-icon',  '🎂');
      setText('banner-title', `Happy Birthday ${u.name.split(' ')[0]}! 🎉`);
      setText('banner-sub',   'FREE Roll ya Momos + 15% off — aaj sirf aapke liye!');
      return;
    }
  }

  if (birthdayEnabled && dob) {
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

  if (u.specialOffer?.active) {
    bannerEl.style.display = 'flex';
    setText('banner-icon',  '🎁');
    setText('banner-title', u.specialOffer.label || 'Special Offer!');
    setText('banner-sub',   `Sirf ${u.specialOffer.validDays || 7} din ke liye valid`);
    return;
  }

  bannerEl.style.display = 'none';
}

// ── 3d. Coupon ───────────────────────────────────────────────
//  NEW: Hide entire section if feature_welcomeDiscount === false
export function renderCoupon(u, s) {
  const wrapEl = document.getElementById('coupon-wrap-sec');

  // NEW CHECK: admin toggle for Welcome Discount
  if (s.feature_welcomeDiscount === false) {
    if (wrapEl) wrapEl.style.display = 'none';
    return;
  }

  if (u.couponUsed_welcome) {
    if (wrapEl) wrapEl.style.display = 'none';
    return;
  }
  if (wrapEl) wrapEl.style.display = 'block';

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
//  NEW: Hide entire section if feature_visitStreak === false
export function renderStreak(u, s) {
  const cardEl = document.querySelector('.streak-card');
  const secLbl = document.getElementById('streak-sec-lbl');

  // NEW CHECK: admin toggle for Visit Streak
  if (s.feature_visitStreak === false) {
    if (cardEl) cardEl.style.display = 'none';
    if (secLbl) secLbl.style.display = 'none';
    return;
  }
  if (cardEl) cardEl.style.display = 'block';
  if (secLbl) secLbl.style.display = 'flex';

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

  const bar = document.getElementById('streak-bar');
  if (bar) {
    const pct = Math.round((cycle / goal) * 100);
    bar.style.width = pct + '%';
  }

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
  if (unsubUser) { unsubUser(); unsubUser = null; }
  if (unsubSett) { unsubSett(); unsubSett = null; }

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





