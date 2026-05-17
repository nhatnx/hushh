'use client';

import Script from 'next/script';

export default function HushhApp() {
  return (
    <>
      {/* TF.js loads async; onLoad triggers app init ensuring window.tf is ready */}
      <Script
        src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js"
        integrity="sha384-R4iglwC8w7UAyfRq7VUmXEPjrvYnoXIqhsbTUN07o6o8yKYeiTY0/Z6DzbsKgWZ3"
        crossOrigin="anonymous"
        strategy="afterInteractive"
        onLoad={() => {
          import('../lib/app-logic.js').then(m => m.init()).catch(console.error);
        }}
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
