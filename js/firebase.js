// ============================================================
//  customer/js/firebase.js
//  Customer side ka Firebase connection point
//  shared/firebase-config.js se db aur auth re-export karta hai
//
//  Usage in any customer page:
//    import { db, auth, SHOP_ID } from './firebase.js';
// ============================================================

export {
  db,
  auth,
  SHOP_ID,

  // Firestore functions — jo customer side mein chahiye
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
} from '../../shared/firebase-config.js';