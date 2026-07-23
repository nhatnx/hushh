/* =========================================================
   analytics.js — Hushh
   Google Analytics 4 + Facebook Pixel
   Replace the placeholder IDs below with your real ones.
   ========================================================= */

// ── Replace these before deploying ──────────────────────────
const GA_ID       = 'G-XXXXXXXXXX';
const FB_PIXEL_ID = 'XXXXXXXXXXXXXXXXXX';
// ────────────────────────────────────────────────────────────

/* ---- Google Analytics 4 --------------------------------- */
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', GA_ID, {
  send_page_view: true,
  // Baby cry audio never leaves the device, but we still
  // redact any accidental PII from analytics payloads.
  redact_device_info: true
});

const gaScript = document.createElement('script');
gaScript.async = true;
gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
document.head.appendChild(gaScript);

/* ---- Facebook Pixel ------------------------------------- */
(function (f, b, e, v) {
  if (f.fbq) return;
  const n = f.fbq = function () {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = n;
  n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
  const s = b.createElement(e);
  s.async = true; s.src = v;
  document.head.appendChild(s);
}(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js'));

window.fbq('init', FB_PIXEL_ID);
window.fbq('track', 'PageView');

/* ---- Public API ----------------------------------------- */

/**
 * Send a GA4 custom event.
 * Safe to call even when GA is blocked — errors are swallowed.
 */
export function trackEvent(name, params = {}) {
  try { gtag('event', name, params); } catch { /* ad blocker */ }
}

/**
 * Send a Facebook Pixel standard or custom event.
 * Safe to call even when FB is blocked.
 */
export function trackFBEvent(name, params = {}) {
  try { window.fbq('track', name, params); } catch { /* ad blocker */ }
}
