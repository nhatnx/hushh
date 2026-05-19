'use client';

import { useEffect, useRef } from 'react';
import Script from 'next/script';

export default function HushhApp() {
  const appInitialized = useRef(false);

  // Called from onLoad, onError, AND the 20s fallback timer — runs init exactly once
  const initApp = () => {
    if (appInitialized.current) return;
    appInitialized.current = true;
    import('../lib/app-logic.js').then(m => m.init()).catch(console.error);
  };

  useEffect(() => {
    // Register SW immediately — independent of TF.js load
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('[App] SW registered:', reg.scope))
        .catch(err => console.warn('[App] SW registration failed:', err));
    }

    const banner = document.getElementById('installBanner');
    const btn = document.getElementById('installBtn');

    // Pick up event captured by the inline <head> script (fires before React mounts)
    let deferredPrompt: any = (window as any).__hushhInstallEvent ?? null;
    if (deferredPrompt) {
      banner?.classList.remove('hidden');
      delete (window as any).__hushhInstallEvent;
    }

    // Also listen for the event firing after mount (e.g. repeat visits)
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e;
      banner?.classList.remove('hidden');
    };

    const onInstalled = () => {
      banner?.classList.add('hidden');
      import('../lib/analytics.js').then(m => m.trackEvent('pwa_install')).catch(() => {});
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    btn?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') banner?.classList.add('hidden');
      deferredPrompt = null;
    });

    // If TF.js hasn't fired onLoad/onError within 20s (slow network, blocked CDN),
    // start the app anyway in heuristic mode
    const tfFallbackTimer = setTimeout(initApp, 20000);

    // Bug tracking: report unhandled JS errors and promise rejections to GA4
    const handleError = (event: ErrorEvent) => {
      import('../lib/analytics.js')
        .then(m => m.trackEvent('js_error', {
          error_message: (event.message ?? '').slice(0, 200),
          source: event.filename,
          lineno: event.lineno,
        }))
        .catch(() => {});
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = String(event.reason?.message ?? event.reason ?? 'unknown').slice(0, 200);
      import('../lib/analytics.js')
        .then(m => m.trackEvent('js_error', { error_message: msg, type: 'unhandled_rejection' }))
        .catch(() => {});
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      clearTimeout(tfFallbackTimer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return (
    <>
      {/* TF.js loads async; onLoad triggers app init. onError handles CDN failure gracefully. */}
      <Script
        src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js"
        integrity="sha384-R4iglwC8w7UAyfRq7VUmXEPjrvYnoXIqhsbTUN07o6o8yKYeiTY0/Z6DzbsKgWZ3"
        crossOrigin="anonymous"
        strategy="afterInteractive"
        onLoad={() => initApp()}
        onError={() => initApp()}
      />

      <main className="app-shell" role="main">
        <h1 className="sr-only">Hushh — on-device AI baby cry analyzer</h1>

        {/* Header */}
        <header className="app-header">
          <div className="header-controls">
            <button className="lang-toggle" id="langToggle" type="button" aria-label="Switch language">VI</button>
            <button className="theme-toggle" id="themeToggle" type="button" aria-label="Toggle color theme">🌓</button>
          </div>
          <div className="app-logo" aria-hidden="true">🍼</div>
          <h1 className="app-title">Hushh</h1>
          <p className="app-tagline" data-i18n="tagline">Understand what your little one needs</p>
          <span className="privacy-pill" id="privacyBadge" aria-label="Privacy guarantee">
            🔒 Loading…
          </span>
        </header>

        {/* PWA Install Banner */}
        <div className="install-banner hidden" id="installBanner" role="complementary" aria-label="Install app">
          <span className="banner-icon" aria-hidden="true">📲</span>
          <div className="banner-text">
            <strong className="banner-title" data-i18n="install.title">Add to Home Screen</strong>
            <span className="banner-sub" data-i18n="install.sub">Works offline · instant access</span>
          </div>
          <button className="btn-install" id="installBtn" type="button" data-i18n="install.btn">Install</button>
        </div>

        {/* Model status */}
        <div className="model-badge" id="modelBadge" data-status="loading" role="status" aria-live="polite">
          ⏳ Loading on-device model…
        </div>

        {/* Record Card */}
        <section className="record-card" aria-label="Audio recording">
          <button className="record-btn" id="recordBtn" type="button" aria-label="Record baby cry" aria-pressed="false">
            <span className="mic-icon" aria-hidden="true" id="micIcon">🎙</span>
            <span className="record-btn-label" id="recordBtnLabel">Record cry</span>
          </button>
          <p className="record-hint" id="recordHint">
            Tap the button and hold your phone near the baby
          </p>
          <div className="timer-display" id="timerDisplay" role="timer" aria-live="polite"></div>
          <div className="wave-section hidden" id="waveSection" aria-hidden="true">
            <div className="wave-wrap">
              <canvas id="waveCanvas" aria-label="Audio waveform"></canvas>
            </div>
          </div>
          <p className="audio-ready-msg hidden" id="audioReadyMsg" role="status" aria-live="polite"></p>
        </section>

        {/* Upload Alternative */}
        <div className="or-divider" aria-hidden="true" data-i18n="or">or</div>

        <button className="upload-btn" id="uploadTrigger" type="button" aria-label="Upload audio file">
          <span aria-hidden="true">📁</span>
          <span data-i18n="upload.btn">Upload audio file (.wav · .mp3 · .m4a · .webm)</span>
        </button>
        <input type="file" id="fileInput" accept="audio/*" style={{ display: 'none' }} aria-label="Audio file input" />

        {/* Processing status */}
        <p className="processing-step" id="processingStep" role="status" aria-live="polite"></p>

        {/* Analyze Button */}
        <button className="analyze-btn" id="analyzeBtn" type="button" disabled aria-label="Analyze baby cry">
          🔍 Analyze cry
        </button>

        {/* Result */}
        <section className="result-section hidden" id="resultSection" aria-label="Analysis results" aria-live="polite">
        </section>

        {/* Session stats */}
        <p className="session-count hidden" id="sessionCount"></p>

        {/* History */}
        <section className="history-section hidden" id="historySection" aria-label="Recent sessions">
          <div className="history-header">
            <span className="section-title" data-i18n="history.title">Recent sessions</span>
            <button className="btn-clear" id="clearHistoryBtn" type="button" data-i18n="history.clear">Clear</button>
          </div>
          <div className="history-list" id="historyList"></div>
        </section>
      </main>
    </>
  );
}
