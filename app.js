/* =========================================================
   app.js — Hushh
   Main application controller. All audio processing and
   inference happens entirely on-device via Web Audio API
   and TensorFlow.js. No data is sent to any server.
   ========================================================= */

import { AudioAnalyzer } from './audio-analyzer.js';
import { classify, buildModel, NEED_META, LABELS, featuresToVector } from './cry-model.js';
import { t, setLanguage, getLanguage, SUPPORTED_LANGS } from './i18n.js';
const tf = window.tf; // loaded as UMD global by index.html <script> tag

/* ---- State ---- */

// Allowlists used to validate history entries loaded from localStorage
const VALID_HISTORY_LABELS = new Set(['hunger', 'tired', 'pain', 'diaper', 'attention', 'unknown']);
const COLOR_HEX_RE = /^#[0-9a-fA-F]{3,6}$/;

function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(h =>
    h && typeof h === 'object' &&
    VALID_HISTORY_LABELS.has(h.label) &&
    typeof h.confidence === 'number' &&
    COLOR_HEX_RE.test(h.color ?? '')
  );
}

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
  history: sanitizeHistory(JSON.parse(localStorage.getItem('babyCryHistory') || '[]')),
  deferredInstall: null,
  liveRms: new Array(60).fill(0),
  localSessions: 0,
  lossHistory: [],
  lastResult: null,
  modelStatusKey: 'loading',
  modelStatusMsg: null
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
    <p class="fb-question">${t('feedback.question')}</p>
    <div class="fb-btns${uncertain ? ' hidden' : ''}">
      ${!uncertain ? `<button class="btn-fb btn-fb-yes">${t('feedback.yes')}</button>` : ''}
      <button class="btn-fb btn-fb-no">${t('feedback.no')}</button>
    </div>
    <div class="label-picker${uncertain ? '' : ' hidden'}">
      <p class="lp-prompt">${uncertain ? t('feedback.picker.initial') : t('feedback.picker.correct')}</p>
      <div class="lp-grid">${LABELS.map((lbl, i) => {
    const m = NEED_META[lbl];
    return `<button class="btn-pick" data-idx="${i}" style="--c:${m.color};--bg:${m.bgLight}">${m.icon}<span>${t('need.' + lbl + '.label')}</span></button>`;
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
        ? t('feedback.training-start', { count })
        : t('feedback.saved', { count, total: MIN_TRAIN_SAMPLES }));
      if (count >= MIN_TRAIN_SAMPLES) checkAndTrain();
    } catch (err) {
      dismiss(t('feedback.save-error', { err: err.message }));
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
        ? t('training.done-ok')
        : t('training.done-fail', { err: data.error || 'unknown' }));
      if (data.success) await loadTFModel();
    }
  };

  trainWorker.onerror = err => {
    trainWorker.terminate(); trainWorker = null;
    finishTrainingPanel(t('training.worker-error', { err: err.message }));
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
        <span class="tp-title">${t('training.title')}</span>
        <span class="tp-ep" id="tpEp"></span>
      </div>
      <div class="tp-track"><div class="tp-fill" id="tpFill"></div></div>
      <canvas class="tp-loss" id="tpLoss"></canvas>
      <p class="tp-status" id="tpStatus">${t('training.fitting')}</p>
    `;
    document.querySelector('.app-shell').appendChild(p);
  }
  return p;
}

function showTrainingPanel() {
  state.lossHistory = [];
  getOrCreatePanel().classList.remove('hidden');
  $('tpFill').style.width = '0%';
  $('tpStatus').textContent = t('training.fitting');
  $('tpEp').textContent = '';
  $('trainingPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateTrainingPanel(epoch, epochs, loss) {
  $('tpEp').textContent = t('training.epoch', { epoch, epochs });
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

/* ---- i18n ---- */
function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

function applyLang(lang) {
  setLanguage(lang);
  translatePage();
  updateRecordUI();
  updatePrivacyBadge();
  updateAnalyzeBtn(state.phase === 'processing');
  setModelStatus(state.modelStatusKey, state.modelStatusMsg);
  renderSessionCount();
  renderHistory();
  if (state.lastResult) {
    $('resultSection').innerHTML = '';
    renderResult(state.lastResult);
    renderFeedback(state.lastResult);
  }
  const btn = $('langToggle');
  if (btn) btn.textContent = lang === 'vi' ? 'EN' : 'VI';
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
  applyLang(getLanguage());
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

  // Language toggle — cycle through supported languages
  const langBtn = $('langToggle');
  if (langBtn) {
    langBtn.addEventListener('click', () => {
      const cur = getLanguage();
      const next = SUPPORTED_LANGS[(SUPPORTED_LANGS.indexOf(cur) + 1) % SUPPORTED_LANGS.length];
      applyLang(next);
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
    state.model = await tf.loadLayersModel('indexeddb://baby-cry-model');
    setModelStatus('ready', 'model.personalized');
    console.log('[App] Loaded saved TF.js model from IndexedDB');
  } catch {
    state.model = buildModel(25);
    setModelStatus('ready', 'model.heuristic');
    console.log('[App] Using heuristic analysis (no trained weights yet)');
  }
}

function setModelStatus(status, msgKey) {
  state.modelStatusKey = status;
  state.modelStatusMsg = msgKey ?? null;
  const badge = $('modelBadge');
  if (!badge) return;
  badge.textContent = t(msgKey ?? ('model.' + status));
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
        ? t('toast.mic-denied')
        : t('toast.mic-error', { err: err.message }),
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
  return types.find(mime => MediaRecorder.isTypeSupported(mime)) || '';
}

function onRecordingComplete() {
  const dur = state.recordingSeconds;
  if (dur < 2) {
    showToast(t('toast.too-short'), 'warn');
    state.phase = 'idle';
    updateRecordUI();
    return;
  }
  state.phase = 'idle';
  updateRecordUI();
  setAudioReady(t('audio-ready.recording', { dur }));
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
    showToast(t('toast.not-audio'), 'error');
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
    showProcessingStep(t('step.features'));
    const features = await analyzer.blobToFeatures(state.audioBlob);

    showProcessingStep(t('step.classify'));
    const result = await classify(features, state.model);

    showProcessingStep(t('step.prepare'));
    await new Promise(r => setTimeout(r, 300)); // brief pause for UX

    renderResult(result);
    renderFeedback(result);
    saveToHistory(result);

    state.phase = 'result';
    state.localSessions++;
    updateSessionCount();

  } catch (err) {
    console.error('[App] Analysis error:', err);
    showToast(t('toast.analysis-failed', { err: err.message }), 'error');
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
  state.lastResult = result;

  const meta = NEED_META[result.label] || { icon: '🤔', color: '#888', bgLight: '#f5f5f5', urgency: 'low' };
  const urgencyColors = { high: '#e24b4a', medium: '#f4a940', low: '#4caf92' };
  const displayLabel  = t('need.' + result.label + '.label');
  const urgencyLevel  = t('urgency.' + meta.urgency);

  const probBars = LABELS.map(lbl => {
    const m   = NEED_META[lbl];
    const pct = Math.round((result.probabilities[lbl] || 0) * 100);
    return `
      <div class="prob-row">
        <span class="prob-label">${m.icon} ${t('need.' + lbl + '.label')}</span>
        <div class="prob-bar-track">
          <div class="prob-bar-fill" style="width:${pct}%;background:${m.color}" data-pct="${pct}"></div>
        </div>
        <span class="prob-pct">${pct}%</span>
      </div>`;
  }).join('');

  const tipCount = result.label === 'unknown' ? 2 : 5;
  const tipsHtml = Array.from({ length: tipCount }, (_, i) =>
    `<li class="tip-item"><span class="tip-dot" style="background:${meta.color}"></span>${t('need.' + result.label + '.tip.' + i)}</li>`
  ).join('');

  $('resultSection').innerHTML = `
    <div class="result-card animate-in" style="--accent-color:${meta.color};--accent-bg:${meta.bgLight}">

      <div class="result-hero">
        <div class="result-icon-wrap" style="background:${meta.bgLight}">
          <span class="result-icon">${meta.icon}</span>
        </div>
        <div class="result-hero-text">
          <h2 class="result-title">${displayLabel}</h2>
          <div class="result-badges">
            <span class="badge" style="background:${meta.bgLight};color:${meta.color}">
              ${t('result.confidence', { pct: result.confidence })}
            </span>
            <span class="badge urgency-badge" style="background:${urgencyColors[meta.urgency]}1a;color:${urgencyColors[meta.urgency]}">
              ${t('urgency.label', { level: urgencyLevel })}
            </span>
          </div>
        </div>
      </div>

      ${result.isUncertain ? `
        <div class="uncertain-notice">
          <span>💡</span>
          <span>${t('result.uncertain')}</span>
        </div>
      ` : ''}

      <div class="section-block">
        <div class="section-label">${t('result.what-to-do')}</div>
        <ul class="tips-list">${tipsHtml}</ul>
      </div>

      <details class="details-block">
        <summary>${t('result.signal-breakdown')}</summary>
        <div class="prob-bars">${probBars}</div>
        <div class="feature-grid">
          <div class="feat-cell">
            <span class="feat-name">${t('result.feat.pitch')}</span>
            <span class="feat-val">${Math.round(result.features.pitch_mean)} Hz</span>
          </div>
          <div class="feat-cell">
            <span class="feat-name">${t('result.feat.rhythm')}</span>
            <span class="feat-val">${Math.round(result.features.rhythm_score * 100)}%</span>
          </div>
          <div class="feat-cell">
            <span class="feat-name">${t('result.feat.active-time')}</span>
            <span class="feat-val">${Math.round(result.features.cry_burst_ratio * 100)}%</span>
          </div>
          <div class="feat-cell">
            <span class="feat-name">${t('result.feat.onset-rate')}</span>
            <span class="feat-val">${result.features.onset_rate.toFixed(1)}/s</span>
          </div>
        </div>
      </details>

      <div class="privacy-note">
        <span>🔒</span> ${t('result.privacy-note')}
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

  container.textContent = '';
  state.history.forEach((h, i) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.style.animationDelay = `${i * 0.05}s`;

    const icon = document.createElement('span');
    icon.className = 'h-icon';
    icon.textContent = h.icon;

    const info = document.createElement('div');
    info.className = 'h-info';

    const lbl = document.createElement('span');
    lbl.className = 'h-label';
    lbl.textContent = t('need.' + h.label + '.label');

    const time = document.createElement('span');
    time.className = 'h-time';
    time.textContent = `${h.date} · ${h.time}`;

    const conf = document.createElement('span');
    conf.className = 'h-confidence';
    conf.style.color = COLOR_HEX_RE.test(h.color) ? h.color : '#888';
    conf.textContent = `${h.confidence}%`;

    info.append(lbl, time);
    item.append(icon, info, conf);
    container.appendChild(item);
  });
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
    label.textContent = t('record.btn.stop');
    hint.textContent = t('record.hint.recording');
    $('waveSection').classList.remove('hidden');
  } else if (state.phase === 'processing') {
    btn.classList.remove('recording');
    btn.querySelector('.mic-icon').textContent = '⏳';
    label.textContent = t('record.btn.processing');
    hint.textContent = t('record.hint.processing');
  } else {
    btn.classList.remove('recording');
    btn.querySelector('.mic-icon').textContent = '🎙';
    label.textContent = t('record.btn.idle');
    hint.textContent = t('record.hint.idle');
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
    btn.textContent = t('analyze.btn.loading');
  } else {
    btn.disabled = !state.audioBlob;
    btn.textContent = t('analyze.btn');
  }
}

function updatePrivacyBadge() {
  const el = $('privacyBadge');
  if (el) el.textContent = t('privacy-badge');
}

function updateSessionCount() {
  const el = $('sessionCount');
  if (!el) return;
  const total = parseInt(localStorage.getItem('totalSessions') || '0') + 1;
  localStorage.setItem('totalSessions', total);
  el.classList.remove('hidden');
  el.textContent = total === 1 ? t('session-count', { total }) : t('session-count.plural', { total });
}

function renderSessionCount() {
  const el = $('sessionCount');
  if (!el) return;
  const total = parseInt(localStorage.getItem('totalSessions') || '0');
  if (total > 0) {
    el.classList.remove('hidden');
    el.textContent = total === 1 ? t('session-count', { total }) : t('session-count.plural', { total });
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
