

















// ============================================================
//  shared/firebase-config.js
//  Kathi Roll Hub - Firebase Connection File
// ============================================================






const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBV3V-jbrORXVrT5Ivlqnk77rCN1qQtrBc",
  authDomain: "vishtech-demo.firebaseapp.com",
  projectId: "vishtech-demo",
  storageBucket: "vishtech-demo.firebasestorage.app",
  messagingSenderId: "51380510759",
  appId: "1:51380510759:web:cde39db065ef20cfd6ee02"
};

// ── Firebase SDK Imports ──────────────────────────────────────
import { initializeApp } 
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  increment,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { getAuth } 
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ── Initialize Firebase ────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
export const db   = getFirestore(app);
export const auth = getAuth(app);

// ── Re-export for Admin & Customer Logic ───────────────────────
export {
  collection, doc,
  getDoc, getDocs,
  setDoc, addDoc,
  updateDoc, deleteDoc,
  query, where, orderBy,
  onSnapshot,
  increment,
  serverTimestamp
};

// Tumhari Shop ki ID (Database entries ke liye)
export const SHOP_ID = "the-kathi-roll-hub";