// ============================================================
//  customer/js/utils.js
//  Customer side helpers — Toast, Clipboard, Formatting
// ============================================================

// ============================================================
//  showToast(msg, type, duration)
//  Yellow/Black theme — customer pages ke liye
//
//  type: 'success' | 'error' | 'info' | 'warn'
//
//  Usage:
//    showToast('Registration ho gayi! 🎉');
//    showToast('Mobile number galat hai', 'error');
// ============================================================
export function showToast(msg, type = 'success', duration = 3000) {

  // ── Remove existing toast if any ──────────────────────
  const existing = document.getElementById('_cust_toast');
  if (existing) existing.remove();

  // ── Style config ──────────────────────────────────────
  const config = {
    success: { bg: '#1a1a1a', border: '#FFD600', icon: '✅', color: '#fff'   },
    error:   { bg: '#1a1a1a', border: '#ef4444', icon: '❌', color: '#fca5a5' },
    info:    { bg: '#1a1a1a', border: '#FFD600', icon: 'ℹ️',  color: '#fef9c3' },
    warn:    { bg: '#1a1a1a', border: '#f97316', icon: '⚠️', color: '#fed7aa' },
  };
  const c = config[type] || config.success;

  // ── Build toast ───────────────────────────────────────
  const toast = document.createElement('div');
  toast.id    = '_cust_toast';
  toast.style.cssText = [
    'position:fixed',
    'bottom:28px',
    'left:50%',
    'transform:translateX(-50%) translateY(12px)',
    'background:' + c.bg,
    'color:' + c.color,
    'border:2px solid ' + c.border,
    'border-radius:99px',
    'padding:12px 22px',
    'font-family:Inter,sans-serif',
    'font-size:14px',
    'font-weight:700',
    'display:flex',
    'align-items:center',
    'gap:9px',
    'z-index:9999',
    'box-shadow:0 8px 24px rgba(0,0,0,.35)',
    'opacity:0',
    'transition:opacity .25s ease,transform .25s ease',
    'white-space:nowrap',
    'max-width:90vw',
    'pointer-events:none',
  ].join(';');

  toast.innerHTML =
    '<span style="font-size:16px">' + c.icon + '</span>' +
    '<span>' + msg + '</span>';

  document.body.appendChild(toast);

  // ── Animate in ────────────────────────────────────────
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity   = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
  });

  // ── Animate out ───────────────────────────────────────
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateX(-50%) translateY(12px)';
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 280);
  }, duration);
}

// ============================================================
//  copyToClipboard(text, successMsg?)
//  Dashboard par coupon code copy karne ke liye
//  Yellow flash feedback + toast
//
//  Usage:
//    copyToClipboard('ROLL5432');
//    copyToClipboard('ROLL5432', 'Coupon copy ho gaya!');
// ============================================================
export async function copyToClipboard(text, successMsg) {
  const msg = successMsg || '📋 "' + text + '" copy ho gaya!';

  try {
    await navigator.clipboard.writeText(text);
    showToast(msg, 'success', 2200);
    return true;
  } catch (e) {
    // Fallback for older browsers / non-HTTPS
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast(msg, 'success', 2200);
      return true;
    } catch (e2) {
      showToast('Manually copy karo: ' + text, 'warn', 4000);
      return false;
    }
  }
}

// ============================================================
//  formatPoints(pts)
//  Points ko readable format mein dikhao
//
//  formatPoints(150)   → "150 pts"
//  formatPoints(1200)  → "1,200 pts"
//  formatPoints(0)     → "0 pts"
// ============================================================
export function formatPoints(pts) {
  const n = parseInt(pts) || 0;
  return n.toLocaleString('en-IN') + ' pts';
}

// ============================================================
//  formatCurrency(amt)
//  ₹ ke saath amount format
//  formatCurrency(90)    → "₹90"
//  formatCurrency(1200)  → "₹1,200"
// ============================================================
export function formatCurrency(amt) {
  const n = parseFloat(amt) || 0;
  return '₹' + n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// ============================================================
//  formatDate(date)
//  "15 Jun 2026" format
// ============================================================
export function formatDate(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ============================================================
//  daysSince(dateStr)
//  Kitne din pehle tha
// ============================================================
export function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

// ============================================================
//  debounce(fn, delay)
//  Search/input throttle ke liye
// ============================================================
export function debounce(fn, delay = 400) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}