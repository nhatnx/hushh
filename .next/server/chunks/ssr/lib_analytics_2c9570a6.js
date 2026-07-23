module.exports = [
"[project]/lib/analytics.js [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* =========================================================
   analytics.js — Hushh
   Google Analytics 4 + Facebook Pixel
   Replace the placeholder IDs below with your real ones.
   ========================================================= */ // ── Replace these before deploying ──────────────────────────
__turbopack_context__.s([
    "trackEvent",
    ()=>trackEvent
]);
const GA_ID = 'G-QJLTN9KP54';
// const FB_PIXEL_ID = 'XXXXXXXXXXXXXXXXXX';
// ────────────────────────────────────────────────────────────
/* ---- Google Analytics 4 --------------------------------- */ window.dataLayer = window.dataLayer || [];
function gtag() {
    window.dataLayer.push(arguments);
}
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
function trackEvent(name, params = {}) {
    try {
        gtag('event', name, params);
    } catch  {}
} /**
 * Send a Facebook Pixel standard or custom event.
 * Safe to call even when FB is blocked.
 */  // export function trackFBEvent(name, params = {}) {
 //   try { window.fbq('track', name, params); } catch { /* ad blocker */ }
 // }
}),
];

//# sourceMappingURL=lib_analytics_2c9570a6.js.map