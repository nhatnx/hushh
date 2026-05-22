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

      // Reload when a new SW activates (SW_UPDATED is sent only on updates, not first install)
      navigator.serviceWorker.addEventListener('message', ({ data }) => {
        if (data?.type === 'SW_UPDATED') window.location.reload();
      });
    }

    const banner = document.getElementById('installBanner');
    const btn = document.getElementById('installBtn');

    // iOS never fires beforeinstallprompt — detect and show banner manually.
    // iPadOS 13+ reports as "Macintosh" by default, so check maxTouchPoints too.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    const isStandalone = (navigator as any).standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;

    // Pick up event captured by the inline <head> script (fires before React mounts)
    let deferredPrompt: any = (window as any).__hushhInstallEvent ?? null;
    if (deferredPrompt) {
      banner?.classList.remove('hidden');
      delete (window as any).__hushhInstallEvent;
    } else if (isIOS && !isStandalone) {
      // On iOS Safari: show banner immediately (no programmatic prompt available)
      banner?.classList.remove('hidden');
    }

    // Also listen for the event firing after mount (e.g. repeat visits, Android Chrome)
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

    // iOS modal helpers
    const iosModal = document.getElementById('iosInstallModal');
    const openModal  = () => iosModal?.classList.remove('hidden');
    const closeModal = () => iosModal?.classList.add('hidden');

    document.getElementById('iosModalClose')?.addEventListener('click', closeModal);
    document.getElementById('iosModalGotIt')?.addEventListener('click', closeModal);
    // Close on overlay tap (but not on the card itself)
    iosModal?.addEventListener('click', (e) => {
      if (e.target === iosModal) closeModal();
    });

    // Disclaimer modal
    const disclaimerModal = document.getElementById('disclaimerModal');
    const openDisclaimer  = () => disclaimerModal?.classList.remove('hidden');
    const closeDisclaimer = () => disclaimerModal?.classList.add('hidden');
    document.getElementById('disclaimerBtn')?.addEventListener('click', openDisclaimer);
    document.getElementById('disclaimerModalClose')?.addEventListener('click', closeDisclaimer);
    document.getElementById('disclaimerModalGotIt')?.addEventListener('click', closeDisclaimer);
    disclaimerModal?.addEventListener('click', (e) => {
      if (e.target === disclaimerModal) closeDisclaimer();
    });

    btn?.addEventListener('click', async () => {
      if (isIOS) {
        openModal();
        return;
      }
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
          <h1 className="app-title">Hushh <span className="beta-badge">Beta</span></h1>
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
        <input type="file" id="fileInput" accept=".m4a,.mp3,.wav,.webm,.ogg,.aac,.flac,audio/*,video/mp4" style={{ display: 'none' }} aria-label="Audio file input" />

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

        {/* Cloud model sync — rendered but hidden; app-logic shows it only when Firebase env vars are baked in */}
        <section className="cloud-sync-card hidden" id="cloudSyncCard" aria-label="Community model sync">
          <div className="cloud-sync-header">
            <div className="cloud-sync-icon" aria-hidden="true">🌐</div>
            <div className="cloud-sync-title-group">
              <h3 className="cloud-sync-title" data-i18n="cloud.title">Community Model</h3>
              <span className="cloud-sync-count hidden" id="cloudContribCount"></span>
            </div>
            <label className="toggle-switch" id="cloudSyncLabel" aria-label="Share my trained model">
              <input type="checkbox" id="cloudSyncToggle" />
              <span className="toggle-thumb" aria-hidden="true"></span>
            </label>
          </div>
          <p className="cloud-sync-desc" data-i18n="cloud.desc">
            Share your trained model to help other parents. Your audio is never uploaded — only model weights.
          </p>
          <div className="cloud-sync-status hidden" id="cloudSyncStatus">
            <span id="cloudSyncStatusText"></span>
          </div>
        </section>

        {/* Medical disclaimer footer link */}
        <button className="disclaimer-link" id="disclaimerBtn" type="button">
          ⚕️ Medical disclaimer
        </button>
      </main>

      {/* iOS install instructions modal — visible only when triggered on iOS Safari */}
      <div
        className="ios-modal-overlay hidden"
        id="iosInstallModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="iosModalTitle"
      >
        <div className="ios-modal">
          <div className="ios-modal-header">
            <h2 className="ios-modal-title" id="iosModalTitle" data-i18n="ios.modal.title">Install App on iOS</h2>
            <button className="ios-modal-close" id="iosModalClose" type="button" aria-label="Close">✕</button>
          </div>
          <div className="ios-modal-steps">
            <div className="ios-step">
              <div className="ios-step-icon ios-step-icon--dark" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                </svg>
              </div>
              <div className="ios-step-content">
                <strong data-i18n="ios.step1.title">Step 1: Tap Share</strong>
                <span data-i18n="ios.step1.desc">Tap the Share button at the bottom of your browser.</span>
              </div>
            </div>
            <div className="ios-step">
              <div className="ios-step-icon ios-step-icon--green" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
              <div className="ios-step-content">
                <strong data-i18n="ios.step2.title">Step 2: Add to Home Screen</strong>
                <span data-i18n="ios.step2.desc">Scroll down and tap "Add to Home Screen".</span>
              </div>
            </div>
            <div className="ios-step">
              <div className="ios-step-icon ios-step-icon--orange" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div className="ios-step-content">
                <strong data-i18n="ios.step3.title">Step 3: Tap Add</strong>
                <span data-i18n="ios.step3.desc">Tap "Add" in the top right corner to confirm.</span>
              </div>
            </div>
          </div>
          <button className="ios-modal-btn" id="iosModalGotIt" type="button" data-i18n="ios.modal.got-it">Got it!</button>
        </div>
      </div>

      {/* Medical disclaimer modal */}
      <div
        className="ios-modal-overlay hidden"
        id="disclaimerModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disclaimerModalTitle"
      >
        <div className="ios-modal">
          <div className="ios-modal-header">
            <h2 className="ios-modal-title" id="disclaimerModalTitle">⚕️ Medical Disclaimer</h2>
            <button className="ios-modal-close" id="disclaimerModalClose" type="button" aria-label="Close">✕</button>
          </div>
          <div className="disclaimer-body">
            <p>This app is an <strong>assistive tool only</strong> and is not a medical device. It uses acoustic heuristics and should not replace parental judgment or medical advice.</p>
            <p>If your baby:</p>
            <ul>
              <li>Cries for more than 3 hours/day</li>
              <li>Has a fever above 38°C / 100.4°F</li>
              <li>Appears to be in severe pain</li>
              <li>Has any other concerning symptoms</li>
            </ul>
            <p className="disclaimer-urgent">Please contact a pediatrician or healthcare provider immediately.</p>
          </div>
          <button className="ios-modal-btn" id="disclaimerModalGotIt" type="button">Got it</button>
        </div>
      </div>
    </>
  );
}
