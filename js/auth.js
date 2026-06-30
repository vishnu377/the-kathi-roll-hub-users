// ============================================================
//  customer/js/auth.js  —  Firebase-FIRST version
//  registerUser → Firestore setDoc
//  loginUser    → Firestore getDoc
//  userExists   → Firestore getDoc
//  LocalStorage: cache + offline fallback
// ============================================================

import { LS, POINTS, COLLECTIONS, DEFAULTS } from '../shared/constants.js';

// ── Firebase ─────────────────────────────────────────────────
let db, docFn, setDocFn, getDocFn, updateDocFn, FIREBASE_READY = false;

// NEW: Anonymous Auth state — lets Firestore Security Rules
// distinguish "request came from our app" vs random outside calls.
// This is invisible to the customer — no extra screen, no extra click.
let authFn, signInAnonymouslyFn;

async function initFirebase() {
  try {
    const cfg  = await import('../shared/firebase-config.js');
    db          = cfg.db;
    docFn       = cfg.doc;
    setDocFn    = cfg.setDoc;
    getDocFn    = cfg.getDoc;
    updateDocFn = cfg.updateDoc;
    FIREBASE_READY = true;

    // NEW: silently sign in anonymously (best-effort — if this
    // fails for any reason, the app still works exactly as before
    // since we never gate any existing function on this succeeding).
    await ensureAnonymousAuth(cfg);
  } catch (e) {
    FIREBASE_READY = false;
    console.warn('[auth.js] Firebase offline — LocalStorage fallback', e.message);
  }
}

// NEW: best-effort, non-blocking anonymous sign-in
async function ensureAnonymousAuth(cfg) {
  try {
    const authModule = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    authFn = cfg.auth;
    signInAnonymouslyFn = authModule.signInAnonymously;

    // Only sign in if not already signed in (avoids duplicate calls
    // on hot-reload / multiple initFirebase invocations)
    if (authFn && !authFn.currentUser) {
      await signInAnonymouslyFn(authFn);
      console.log('[auth.js] Anonymous auth ready ✅');
    }
  } catch (e) {
    // Non-fatal — app continues working as before even if this fails
    console.warn('[auth.js] Anonymous auth failed (non-fatal):', e.message);
  }
}

// Auto-init on module load
const _ready = initFirebase();

// ============================================================
//  registerUser(userData)
//  1. Duplicate check (Firestore first)
//  2. setDoc → Firestore (COLLECTIONS.users / mobile as docId)
//  3. Cache to LocalStorage
//  4. Set session
// ============================================================
export async function registerUser(userData) {
  await _ready;
  const { mobile } = userData;

  // ── 1. Duplicate check ──────────────────────────────────
  const exists = await userExists(mobile);
  if (exists) {
    return {
      success: false,
      message: 'Yeh number pehle se registered hai. Login karein.',
    };
  }

  // ── 2. Build full user object ───────────────────────────
  const joinSource = sessionStorage.getItem('krh_src') || 'direct';
  let welcomePts = 200;
  if (FIREBASE_READY) {
    try {
      const cfgSnap = await getDocFn(docFn(db, COLLECTIONS.settings, 'config'));
      if (cfgSnap.exists()) {
        const cfgData = cfgSnap.data();
        welcomePts = cfgData.defaultWelcomePts || 200;
        localStorage.setItem(LS.settings, JSON.stringify(cfgData)); // cache for later
      }
    } catch (e) {
      console.warn('[registerUser] settings fetch failed, using default:', e.message);
    }
  }
  if (welcomePts === 200) {
    // Fallback to any locally cached settings if Firestore fetch above didn't run/find data
    const s = JSON.parse(localStorage.getItem(LS.settings) || '{}');
    welcomePts = s.defaultWelcomePts || welcomePts;
  }
  const user = {
    ...userData,
    mobile,
    points:      welcomePts,
    visits:      0,
    saved:       0,
    referrals:   0,
    socialDone:  {},
    socialPending: {},
    joined:      new Date().toISOString(),
    joinSource:  joinSource,   // 'qr', 'direct', etc — tracks how customer found us
    dashVisited: false,
  };

  // ── 3. ALWAYS save to LocalStorage first (guaranteed) ───
  const users = _lsGetUsers();
  users.push(user);
  _lsSetUsers(users);
  localStorage.setItem(LS.current, mobile);

  // ── 4. Also save to Firestore (best effort) ───────────
  if (FIREBASE_READY) {
    try {
      await setDocFn(docFn(db, COLLECTIONS.users, mobile), user);
    } catch (err) {
      console.warn('[registerUser] Firestore save failed (LS saved):', err.message);
      // Not a fatal error — LS is already saved
    }
  }

  return { success: true, user };
}

// ============================================================
//  loginUser(mobile, dob)
//  1. Firestore getDoc → DOB match check
//  2. LocalStorage fallback
//  3. Set session + sync LS
// ============================================================
export async function loginUser(mobile, dob) {
  await _ready;

  // ── 1. Firestore check ───────────────────────────────────
  if (FIREBASE_READY) {
    try {
      const snap = await getDocFn(docFn(db, COLLECTIONS.users, mobile));

      if (snap.exists()) {
        const fbUser = snap.data();

        // DOB match
        if (fbUser.dob !== dob) {
          return {
            success: false,
            message: '❌ DOB match nahi hua. Sahi date dalein.',
          };
        }

        // Sync to LS (refresh local cache)
        _syncUserToLS(fbUser);
        localStorage.setItem(LS.current, mobile);
        return { success: true, user: fbUser };
      }

      // Mobile registered nahi hai
      return {
        success: false,
        message: '❌ Yeh number registered nahi hai. Pehle register karein.',
      };

    } catch (e) {
      console.warn('[loginUser] Firestore failed, trying LS:', e.message);
      // Fall through to LocalStorage
    }
  }

  // ── 2. LocalStorage fallback ─────────────────────────────
  const users = _lsGetUsers();
  const user  = users.find(u => u.mobile === mobile && u.dob === dob);

  if (user) {
    localStorage.setItem(LS.current, mobile);
    return { success: true, user };
  }

  return {
    success: false,
    message: '❌ Details match nahi hui. Sahi DOB dalein.',
  };
}

// ============================================================
//  NEW: PIN + OTP based auth (added alongside old DOB login —
//  old loginUser() above is left untouched for safe rollback)
// ============================================================

// ── Send OTP via backend (Vercel function → Fast2SMS) ────────
export async function sendOtpToMobile(mobile) {
  try {
    const res = await fetch('/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile }),
    });
    const data = await res.json();
    return data;
  } catch (e) {
    return { success: false, message: 'Network error: ' + e.message };
  }
}

// ── Verify OTP via backend ────────────────────────────────────
export async function verifyOtpCode(mobile, otp) {
  try {
    const res = await fetch('/api/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, otp }),
    });
    const data = await res.json();
    return data;
  } catch (e) {
    return { success: false, message: 'Network error: ' + e.message };
  }
}

// ── Check if a customer already has a PIN set ─────────────────
export async function hasPinSet(mobile) {
  await _ready;
  if (FIREBASE_READY) {
    try {
      const snap = await getDocFn(docFn(db, COLLECTIONS.users, mobile));
      if (snap.exists()) {
        return !!snap.data().pin;
      }
      return false;
    } catch (e) {
      console.warn('[hasPinSet] Firestore failed:', e.message);
    }
  }
  const users = _lsGetUsers();
  const user = users.find(u => u.mobile === mobile);
  return !!(user && user.pin);
}

// ── Set/update a customer's 4-digit PIN ───────────────────────
export async function setUserPin(mobile, pin) {
  await _ready;
  if (!/^\d{4}$/.test(pin)) {
    return { success: false, message: 'PIN exactly 4 digit ka number hona chahiye' };
  }

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, COLLECTIONS.users, mobile), { pin });
      const users = _lsGetUsers();
      const idx = users.findIndex(u => u.mobile === mobile);
      if (idx !== -1) { users[idx].pin = pin; _lsSetUsers(users); }
      return { success: true };
    } catch (e) {
      return { success: false, message: 'Save failed: ' + e.message };
    }
  }

  const users = _lsGetUsers();
  const idx = users.findIndex(u => u.mobile === mobile);
  if (idx !== -1) { users[idx].pin = pin; _lsSetUsers(users); return { success: true }; }
  return { success: false, message: 'User not found' };
}

// ── Login with mobile + PIN (no OTP cost for returning users) ─
export async function loginWithPin(mobile, pin) {
  await _ready;

  if (FIREBASE_READY) {
    try {
      const snap = await getDocFn(docFn(db, COLLECTIONS.users, mobile));
      if (!snap.exists()) {
        return { success: false, message: '❌ Yeh number registered nahi hai.' };
      }
      const fbUser = snap.data();
      if (!fbUser.pin) {
        return { success: false, message: 'PIN set nahi hai. Pehle set karein.', needsPinSetup: true };
      }
      if (fbUser.pin !== pin) {
        return { success: false, message: '❌ Galat PIN. Dobara try karein.' };
      }
      _syncUserToLS(fbUser);
      localStorage.setItem(LS.current, mobile);
      return { success: true, user: fbUser };
    } catch (e) {
      console.warn('[loginWithPin] Firestore failed, trying LS:', e.message);
    }
  }

  const users = _lsGetUsers();
  const user = users.find(u => u.mobile === mobile);
  if (!user) return { success: false, message: '❌ Yeh number registered nahi hai.' };
  if (!user.pin) return { success: false, message: 'PIN set nahi hai. Pehle set karein.', needsPinSetup: true };
  if (user.pin !== pin) return { success: false, message: '❌ Galat PIN.' };

  localStorage.setItem(LS.current, mobile);
  return { success: true, user };
}

// ============================================================
//  userExists(mobile)
//  Firestore mein document exist karta hai check karo
// ============================================================
export async function userExists(mobile) {
  await _ready;

  if (FIREBASE_READY) {
    try {
      const snap = await getDocFn(docFn(db, COLLECTIONS.users, mobile));
      return snap.exists();
    } catch (e) {
      console.warn('[userExists] Firestore failed:', e.message);
    }
  }

  // LocalStorage fallback
  return !!_lsGetUsers().find(u => u.mobile === mobile);
}

// ============================================================
//  getCurrentUser()
//  Session mobile → Firestore se fresh data fetch
// ============================================================
export async function getCurrentUser() {
  await _ready;
  const mobile = localStorage.getItem(LS.current);
  if (!mobile) return null;

  if (FIREBASE_READY) {
    try {
      const snap = await getDocFn(docFn(db, COLLECTIONS.users, mobile));
      if (snap.exists()) {
        const user = snap.data();
        _syncUserToLS(user);
        return user;
      }
      return null;
    } catch (e) {
      console.warn('[getCurrentUser] Firestore failed, using LS:', e.message);
    }
  }

  return _lsGetUsers().find(u => u.mobile === mobile) || null;
}

// ============================================================
//  getCurrentUserSync()
//  Synchronous version — sirf LS se (for quick checks)
// ============================================================
export function getCurrentUserSync() {
  const mobile = localStorage.getItem(LS.current);
  if (!mobile) return null;
  return _lsGetUsers().find(u => u.mobile === mobile) || null;
}

// ============================================================
//  updateUser(mobile, updates)
//  Firestore + LS dono update
// ============================================================
export async function updateUser(mobile, updates) {
  await _ready;

  if (FIREBASE_READY) {
    try {
      await updateDocFn(docFn(db, COLLECTIONS.users, mobile), updates);
    } catch (e) {
      console.warn('[updateUser] Firestore failed:', e.message);
    }
  }

  // LocalStorage sync
  const users = _lsGetUsers();
  const idx   = users.findIndex(u => u.mobile === mobile);
  if (idx !== -1) {
    users[idx] = { ...users[idx], ...updates };
    _lsSetUsers(users);
    return { success: true, user: users[idx] };
  }

  return { success: false, message: 'User not found in local cache' };
}

// ============================================================
//  logoutUser()
// ============================================================
export function logoutUser() {
  localStorage.removeItem(LS.current);
}

// ============================================================
//  generateCouponCode()
// ============================================================
export function generateCouponCode(mobile, type = 'welcome') {
  const suffix = mobile.slice(-4).toUpperCase();
  const year   = new Date().getFullYear();
  const prefixes = { welcome:'ROLL', birthday:'BDAY', visit:'VIS', special:'SPEC' };
  const prefix   = prefixes[type] || 'KRH';
  return type === 'birthday' ? `${prefix}${suffix}${year}` : `${prefix}${suffix}`;
}

// ============================================================
//  verifyCoupon()
// ============================================================
export function verifyCoupon(code, user) {
  const mobile  = user.mobile;
  const today   = new Date();
  const dob     = user.dob ? new Date(user.dob) : null;
  const isBday  = dob && dob.getDate()===today.getDate() && dob.getMonth()===today.getMonth();

  if (code === generateCouponCode(mobile,'welcome'))
    return { valid:true, type:'welcome',  discount:10, label:'Welcome 10% OFF' };

  if (code === generateCouponCode(mobile,'birthday') && isBday)
    return { valid:true, type:'birthday', discount:15, label:'Birthday 15% OFF + FREE item' };

  if (code === generateCouponCode(mobile,'visit'))
    return { valid:true, type:'visit',    discount:0,  label:'Visit Milestone Reward' };

  if (user.specialOffer?.active && code === generateCouponCode(mobile,'special'))
    return { valid:true, type:'special', discount:user.specialOffer.discount||0, label:user.specialOffer.label };

  return { valid:false, message:'❌ Invalid coupon code.' };
}

// ============================================================
//  PRIVATE HELPERS
// ============================================================
function _lsGetUsers() {
  return JSON.parse(localStorage.getItem(LS.users) || '[]');
}

function _lsSetUsers(users) {
  localStorage.setItem(LS.users, JSON.stringify(users));
}

function _syncUserToLS(user) {
  const users = _lsGetUsers();
  const idx   = users.findIndex(u => u.mobile === user.mobile);
  if (idx !== -1) users[idx] = user;
  else users.push(user);
  _lsSetUsers(users);
}

