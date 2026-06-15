// ============================================================
//  shared/constants.js
//  Naye shop ke liye SIRF YEH FILE BADLO
//  Admin aur Customer dono yahan se import karte hain
// ============================================================

export const SHOP = {
  id:           "kathi-roll-hub",
  name:         "The Kathi Roll Hub",
  tagline:      "The Real Taste of Kathi Roll",
  location:     "Murlipura, Jaipur",
  logoEmoji:    "🌯",
  primaryColor: "#FFD600",
  accentColor:  "#E5222A",

  whatsapp:     "919876543210",
  instagram:    "@the_kathi_roll_hub",
  zomato:       "https://zomato.com/YOUR_LINK",
  googleReview: "https://g.page/r/YOUR_REVIEW_LINK/review",
};

// ── ADMIN ──────────────────────────────────────────────────
export const ADMIN = {
  defaultPassword: "krh2025",
};

// ── POINTS CONFIG ───────────────────────────────────────────
export const POINTS = {
  welcome:       200,
  perVisit:      5,
  instagram:     25,
  googleReview:  30,
  whatsapp:      20,
  zomato:        20,
};

// ── OFFER DEFAULTS ──────────────────────────────────────────
export const DEFAULTS = {
  welcomeDiscPct:  10,
  visitGoal:       5,
  visitReward:     "FREE Roll ya Momos",
  refSteps:        [50, 120, 200],
  winbackDays:     30,
  lowStockAlert:   5,
  billPointsMsg:   true,
};

// ── COUPON PREFIXES ─────────────────────────────────────────
export const COUPON = {
  welcome:  "ROLL",
  birthday: "BDAY",
  visit:    "VIS",
  special:  "SPEC",
};

// ── MENU CATEGORIES ─────────────────────────────────────────
export const CATEGORIES = [
  "Kathi Roll",
  "Momos",
  "Chinese",
  "Shake",
  "Coffee",
  "Snacks",
  "Dessert",
  "Other",
];

// ── FIRESTORE COLLECTION NAMES ──────────────────────────────
export const COLLECTIONS = {
  users:    "users",
  bills:    "bills",
  menu:     "menu",
  settings: "settings",
  shop:     "shop",
  feedback: "feedback",
};

// ── LOCALSTORAGE KEYS (offline fallback) ────────────────────
export const LS = {
  users:    "krh_users",
  bills:    "krh_bills",
  menu:     "krh_menu",
  settings: "krh_settings",
  shop:     "krh_shop",
  feedback: "krh_feedback",
  theme:    "krh_theme",
  adminPw:  "krh_admin_pass",
  current:  "krh_current",
};