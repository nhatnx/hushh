/* =========================================================
   app.js — Hushh
   Main application controller. All audio processing and
   inference happens entirely on-device via Web Audio API
   and TensorFlow.js. No data is sent to any server.
   ========================================================= */

import { AudioAnalyzer } from './audio-analyzer.js';
import { classify, buildModel, NEED_META, LABELS, featuresToVector } from './cry-model.js';
const tf = window.tf; // loaded as UMD global by index.html <script> tag

/* ---- State ---- */
const state = {
  phase: 'idle',        // idle | recording | processing | result
  audioBlob: null,
  mediaRecorder: null,
  audioChunks: [],
  streamAnalyzer: null,
  recordingSeconds: 0,
  timerInterval: null,
  animFrame: null,
  model: null,
  history: JSON.parse(localStorage.getItem('babyCryHistory') || '[]'),
  deferredInstall: null,
  liveRms: new Array(60).fill(0),
  localSessions: 0,
  lossHistory: []
};

const analyzer = new AudioAnalyzer();

/* ---- Training Queue (IndexedDB) ---- */
const MIN_TRAIN_SAMPLES = 5;
let trainWorker = null;

function openTrainDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hushh-training', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('queue', { autoIncrement: true });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueSample(vector, labelIndex) {
  const db = await openTrainDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({ vector: Array.from(vector), labelIndex });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getQueueCount() {
  const db = await openTrainDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readonly');
    const req = tx.objectStore('queue').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function drainQueue() {
  const db = await openTrainDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const records = [];
    store.openCursor().onsuccess = e => {
      const c = e.target.result;
      if (c) { records.push(c.value); c.delete(); c.continue(); }
      else resolve(records);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/* ---- Feedback UI ---- */
function renderFeedback(result) {
  const el = document.createElement('div');
  el.className = 'feedback-bar';
  const uncertain = result.label === 'unknown';

  el.innerHTML = `
    <p class="fb-question">Was this reading correct?</p>
    <div class="fb-btns${uncertain ? ' hidden' : ''}">
      ${!uncertain ? '<button class="btn-fb btn-fb-yes">✓ Yes, correct</button>' : ''}
      <button class="btn-fb btn-fb-no">✗ No, wrong</button>
    </div>
    <div class="label-picker${uncertain ? '' : ' hidden'}">
      <p class="lp-prompt">${uncertain ? 'What was it?' : 'What was it actually?'}</p>
      <div class="lp-grid">${LABELS.map((lbl, i) => {
    const m = NEED_META[lbl];
    return `<button class="btn-pick" data-idx="${i}" style="--c:${m.color};--bg:${m.bgLight}">${m.icon}<span>${m.label}</span></button>`;
  }).join('')}</div>
    </div>
    <p class="fb-thanks hidden"></p>
  `;

  $('resultSection').appendChild(el);

  const btnsEl = el.querySelector('.fb-btns');
  const pickerEl = el.querySelector('.label-picker');
  const thanksEl = el.querySelector('.fb-thanks');

  const dismiss = msg => {
    btnsEl.classList.add('hidden');
    pickerEl.classList.add('hidden');
    thanksEl.textContent = msg;
    thanksEl.classList.remove('hidden');
  };

  const submit = async labelIndex => {
    el.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      await enqueueSample(featuresToVector(result.features), labelIndex);
      const count = await getQueueCount();
      dismiss(count >= MIN_TRAIN_SAMPLES
        ? `Thanks! Starting training with ${count} samples…`
        : `Saved! ${count} of ${MIN_TRAIN_SAMPLES} needed to retrain.`);
      if (count >= MIN_TRAIN_SAMPLES) checkAndTrain();
    } catch (err) {
      dismiss('Thanks! (Save failed: ' + err.message + ')');
    }
  };

  el.querySelector('.btn-fb-yes')?.addEventListener('click', () => {
    const idx = LABELS.indexOf(result.label);
    if (idx >= 0) submit(idx);
  });

  el.querySelector('.btn-fb-no')?.addEventListener('click', () => {
    pickerEl.classList.remove('hidden');
  });

  el.querySelectorAll('.btn-pick').forEach(btn =>
    btn.addEventListener('click', () => submit(+btn.dataset.idx))
  );
}

/* ---- Training Orchestration ---- */
async function checkAndTrain() {
  if (trainWorker) return;
  let records;
  try { records = await drainQueue(); } catch { return; }
  if (records.length < MIN_TRAIN_SAMPLES) return;

  showTrainingPanel();

  trainWorker = new Worker('./train-worker.js');
  trainWorker.postMessage({
    vectors: records.map(r => r.vector),
    labelIndices: records.map(r => r.labelIndex)
  });

  trainWorker.onmessage = async ({ data }) => {
    if (data.type === 'progress') {
      updateTrainingPanel(data.epoch, data.epochs, data.loss);
    } else if (data.type === 'done') {
      trainWorker.terminate(); trainWorker = null;
      finishTrainingPanel(data.success
        ? '✓ Model updated — results will improve.'
        : 'Training failed: ' + (data.error || 'unknown'));
      if (data.success) await loadTFModel();
    }
  };

  trainWorker.onerror = err => {
    trainWorker.terminate(); trainWorker = null;
    finishTrainingPanel('Worker error: ' + err.message);
  };
}

function getOrCreatePanel() {
  let p = $('trainingPanel');
  if (!p) {
    p = document.createElement('div');
    p.id = 'trainingPanel';
    p.className = 'training-panel hidden';
    p.innerHTML = `
      <div class="tp-head">
        <span class="tp-title">🧠 Training on-device…</span>
        <span class="tp-ep" id="tpEp"></span>
      </div>
      <div class="tp-track"><div class="tp-fill" id="tpFill"></div></div>
      <canvas class="tp-loss" id="tpLoss"></canvas>
      <p class="tp-status" id="tpStatus">Fitting on your feedback…</p>
    `;
    document.querySelector('.app-shell').appendChild(p);
  }
  return p;
}

function showTrainingPanel() {
  state.lossHistory = [];
  getOrCreatePanel().classList.remove('hidden');
  $('tpFill').style.width = '0%';
  $('tpStatus').textContent = 'Fitting on your feedback…';
  $('tpEp').textContent = '';
  $('trainingPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateTrainingPanel(epoch, epochs, loss) {
  $('tpEp').textContent = `Epoch ${epoch} / ${epochs}`;
  $('tpFill').style.width = `${Math.round(epoch / epochs * 100)}%`;
  state.lossHistory.push(loss);
  drawLoss();
}

function finishTrainingPanel(msg) {
  $('tpFill').style.width = '100%';
  $('tpStatus').textContent = msg;
  $('tpEp').textContent = '';
  setTimeout(() => getOrCreatePanel().classList.add('hidden'), 5000);
}

function drawLoss() {
  const canvas = $('tpLoss');
  if (!canvas || state.lossHistory.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 280, H = 40;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const losses = state.lossHistory;
  const max = Math.max(...losses), min = Math.min(...losses);
  const range = max - min || 0.001;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#d4785a'; ctx.lineWidth = 1.5; ctx.beginPath();
  losses.forEach((l, i) => {
    const x = (i / (losses.length - 1)) * W;
    const y = H - 4 - ((l - min) / range) * (H - 10);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ---- Theme ---- */
const THEME_CYCLE = ['system', 'light', 'dark'];
const THEME_ICONS  = { system: '🌓', light: '☀️', dark: '🌙' };

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('hushh-theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = THEME_ICONS[theme];
}

/* ---- DOM refs ---- */
const $ = id => document.getElementById(id);

/* ---- Boot ---- */
document.addEventListener('DOMContentLoaded', async () => {
  registerServiceWorker();
  setupInstallPrompt();
  renderHistory();
  updatePrivacyBadge();
  await loadTFModel();

  // Auto-start record if deep-linked
  if (new URLSearchParams(location.search).get('action') === 'record') {
    setTimeout(() => startRecording(), 800);
  }

  $('recordBtn').addEventListener('click', toggleRecord);
  $('fileInput').addEventListener('change', handleFileUpload);
  $('analyzeBtn').addEventListener('click', runAnalysis);
  $('uploadTrigger').addEventListener('click', () => $('fileInput').click());
  $('clearHistoryBtn')?.addEventListener('click', clearHistory);

  // Theme toggle — sync icon with current state, then cycle on click
  const themeBtn = $('themeToggle');
  if (themeBtn) {
    themeBtn.textContent = THEME_ICONS[document.documentElement.dataset.theme] ?? THEME_ICONS.system;
    themeBtn.addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme || 'system';
      applyTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length]);
    });
  }
});

/* ---- Service Worker ---- */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[App] SW registered:', reg.scope))
      .catch(err => console.warn('[App] SW registration failed:', err));
  }
}

/* ---- PWA Install ---- */
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.deferredInstall = e;
    $('installBanner').classList.remove('hidden');
  });

  $('installBtn')?.addEventListener('click', async () => {
    if (!state.deferredInstall) return;
    state.deferredInstall.prompt();
    const { outcome } = await state.deferredInstall.userChoice;
    if (outcome === 'accepted') $('installBanner').classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    $('installBanner').classList.add('hidden');
  });
}

/* ---- TF.js model load ---- */
async function loadTFModel() {
  try {
    setModelStatus('loading');
    // Try to load saved model from IndexedDB (user-trained)
    state.model = await tf.loadLayersModel('indexeddb://baby-cry-model');
    setModelStatus('ready', 'Personalized model loaded');
    console.log('[App] Loaded saved TF.js model from IndexedDB');
  } catch {
    // No saved model — build architecture for future training
    state.model = buildModel(25);
    setModelStatus('ready', 'Ready (acoustic analysis mode)');
    console.log('[App] Using heuristic analysis (no trained weights yet)');
  }
}

function setModelStatus(status, msg) {
  const badge = $('modelBadge');
  if (!badge) return;
  const labels = {
    loading: '⏳ Loading model...',
    ready: '🔒 On-device only',
    error: '⚠️ Fallback mode'
  };
  badge.textContent = msg || labels[status] || labels.ready;
  badge.dataset.status = status;
}

/* ---- Recording ---- */
async function toggleRecord() {
  if (state.phase === 'recording') {
    stopRecording();
  } else if (state.phase === 'idle' || state.phase === 'result') {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 44100,
        channelCount: 1,
        echoCancellation: false,  // off: we want raw cry, not processed
        noiseSuppression: false,
        autoGainControl: true
      }
    });

    state.audioChunks = [];
    state.recordingSeconds = 0;
    state.phase = 'recording';
    state.audioBlob = null;

    // Live waveform analyzer
    state.streamAnalyzer = analyzer.createStreamAnalyzer(stream);

    // MediaRecorder for capture
    const mimeType = getSupportedMimeType();
    state.mediaRecorder = new MediaRecorder(stream, { mimeType });
    state.mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };
    state.mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      state.audioBlob = new Blob(state.audioChunks, { type: mimeType });
      onRecordingComplete();
    };

    state.mediaRecorder.start(100);

    // UI updates
    updateRecordUI();
    startTimer();
    startWaveformAnimation();

  } catch (err) {
    console.error('[App] Mic error:', err);
    showToast(
      err.name === 'NotAllowedError'
        ? 'Microphone permission denied. Please allow access in your browser settings.'
        : 'Could not access microphone: ' + err.message,
      'error'
    );
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.phase === 'recording') {
    state.mediaRecorder.stop();
    clearInterval(state.timerInterval);
    cancelAnimationFrame(state.animFrame);
    if (state.streamAnalyzer) {
      state.streamAnalyzer.stop();
      state.streamAnalyzer = null;
    }
    state.phase = 'processing';
    updateRecordUI();
  }
}

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/wav'
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function onRecordingComplete() {
  const dur = state.recordingSeconds;
  if (dur < 2) {
    showToast('Recording too short. Please record at least 2 seconds of crying.', 'warn');
    state.phase = 'idle';
    updateRecordUI();
    return;
  }
  state.phase = 'idle';
  updateRecordUI();
  setAudioReady(`Recording ready (${dur}s)`);
  $('analyzeBtn').disabled = false;
}

/* ---- Timer ---- */
function startTimer() {
  $('timerDisplay').textContent = '0:00';
  state.timerInterval = setInterval(() => {
    state.recordingSeconds++;
    $('timerDisplay').textContent = formatTime(state.recordingSeconds);
    if (state.recordingSeconds >= 30) stopRecording();
  }, 1000);
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---- Waveform animation ---- */
function startWaveformAnimation() {
  const canvas = $('waveCanvas');
  const ctx = canvas.getContext('2d');

  function draw() {
    if (state.phase !== 'recording') return;
    state.animFrame = requestAnimationFrame(draw);

    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.clearRect(0, 0, W, H);

    if (!state.streamAnalyzer) return;
    const frame = state.streamAnalyzer.getFrame();
    const rms = state.streamAnalyzer.getInstantFeatures().rms;

    // Rolling RMS bars
    state.liveRms.push(rms);
    if (state.liveRms.length > 60) state.liveRms.shift();

    const barW = W / state.liveRms.length;
    state.liveRms.forEach((r, i) => {
      const h = Math.max(2, r * H * 8);
      const alpha = 0.4 + (i / state.liveRms.length) * 0.6;
      ctx.fillStyle = `rgba(212, 120, 90, ${alpha})`;
      ctx.beginPath();
      ctx.roundRect(i * barW, (H - h) / 2, barW - 2, h, 2);
      ctx.fill();
    });
  }

  draw();
}

/* ---- File Upload ---- */
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('audio/')) {
    showToast('Please select an audio file.', 'error');
    return;
  }
  state.audioBlob = file;
  setAudioReady(file.name);
  $('analyzeBtn').disabled = false;
  state.recordingSeconds = 0;
}

/* ---- Analysis ---- */
async function runAnalysis() {
  if (!state.audioBlob) return;

  state.phase = 'processing';
  updateAnalyzeBtn(true);
  $('resultSection').classList.add('hidden');

  try {
    // Extract acoustic features entirely on-device
    showProcessingStep('Extracting acoustic features…');
    const features = await analyzer.blobToFeatures(state.audioBlob);

    showProcessingStep('Running on-device classifier…');
    const result = await classify(features, state.model);

    showProcessingStep('Preparing results…');
    await new Promise(r => setTimeout(r, 300)); // brief pause for UX

    renderResult(result);
    renderFeedback(result);
    saveToHistory(result);

    state.phase = 'result';
    state.localSessions++;
    updateSessionCount();

  } catch (err) {
    console.error('[App] Analysis error:', err);
    showToast('Analysis failed: ' + err.message, 'error');
    state.phase = 'idle';
  } finally {
    updateAnalyzeBtn(false);
  }
}

function showProcessingStep(msg) {
  const el = $('processingStep');
  if (el) el.textContent = msg;
}

/* ---- Render result ---- */
function renderResult(result) {
  const meta = NEED_META[result.label] || {
    label: 'Unclear',
    icon: '🤔',
    color: '#888',
    bgLight: '#f5f5f5',
    urgency: 'low',
    tips: ['Ensure baby is comfortable', 'Try feeding, then changing, then holding']
  };

  const urgencyColors = { high: '#e24b4a', medium: '#f4a940', low: '#4caf92' };
  const urgencyLabel = { high: 'Urgent', medium: 'Moderate', low: 'Gentle' };

  // Build probability bars for all labels
  const probBars = LABELS.map(lbl => {
    const m = NEED_META[lbl];
    const pct = Math.round((result.probabilities[lbl] || 0) * 100);
    return `
      <div class="prob-row">
        <span class="prob-label">${m.icon} ${m.label}</span>
        <div class="prob-bar-track">
          <div class="prob-bar-fill" style="width:${pct}%;background:${m.color}" data-pct="${pct}"></div>
        </div>
        <span class="prob-pct">${pct}%</span>
      </div>`;
  }).join('');

  const tipsHtml = meta.tips.map(t =>
    `<li class="tip-item"><span class="tip-dot" style="background:${meta.color}"></span>${t}</li>`
  ).join('');

  $('resultSection').innerHTML = `
    <div class="result-card animate-in" style="--accent-color:${meta.color};--accent-bg:${meta.bgLight}">

      <div class="result-hero">
        <div class="result-icon-wrap" style="background:${meta.bgLight}">
          <span class="result-icon">${meta.icon}</span>
        </div>
        <div class="result-hero-text">
          <h2 class="result-title">${meta.label}</h2>
          <div class="result-badges">
            <span class="badge" style="background:${meta.bgLight};color:${meta.color}">
              ${result.confidence}% confidence
            </span>
            <span class="badge urgency-badge" style="background:${urgencyColors[meta.urgency]}1a;color:${urgencyColors[meta.urgency]}">
              ${urgencyLabel[meta.urgency]} urgency
            </span>
          </div>
        </div>
      </div>

      ${result.isUncertain ? `
        <div class="uncertain-notice">
          <span>💡</span>
          <span>Signal was mixed — try recording 5+ seconds with less background noise for a clearer reading.</span>
        </div>
      ` : ''}

      <div class="section-block">
        <div class="section-label">What to do</div>
        <ul class="tips-list">${tipsHtml}</ul>
      </div>

      <details class="details-block">
        <summary>Signal breakdown</summary>
        <div class="prob-bars">${probBars}</div>
        <div class="feature-grid">
          <div class="feat-cell">
            <span class="feat-name">Pitch</span>
            <span class="feat-val">${Math.round(result.features.pitch_mean)} Hz</span>
          </div>
          <div class="feat-cell">
            <span class="feat-name">Rhythm</span>
            <span class="feat-val">${Math.round(result.features.rhythm_score * 100)}%</span>
          </div>
          <div class="feat-cell">
            <span class="feat-name">Active time</span>
            <span class="feat-val">${Math.round(result.features.cry_burst_ratio * 100)}%</span>
          </div>
          <div class="feat-cell">
            <span class="feat-name">Onset rate</span>
            <span class="feat-val">${result.features.onset_rate.toFixed(1)}/s</span>
          </div>
        </div>
      </details>

      <div class="privacy-note">
        <span>🔒</span> All analysis ran locally on your device. No audio was transmitted anywhere.
      </div>
    </div>
  `;

  $('resultSection').classList.remove('hidden');
  $('resultSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Animate probability bars
  requestAnimationFrame(() => {
    document.querySelectorAll('.prob-bar-fill').forEach(bar => {
      const pct = bar.dataset.pct;
      bar.style.width = '0%';
      requestAnimationFrame(() => {
        bar.style.transition = 'width 0.7s ease';
        bar.style.width = pct + '%';
      });
    });
  });
}

/* ---- History ---- */
function saveToHistory(result) {
  const meta = NEED_META[result.label] || {};
  const entry = {
    label: result.label,
    displayLabel: meta.label || result.label,
    icon: meta.icon || '🤔',
    color: meta.color || '#888',
    confidence: result.confidence,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })
  };
  state.history.unshift(entry);
  if (state.history.length > 10) state.history.pop();
  localStorage.setItem('babyCryHistory', JSON.stringify(state.history));
  renderHistory();
}

function renderHistory() {
  const container = $('historyList');
  const section = $('historySection');
  if (!container) return;

  if (!state.history.length) {
    section?.classList.add('hidden');
    return;
  }
  section?.classList.remove('hidden');

  container.innerHTML = state.history.map((h, i) => `
    <div class="history-item" style="animation-delay:${i * 0.05}s">
      <span class="h-icon">${h.icon}</span>
      <div class="h-info">
        <span class="h-label">${h.displayLabel}</span>
        <span class="h-time">${h.date} · ${h.time}</span>
      </div>
      <span class="h-confidence" style="color:${h.color}">${h.confidence}%</span>
    </div>
  `).join('');
}

function clearHistory() {
  state.history = [];
  localStorage.removeItem('babyCryHistory');
  renderHistory();
}

/* ---- UI helpers ---- */
function updateRecordUI() {
  const btn = $('recordBtn');
  const label = $('recordBtnLabel');
  const hint = $('recordHint');

  if (state.phase === 'recording') {
    btn.classList.add('recording');
    btn.querySelector('.mic-icon').textContent = '⏹';
    label.textContent = 'Tap to stop';
    hint.textContent = 'Recording… up to 30 seconds';
    $('waveSection').classList.remove('hidden');
  } else if (state.phase === 'processing') {
    btn.classList.remove('recording');
    btn.querySelector('.mic-icon').textContent = '⏳';
    label.textContent = 'Processing…';
    hint.textContent = 'Analyzing on-device…';
  } else {
    btn.classList.remove('recording');
    btn.querySelector('.mic-icon').textContent = '🎙';
    label.textContent = 'Record cry';
    hint.textContent = 'Tap the button and hold your phone near the baby';
    if (state.phase !== 'result') $('waveSection').classList.add('hidden');
    $('timerDisplay').textContent = '';
  }
}

function setAudioReady(msg) {
  const el = $('audioReadyMsg');
  if (el) { el.textContent = '✓ ' + msg; el.classList.remove('hidden'); }
}

function updateAnalyzeBtn(loading) {
  const btn = $('analyzeBtn');
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Analyzing…';
  } else {
    btn.disabled = !state.audioBlob;
    btn.innerHTML = '🔍 Analyze cry';
  }
}

function updatePrivacyBadge() {
  const el = $('privacyBadge');
  if (el) el.textContent = '🔒 100% on-device · no cloud · no tracking';
}

function updateSessionCount() {
  const el = $('sessionCount');
  if (el) {
    const total = parseInt(localStorage.getItem('totalSessions') || '0') + 1;
    localStorage.setItem('totalSessions', total);
    el.textContent = total + ' session' + (total !== 1 ? 's' : '') + ' analyzed on this device';
  }
}

function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
