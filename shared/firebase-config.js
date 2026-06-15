

















// ============================================================
//  shared/firebase-config.js
//  Kathi Roll Hub - Firebase Connection File
// ============================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCErNYguHO8s4m5aeyGRQvM_PWV_9IzJKs",
  authDomain: "the-kathi-roll-hub.firebaseapp.com",
  projectId: "the-kathi-roll-hub",
  storageBucket: "the-kathi-roll-hub.firebasestorage.app",
  messagingSenderId: "684649816270",
  appId: "1:684649816270:web:73dc4606b754702f6a309f",
  measurementId: "G-NBTTCE099E"
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