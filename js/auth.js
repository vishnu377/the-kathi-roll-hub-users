// ============================================================
//  customer/js/auth.js  —  Firebase-FIRST version
//  registerUser → Firestore setDoc
//  loginUser    → Firestore getDoc
//  userExists   → Firestore getDoc
//  LocalStorage: cache + offline fallback
// ============================================================

import { LS, POINTS, COLLECTIONS, DEFAULTS } from '../../shared/constants.js';

// ── Firebase ─────────────────────────────────────────────────
let db, docFn, setDocFn, getDocFn, updateDocFn, FIREBASE_READY = false;

async function initFirebase() {
  try {
    const cfg  = await import('../../shared/firebase-config.js');
    db          = cfg.db;
    docFn       = cfg.doc;
    setDocFn    = cfg.setDoc;
    getDocFn    = cfg.getDoc;
    updateDocFn = cfg.updateDoc;
    FIREBASE_READY = true;
  } catch (e) {
    FIREBASE_READY = false;
    console.warn('[auth.js] Firebase offline — LocalStorage fallback', e.message);
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
  const user = {
    ...userData,
    mobile,
    points:      200,
    visits:      0,
    saved:       0,
    referrals:   0,
    socialDone:  {},
    socialPending: {},
    joined:      new Date().toISOString(),
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

