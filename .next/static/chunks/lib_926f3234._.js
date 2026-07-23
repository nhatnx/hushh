(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/lib/audio-analyzer.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* =========================================================
   audio-analyzer.js
   On-device acoustic feature extraction using Web Audio API.
   NO data leaves the device — all processing is local.

   Extracts:
   - RMS energy (volume over time)
   - Zero-crossing rate (roughness / noisiness)
   - Spectral centroid (brightness)
   - Dominant pitch via autocorrelation (McLeod Pitch Method)
   - Rhythm / periodicity score
   - Mel-frequency cepstral coefficients (13 MFCCs)
   - Onset events (cry bursts vs pauses)
   ========================================================= */ __turbopack_context__.s([
    "AudioAnalyzer",
    ()=>AudioAnalyzer
]);
class AudioAnalyzer {
    /* ----------------------------------------------------------
     Main entry point: analyze a Float32Array of PCM samples
     Returns a feature vector ready for the classifier
  ---------------------------------------------------------- */ analyze(samples) {
        if (samples.length < this.frameSize) {
            throw new Error('Audio too short — need at least ' + this.frameSize + ' samples');
        }
        // Split into overlapping frames
        const frames = this._frame(samples);
        // Per-frame features
        const rmsArr = frames.map((f)=>this._rms(f));
        const zcrArr = frames.map((f)=>this._zcr(f));
        const mags = frames.map((f)=>this._magnitude(f));
        const centroidArr = mags.map((m)=>this._spectralCentroid(m));
        const pitchArr = frames.map((f)=>this._pitch(f));
        const mfccMatrix = mags.map((m)=>this._mfcc(m));
        // Aggregate statistics
        const features = {
            // Energy
            rms_mean: this._mean(rmsArr),
            rms_std: this._std(rmsArr),
            rms_max: Math.max(...rmsArr),
            // Pitch
            pitch_mean: this._mean(pitchArr.filter((p)=>p > 0)),
            pitch_std: this._std(pitchArr.filter((p)=>p > 0)),
            pitch_voiced: pitchArr.filter((p)=>p > 80).length / pitchArr.length,
            // Brightness
            centroid_mean: this._mean(centroidArr),
            centroid_std: this._std(centroidArr),
            // Roughness
            zcr_mean: this._mean(zcrArr),
            zcr_std: this._std(zcrArr),
            // Rhythm
            rhythm_score: this._rhythmScore(rmsArr),
            onset_rate: this._onsetRate(rmsArr),
            cry_burst_ratio: this._cryBurstRatio(rmsArr),
            // MFCCs (mean of each coefficient)
            mfcc: this._colMeans(mfccMatrix),
            // Duration stats
            total_frames: frames.length,
            active_frames: rmsArr.filter((r)=>r > 0.01).length
        };
        return features;
    }
    /* ----------------------------------------------------------
     Analyze a MediaRecorder Blob → Float32Array via OfflineAudioContext
  ---------------------------------------------------------- */ async blobToFeatures(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        await audioCtx.close();
        // Mix down to mono
        const mono = this._mixToMono(decoded);
        return this.analyze(mono);
    }
    /* ----------------------------------------------------------
     Stream analysis from a live MediaStream (returns features
     from a rolling buffer — call repeatedly while recording)
  ---------------------------------------------------------- */ createStreamAnalyzer(stream) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = this.frameSize;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);
        const freqBuffer = new Uint8Array(analyser.frequencyBinCount);
        return {
            ctx,
            analyser,
            getFrame: ()=>{
                analyser.getFloatTimeDomainData(buffer);
                return Float32Array.from(buffer);
            },
            getFrequency: ()=>{
                analyser.getByteFrequencyData(freqBuffer);
                return Uint8Array.from(freqBuffer);
            },
            // Cheap per-animation-frame reading — O(n), no FFT
            getRms: ()=>{
                analyser.getFloatTimeDomainData(buffer);
                return this._rms(buffer);
            },
            getInstantFeatures: ()=>{
                analyser.getFloatTimeDomainData(buffer);
                const frame = Float32Array.from(buffer);
                return {
                    rms: this._rms(frame),
                    zcr: this._zcr(frame),
                    centroid: this._spectralCentroid(this._magnitude(frame)),
                    pitch: this._pitch(frame)
                };
            },
            stop: ()=>{
                source.disconnect();
                ctx.close();
            }
        };
    }
    /* ----------------------------------------------------------
     Private helpers
  ---------------------------------------------------------- */ _mixToMono(audioBuffer) {
        const channels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;
        const mono = new Float32Array(length);
        for(let c = 0; c < channels; c++){
            const ch = audioBuffer.getChannelData(c);
            for(let i = 0; i < length; i++)mono[i] += ch[i] / channels;
        }
        return mono;
    }
    _frame(samples) {
        const frames = [];
        for(let i = 0; i + this.frameSize <= samples.length; i += this.hopSize){
            frames.push(samples.slice(i, i + this.frameSize));
        }
        return frames;
    }
    _rms(frame) {
        let sum = 0;
        for(let i = 0; i < frame.length; i++)sum += frame[i] * frame[i];
        return Math.sqrt(sum / frame.length);
    }
    _zcr(frame) {
        let crossings = 0;
        for(let i = 1; i < frame.length; i++){
            if (frame[i] >= 0 !== frame[i - 1] >= 0) crossings++;
        }
        return crossings / frame.length;
    }
    _spectralCentroid(mag) {
        let weightedSum = 0, totalMag = 0;
        for(let k = 0; k < mag.length; k++){
            weightedSum += k * mag[k];
            totalMag += mag[k];
        }
        if (totalMag === 0) return 0;
        return weightedSum / totalMag * (this.sampleRate / this.frameSize);
    }
    /* McLeod Pitch Method via FFT-based autocorrelation — O(n log n) */ _pitch(frame) {
        const n = frame.length;
        const fftSize = n * 2; // zero-pad to get linear (not circular) autocorrelation
        // r[tau] = IFFT(|FFT(x)|²)[tau]
        const real = new Float32Array(fftSize);
        const imag = new Float32Array(fftSize);
        for(let i = 0; i < n; i++)real[i] = frame[i];
        this._fft(real, imag);
        for(let k = 0; k < fftSize; k++){
            real[k] = real[k] * real[k] + imag[k] * imag[k];
            imag[k] = 0;
        }
        this._fft(real, imag);
        // IFFT via forward FFT: r[tau] = real[(fftSize - tau) & (fftSize-1)] / fftSize
        // Prefix sums of x² allow O(1) NSDF normalization: m[tau] = sqSum[n-tau] + sqSum[n] - sqSum[tau]
        const sqSum = new Float32Array(n + 1);
        for(let i = 0; i < n; i++)sqSum[i + 1] = sqSum[i] + frame[i] * frame[i];
        const acfAt = (tau)=>real[fftSize - tau & fftSize - 1] / fftSize;
        const nsdfAt = (tau)=>{
            const m = sqSum[n - tau] + sqSum[n] - sqSum[tau];
            return m === 0 ? 0 : 2 * acfAt(tau) / m;
        };
        // Only search lags that correspond to infant-cry frequencies (60–1200 Hz)
        const tauMin = Math.floor(this.sampleRate / 1200); // ~37 samples
        const tauMax = Math.min(Math.ceil(this.sampleRate / 60), n - 1); // ~735 samples
        let maxNsdf = -Infinity, maxTau = -1;
        let inPositive = false;
        for(let tau = 1; tau <= tauMax; tau++){
            const nsdf = nsdfAt(tau);
            if (nsdf > 0) inPositive = true;
            if (inPositive && tau >= tauMin && nsdf > 0.8) {
                if (nsdf > maxNsdf) {
                    maxNsdf = nsdf;
                    maxTau = tau;
                }
            }
            if (inPositive && nsdf < 0) {
                inPositive = false;
                if (maxTau > 0) break;
            }
        }
        if (maxTau <= 0) return 0;
        // Parabolic interpolation for sub-sample accuracy
        const y1 = nsdfAt(maxTau - 1);
        const y2 = maxNsdf;
        const y3 = nsdfAt(maxTau + 1);
        const denom = 2 * (2 * y2 - y1 - y3);
        const refined = denom === 0 ? maxTau : maxTau + (y1 - y3) / denom;
        const freq = this.sampleRate / refined;
        return freq >= 60 && freq <= 1200 ? freq : 0;
    }
    _magnitude(frame) {
        const n = frame.length;
        const real = new Float32Array(n);
        const imag = new Float32Array(n);
        for(let i = 0; i < n; i++){
            real[i] = frame[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
        }
        this._fft(real, imag);
        const half = n / 2;
        const mag = new Float32Array(half);
        for(let k = 0; k < half; k++){
            mag[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
        }
        return mag;
    }
    // Cooley-Tukey radix-2 DIT FFT (in-place). O(n log n) vs O(n²) naive DFT.
    _fft(real, imag) {
        const n = real.length;
        for(let i = 1, j = 0; i < n; i++){
            let bit = n >> 1;
            for(; j & bit; bit >>= 1)j ^= bit;
            j ^= bit;
            if (i < j) {
                let t = real[i];
                real[i] = real[j];
                real[j] = t;
                t = imag[i];
                imag[i] = imag[j];
                imag[j] = t;
            }
        }
        for(let len = 2; len <= n; len <<= 1){
            const ang = -2 * Math.PI / len;
            const wRe = Math.cos(ang), wIm = Math.sin(ang);
            const hlen = len >> 1;
            for(let i = 0; i < n; i += len){
                let curRe = 1, curIm = 0;
                for(let j = 0; j < hlen; j++){
                    const uRe = real[i + j], uIm = imag[i + j];
                    const vRe = real[i + j + hlen] * curRe - imag[i + j + hlen] * curIm;
                    const vIm = real[i + j + hlen] * curIm + imag[i + j + hlen] * curRe;
                    real[i + j] = uRe + vRe;
                    imag[i + j] = uIm + vIm;
                    real[i + j + hlen] = uRe - vRe;
                    imag[i + j + hlen] = uIm - vIm;
                    const newRe = curRe * wRe - curIm * wIm;
                    curIm = curRe * wIm + curIm * wRe;
                    curRe = newRe;
                }
            }
        }
    }
    _mfcc(mag) {
        const melFilters = this._melFilterBank(mag.length);
        const melEnergies = melFilters.map((filter)=>{
            let e = 0;
            for(let k = 0; k < mag.length; k++)e += mag[k] * filter[k];
            return Math.log(e + 1e-10);
        });
        // DCT-II
        const mfcc = new Array(this.numMFCC);
        for(let n = 0; n < this.numMFCC; n++){
            let sum = 0;
            for(let m = 0; m < this.melBands; m++){
                sum += melEnergies[m] * Math.cos(Math.PI * n * (m + 0.5) / this.melBands);
            }
            mfcc[n] = sum;
        }
        return mfcc;
    }
    _melFilterBank(numBins) {
        const cached = this._melBankCache.get(numBins);
        if (cached) return cached;
        const bank = this._buildMelFilterBank(numBins);
        this._melBankCache.set(numBins, bank);
        return bank;
    }
    _buildMelFilterBank(numBins) {
        const fMin = 80, fMax = 8000;
        const melMin = this._hz2mel(fMin), melMax = this._hz2mel(fMax);
        const melPoints = Array.from({
            length: this.melBands + 2
        }, (_, i)=>melMin + i * (melMax - melMin) / (this.melBands + 1));
        const hzPoints = melPoints.map((m)=>this._mel2hz(m));
        const binPoints = hzPoints.map((f)=>Math.round(f * this.frameSize / this.sampleRate));
        return Array.from({
            length: this.melBands
        }, (_, m)=>{
            const filter = new Float32Array(numBins);
            for(let k = binPoints[m]; k < binPoints[m + 1]; k++){
                filter[k] = (k - binPoints[m]) / (binPoints[m + 1] - binPoints[m]);
            }
            for(let k = binPoints[m + 1]; k < binPoints[m + 2]; k++){
                filter[k] = (binPoints[m + 2] - k) / (binPoints[m + 2] - binPoints[m + 1]);
            }
            return filter;
        });
    }
    _hz2mel(hz) {
        return 2595 * Math.log10(1 + hz / 700);
    }
    _mel2hz(mel) {
        return 700 * (Math.pow(10, mel / 2595) - 1);
    }
    /* Rhythm: autocorrelation of energy envelope to detect periodicity */ _rhythmScore(rmsArr) {
        const n = Math.min(rmsArr.length, 128);
        const arr = rmsArr.slice(0, n);
        const mean = this._mean(arr);
        const centered = arr.map((v)=>v - mean);
        let acf0 = centered.reduce((s, v)=>s + v * v, 0);
        if (acf0 === 0) return 0;
        let maxAcf = 0;
        for(let lag = 2; lag < n / 2; lag++){
            let acf = 0;
            for(let i = 0; i + lag < n; i++)acf += centered[i] * centered[i + lag];
            maxAcf = Math.max(maxAcf, acf / acf0);
        }
        return Math.max(0, Math.min(1, maxAcf));
    }
    /* How many cry bursts per second */ _onsetRate(rmsArr) {
        const threshold = this._mean(rmsArr) + 0.5 * this._std(rmsArr);
        let onsets = 0;
        let wasAbove = false;
        for (const r of rmsArr){
            const above = r > threshold;
            if (above && !wasAbove) onsets++;
            wasAbove = above;
        }
        // frames are hopSize / sampleRate seconds each
        const durationSec = rmsArr.length * (this.hopSize / this.sampleRate);
        return durationSec > 0 ? onsets / durationSec : 0;
    }
    /* Fraction of time actively crying vs silent */ _cryBurstRatio(rmsArr) {
        const threshold = 0.015;
        return rmsArr.filter((r)=>r > threshold).length / rmsArr.length;
    }
    _mean(arr) {
        if (!arr || arr.length === 0) return 0;
        return arr.reduce((s, v)=>s + v, 0) / arr.length;
    }
    _std(arr) {
        if (!arr || arr.length < 2) return 0;
        const m = this._mean(arr);
        return Math.sqrt(arr.reduce((s, v)=>s + (v - m) ** 2, 0) / arr.length);
    }
    _colMeans(matrix) {
        if (matrix.length === 0) return new Array(this.numMFCC).fill(0);
        const means = new Array(matrix[0].length).fill(0);
        for (const row of matrix)row.forEach((v, i)=>means[i] += v / matrix.length);
        return means;
    }
    constructor(sampleRate = 44100){
        this.sampleRate = sampleRate;
        this.frameSize = 2048;
        this.hopSize = 512;
        this.melBands = 26;
        this.numMFCC = 13;
        this._melBankCache = new Map(); // numBins → filter bank (identical for every frame)
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/cry-model.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* =========================================================
   cry-model.js
   On-device baby cry classifier using TensorFlow.js.

   Architecture:
   - Input: 25-dimensional feature vector (acoustic features)
   - 2 dense hidden layers with dropout for regularization
   - Output: 5-class softmax (hunger, tired, pain, diaper, attention)

   Since we cannot ship pre-trained weights for a real baby cry
   dataset without a training pipeline, this module uses a
   carefully tuned heuristic scoring system grounded in
   peer-reviewed infant cry research (Muller et al. 2019,
   Lester & Boukydis 1992, Várallyay 2008).

   The TF.js model structure is ready for fine-tuning — if you
   collect labeled audio locally, call model.fit() to improve
   accuracy over time without any server involvement.
   ========================================================= */ // TF.js is a UMD global loaded from CDN. It may finish loading AFTER this module
// is imported (20s fallback init), so it must be looked up lazily per call —
// never captured at module scope.
__turbopack_context__.s([
    "LABELS",
    ()=>LABELS,
    "NEED_META",
    ()=>NEED_META,
    "buildModel",
    ()=>buildModel,
    "classify",
    ()=>classify,
    "featuresToVector",
    ()=>featuresToVector,
    "heuristicClassify",
    ()=>heuristicClassify
]);
const getTf = ()=>("TURBOPACK compile-time truthy", 1) ? window.tf : "TURBOPACK unreachable";
const LABELS = [
    'hunger',
    'tired',
    'pain',
    'diaper',
    'attention'
];
const NEED_META = {
    hunger: {
        icon: '🍼',
        color: '#e07a5f',
        bgLight: '#fdf0eb',
        urgency: 'high'
    },
    tired: {
        icon: '😴',
        color: '#8b6bbf',
        bgLight: '#f0ecfb',
        urgency: 'low'
    },
    pain: {
        icon: '😣',
        color: '#e24b4a',
        bgLight: '#fdecea',
        urgency: 'high'
    },
    diaper: {
        icon: '🩲',
        color: '#4caf92',
        bgLight: '#e6f5f0',
        urgency: 'medium'
    },
    attention: {
        icon: '🤗',
        color: '#5b9bd5',
        bgLight: '#e8f1fb',
        urgency: 'low'
    }
};
function buildModel() {
    let inputDim = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 25;
    const tf = getTf();
    const model = tf.sequential({
        layers: [
            tf.layers.dense({
                inputShape: [
                    inputDim
                ],
                units: 64,
                activation: 'relu',
                kernelInitializer: 'glorotUniform',
                name: 'dense_1'
            }),
            tf.layers.batchNormalization({
                name: 'bn_1'
            }),
            tf.layers.dropout({
                rate: 0.3,
                name: 'drop_1'
            }),
            tf.layers.dense({
                units: 32,
                activation: 'relu',
                kernelInitializer: 'glorotUniform',
                name: 'dense_2'
            }),
            tf.layers.dropout({
                rate: 0.2,
                name: 'drop_2'
            }),
            tf.layers.dense({
                units: LABELS.length,
                activation: 'softmax',
                name: 'output'
            })
        ]
    });
    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'categoricalCrossentropy',
        metrics: [
            'accuracy'
        ]
    });
    return model;
}
function heuristicClassify(features) {
    const scores = {
        hunger: 0,
        tired: 0,
        pain: 0,
        diaper: 0,
        attention: 0
    };
    const { pitch_mean = 0, pitch_std = 0, pitch_voiced = 0, rms_mean = 0, rms_std = 0, rms_max = 0, zcr_mean = 0, centroid_mean = 0, centroid_std = 0, rhythm_score = 0, onset_rate = 0, cry_burst_ratio = 0, mfcc = [] } = features;
    // ---- HUNGER ----
    // Rhythmic, periodic, medium-high pitch, nasal (MFCC2 pattern)
    scores.hunger += rhythm_score * 2.5;
    if (pitch_mean >= 280 && pitch_mean <= 500) scores.hunger += 1.5;
    if (pitch_voiced > 0.5) scores.hunger += 1.0;
    if (cry_burst_ratio > 0.6) scores.hunger += 1.0;
    if (onset_rate > 0.5 && onset_rate < 3) scores.hunger += 0.8;
    if (rms_mean > 0.03) scores.hunger += 0.5;
    // ---- TIRED ----
    // Whiny, lower pitch, more pauses, lower intensity, less periodic
    if (pitch_mean > 0 && pitch_mean < 300) scores.tired += 1.5;
    if (rms_mean < 0.04) scores.tired += 1.0;
    if (rms_std < 0.02) scores.tired += 0.8; // consistent low volume
    if (cry_burst_ratio < 0.5) scores.tired += 1.2;
    if (rhythm_score < 0.3) scores.tired += 0.8;
    if (onset_rate < 1.0) scores.tired += 0.7;
    if (zcr_mean < 0.1) scores.tired += 0.5;
    // ---- PAIN ----
    // High pitch, sharp onsets, high ZCR, bright spectrum
    if (pitch_mean > 450) scores.pain += 2.0;
    if (pitch_mean > 600) scores.pain += 1.0; // very high pitch
    if (pitch_std > 60) scores.pain += 1.2; // pitch instability
    if (zcr_mean > 0.15) scores.pain += 1.5;
    if (centroid_mean > 3000) scores.pain += 1.0;
    if (centroid_std > 500) scores.pain += 0.8; // spectral variance
    if (onset_rate > 2.5) scores.pain += 1.5; // sudden, sharp bursts
    if (rms_max > 0.15) scores.pain += 0.8;
    // ---- DIAPER ----
    // Nagging, moderate everything, medium onset rate
    // Diaper tends to be "average" — detected partly by exclusion
    if (pitch_mean >= 200 && pitch_mean <= 400) scores.diaper += 0.8;
    if (onset_rate >= 1.0 && onset_rate <= 2.5) scores.diaper += 1.0;
    if (cry_burst_ratio > 0.4 && cry_burst_ratio < 0.75) scores.diaper += 1.0;
    if (rms_mean > 0.025 && rms_mean < 0.08) scores.diaper += 0.8;
    if (rhythm_score > 0.2 && rhythm_score < 0.6) scores.diaper += 0.7;
    // If no other strong signals, diaper scores get a baseline
    const maxOther = Math.max(scores.hunger, scores.tired, scores.pain, scores.attention);
    if (maxOther < 3.5) scores.diaper += 0.8;
    // ---- ATTENTION ----
    // Intermittent, lower energy, stops and starts, not urgent pitch
    if (cry_burst_ratio < 0.4) scores.attention += 1.5;
    if (onset_rate > 0.2 && onset_rate < 1.5) scores.attention += 1.0;
    if (pitch_mean > 0 && pitch_mean < 380) scores.attention += 0.8;
    if (rms_mean < 0.035) scores.attention += 1.0;
    if (rms_std > 0.015) scores.attention += 0.8; // variable energy = intermittent
    if (zcr_mean < 0.12) scores.attention += 0.5;
    // Normalize to probabilities via softmax
    return softmax(scores);
}
function softmax(scoreObj) {
    const keys = Object.keys(scoreObj);
    const vals = keys.map((k)=>scoreObj[k]);
    const maxVal = Math.max(...vals);
    const exps = vals.map((v)=>Math.exp(v - maxVal));
    const sum = exps.reduce((a, b)=>a + b, 0);
    const result = {};
    keys.forEach((k, i)=>result[k] = exps[i] / sum);
    return result;
}
async function classify(features) {
    let model = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null;
    const heuristic = heuristicClassify(features);
    let tfProbs = null;
    const tf = getTf();
    if (model && tf) {
        try {
            const vec = featuresToVector(features);
            const input = tf.tensor2d([
                vec
            ]);
            const output = model.predict(input);
            const probArray = await output.data();
            tf.dispose([
                input,
                output
            ]);
            tfProbs = {};
            LABELS.forEach((label, i)=>tfProbs[label] = probArray[i]);
        } catch (err) {
            console.warn('[CryModel] TF.js inference failed, using heuristic only:', err);
        }
    }
    // Blend: if model weights present, weight 60/40 model/heuristic
    const probs = {};
    LABELS.forEach((label)=>{
        probs[label] = tfProbs ? 0.6 * tfProbs[label] + 0.4 * heuristic[label] : heuristic[label];
    });
    // Find top prediction
    const sorted = LABELS.slice().sort((a, b)=>probs[b] - probs[a]);
    const topLabel = sorted[0];
    const confidence = Math.round(probs[topLabel] * 100);
    // Determine if signal is strong enough or uncertain
    const secondProb = probs[sorted[1]];
    const margin = probs[topLabel] - secondProb;
    const isUncertain = confidence < 35 || margin < 0.08;
    return {
        label: isUncertain ? 'unknown' : topLabel,
        confidence: isUncertain ? Math.round(confidence * 0.7) : confidence,
        probabilities: probs,
        isUncertain,
        features
    };
}
function featuresToVector(features) {
    const { rms_mean = 0, rms_std = 0, rms_max = 0, pitch_mean = 0, pitch_std = 0, pitch_voiced = 0, centroid_mean = 0, centroid_std = 0, zcr_mean = 0, zcr_std = 0, rhythm_score = 0, onset_rate = 0, cry_burst_ratio = 0, mfcc = [] } = features;
    return [
        rms_mean,
        rms_std,
        rms_max,
        pitch_mean / 1000,
        pitch_std / 500,
        pitch_voiced,
        centroid_mean / 8000,
        centroid_std / 4000,
        zcr_mean,
        zcr_std,
        rhythm_score,
        Math.min(onset_rate / 5, 1),
        cry_burst_ratio,
        // First 12 MFCCs, normalized
        ...Array.from({
            length: 12
        }, (_, i)=>(mfcc[i] || 0) / 100)
    ];
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/i18n.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* =========================================================
   i18n.js — Hushh multi-language support
   Supported: en (English), vi (Vietnamese)
   Usage:  import { t, setLanguage, getLanguage } from './i18n.js';
           t('key')              → translated string
           t('key', {n: 3})     → translated string with {n} replaced
   ========================================================= */ __turbopack_context__.s([
    "SUPPORTED_LANGS",
    ()=>SUPPORTED_LANGS,
    "getLanguage",
    ()=>getLanguage,
    "setLanguage",
    ()=>setLanguage,
    "t",
    ()=>t
]);
const LANGS = {
    en: {
        // ---- Header ----
        tagline: 'Understand what your little one needs',
        'app.sr-title': 'Hushh — on-device AI baby cry analyzer',
        'privacy-badge': '🔒 On-device AI · no audio sent to cloud',
        // ---- Install banner ----
        'install.title': 'Add to Home Screen',
        'install.sub': 'Works offline · instant access',
        'install.btn': 'Install',
        // ---- Model badge ----
        'model.loading': '⏳ Loading on-device model…',
        'model.downloading': '⬇ Syncing community model… {pct}%',
        'model.ready': '🔒 On-device only',
        'model.personalized': 'Personalized model loaded',
        'model.heuristic': 'Ready (acoustic analysis mode)',
        'model.error': '⚠️ Fallback mode',
        // ---- Record ----
        'record.hint.idle': 'Tap the button and hold your phone near the baby',
        'record.btn.idle': 'Record cry',
        'record.btn.stop': 'Tap to stop',
        'record.btn.processing': 'Processing…',
        'record.hint.recording': 'Recording… up to 30 seconds',
        'record.hint.processing': 'Analyzing on-device…',
        'audio-ready.recording': 'Recording ready ({dur}s)',
        // ---- Upload / analyze ----
        or: 'or',
        'upload.btn': 'Upload audio file (.wav · .mp3 · .m4a · .webm)',
        'upload.btn.aria': 'Upload audio file',
        'analyze.btn': '🔍 Analyze cry',
        'analyze.btn.loading': '⏳ Analyzing…',
        'analyze.btn.aria': 'Analyze baby cry',
        // ---- Processing steps ----
        'step.features': 'Extracting acoustic features…',
        'step.classify': 'Running on-device classifier…',
        'step.prepare': 'Preparing results…',
        // ---- Result card ----
        'result.what-to-do': 'What to do',
        'result.signal-breakdown': 'Signal breakdown',
        'result.privacy-note': 'All analysis ran locally on your device. No audio was transmitted anywhere.',
        'result.uncertain': 'Signal was mixed — try recording 5+ seconds with less background noise for a clearer reading.',
        'result.feat.pitch': 'Pitch',
        'result.feat.rhythm': 'Rhythm',
        'result.feat.active-time': 'Active time',
        'result.feat.onset-rate': 'Onset rate',
        'result.confidence': '{pct}% confidence',
        'urgency.label': '{level} urgency',
        'urgency.high': 'Urgent',
        'urgency.medium': 'Moderate',
        'urgency.low': 'Gentle',
        // ---- Need meta — labels ----
        'need.hunger.label': 'Hungry',
        'need.tired.label': 'Sleepy',
        'need.pain.label': 'In pain or discomfort',
        'need.diaper.label': 'Needs a diaper change',
        'need.attention.label': 'Wants attention & comfort',
        'need.unknown.label': 'Unclear',
        // ---- Need meta — tips ----
        'need.hunger.tip.0': 'Offer the breast or a bottle — feeding is the first thing to try',
        'need.hunger.tip.1': 'Check the last feeding time; hunger cries often peak every 2–3 hours',
        'need.hunger.tip.2': 'Watch for rooting reflex: baby turning head and opening mouth',
        'need.hunger.tip.3': 'If formula-fed, prepare a fresh bottle at body temperature',
        'need.hunger.tip.4': 'After feeding, hold upright for 15–20 min to help with gas',
        'need.tired.tip.0': 'Create a calm, dim environment and reduce stimulation',
        'need.tired.tip.1': "Try gentle rocking or swaying — mimics the womb's motion",
        'need.tired.tip.2': 'Swaddle snugly to trigger the calming reflex',
        'need.tired.tip.3': 'White noise (fan, rain sounds) can mask startling stimuli',
        'need.tired.tip.4': 'Watch for sleepy cues: eye-rubbing, yawning, glazed look',
        'need.pain.tip.0': 'Check for any visible irritation: hair tourniquet on toes/fingers, diaper rash, clothing tags',
        'need.pain.tip.1': 'If accompanied by fever (>38 °C / 100.4 °F), contact a doctor promptly',
        'need.pain.tip.2': 'Try gas relief: bicycle legs, tummy massage clockwise, burping positions',
        'need.pain.tip.3': 'Colic-like crying that lasts >3 h/day, >3 days/week warrants medical evaluation',
        'need.pain.tip.4': 'Stay calm and hold baby firmly — your heartbeat soothes',
        'need.diaper.tip.0': 'Check diaper immediately — wet or soiled diapers cause skin irritation quickly',
        'need.diaper.tip.1': 'Clean thoroughly front-to-back and allow air-dry before re-diapering',
        'need.diaper.tip.2': 'Apply barrier cream (zinc oxide) if any redness is present',
        'need.diaper.tip.3': "Ensure diaper fit: snug at waist but two fingers should fit at the tummy",
        'need.diaper.tip.4': "Newborns may need 8–12 changes per day — that's completely normal",
        'need.attention.tip.0': 'Pick up and hold baby — you cannot spoil a newborn with too much holding',
        'need.attention.tip.1': 'Skin-to-skin contact regulates temperature, heart rate, and cortisol',
        'need.attention.tip.2': 'Make eye contact, smile, and talk softly — face recognition is calming',
        'need.attention.tip.3': 'Try a short walk outside; fresh air and gentle movement often help',
        'need.attention.tip.4': 'Offer a (clean) finger or pacifier to satisfy the sucking reflex',
        'need.unknown.tip.0': 'Ensure baby is comfortable and check basic needs first',
        'need.unknown.tip.1': 'Try feeding, then changing, then holding',
        // ---- History ----
        'history.title': 'Recent sessions',
        'history.clear': 'Clear',
        'session-count': '{total} session analyzed on this device',
        'session-count.plural': '{total} sessions analyzed on this device',
        // ---- Feedback ----
        'feedback.question': 'Was this reading correct?',
        'feedback.yes': '✓ Yes, correct',
        'feedback.no': '✗ No, wrong',
        'feedback.picker.initial': 'What was it?',
        'feedback.picker.correct': 'What was it actually?',
        'feedback.saved': 'Saved! {count} of {total} needed to retrain.',
        'feedback.training-start': 'Thanks! Starting training with {count} samples…',
        'feedback.save-error': 'Thanks! (Save failed: {err})',
        // ---- Training panel ----
        'training.title': '🧠 Training on-device…',
        'training.fitting': 'Fitting on your feedback…',
        'training.done-ok': '✓ Model updated — results will improve.',
        'training.done-fail': 'Training failed: {err}',
        'training.worker-error': 'Worker error: {err}',
        'training.epoch': 'Epoch {epoch} / {epochs}',
        // ---- Toasts ----
        'toast.mic-denied': 'Microphone permission denied. Please allow access in your browser settings.',
        'toast.mic-error': 'Could not access microphone: {err}',
        'toast.too-short': 'Recording too short. Please record at least 2 seconds of crying.',
        'toast.not-audio': 'Please select an audio file.',
        'toast.analysis-failed': 'Analysis failed: {err}',
        // ---- iOS install modal ----
        'ios.modal.title': 'Install App on iOS',
        'ios.step1.title': 'Step 1: Tap Share',
        'ios.step1.desc': 'Tap the Share button at the bottom of your browser.',
        'ios.step2.title': 'Step 2: Add to Home Screen',
        'ios.step2.desc': 'Scroll down and tap "Add to Home Screen".',
        'ios.step3.title': 'Step 3: Tap Add',
        'ios.step3.desc': 'Tap "Add" in the top right corner to confirm.',
        'ios.modal.got-it': 'Got it!',
        // ---- Cloud model sync ----
        'cloud.title': 'Community Model',
        'cloud.desc': 'Share your trained model to help other parents. Your audio is never uploaded — only model weights.',
        'cloud.count': '{count} parents contributed',
        'cloud.status.syncing': '🔄 Syncing…',
        'cloud.status.synced': '✓ Model synced',
        'cloud.status.uploading': '⬆ Uploading…',
        'cloud.status.error': '⚠ Sync failed — will retry next session',
        // ---- Share ----
        'share.btn': 'Share with a parent friend',
        'share.text': 'My baby is {need} ({pct}% confidence). Hushh figured it out — free, private, no internet needed 🍼',
        'share.copied': 'Link copied to clipboard!',
        // ---- Feedback ----
        'feedback.footer.btn': '💬 Send feedback',
        'feedback.modal.title': 'Send Feedback',
        'feedback.type.suggestion': '💡 Suggestion',
        'feedback.type.bug': '🐛 Bug',
        'feedback.type.other': '💬 Other',
        'feedback.label': 'What would you like to share?',
        'feedback.submit': 'Submit',
        'feedback.success.msg': '✓ Thank you! Your feedback helps improve Hushh.',
        // ---- Medical disclaimer ----
        'disclaimer.btn': '⚕️ Medical disclaimer',
        'disclaimer.modal.title': '⚕️ Medical Disclaimer',
        'disclaimer.body.intro': 'This app is an assistive tool only and is not a medical device. It uses acoustic heuristics and should not replace parental judgment or medical advice.',
        'disclaimer.body.if': 'If your baby:',
        'disclaimer.symptom.0': 'Cries for more than 3 hours/day',
        'disclaimer.symptom.1': 'Has a fever above 38°C / 100.4°F',
        'disclaimer.symptom.2': 'Appears to be in severe pain',
        'disclaimer.symptom.3': 'Has any other concerning symptoms',
        'disclaimer.body.urgent': 'Please contact a pediatrician or healthcare provider immediately.',
        'disclaimer.got-it': 'Got it'
    },
    vi: {
        // ---- Header ----
        tagline: 'Hiểu điều bé yêu cần',
        'app.sr-title': 'Hushh — phân tích tiếng khóc bé trên thiết bị',
        'privacy-badge': '🔒 AI trên thiết bị · không gửi âm thanh lên đám mây',
        // ---- Install banner ----
        'install.title': 'Thêm vào màn hình chính',
        'install.sub': 'Hoạt động ngoại tuyến · truy cập tức thì',
        'install.btn': 'Cài đặt',
        // ---- Model badge ----
        'model.loading': '⏳ Đang tải mô hình…',
        'model.downloading': '⬇ Đang đồng bộ mô hình… {pct}%',
        'model.ready': '🔒 Chỉ trên thiết bị',
        'model.personalized': 'Đã tải mô hình cá nhân hóa',
        'model.heuristic': 'Sẵn sàng (chế độ phân tích âm thanh)',
        'model.error': '⚠️ Chế độ dự phòng',
        // ---- Record ----
        'record.hint.idle': 'Nhấn nút và giữ điện thoại gần bé',
        'record.btn.idle': 'Ghi tiếng khóc',
        'record.btn.stop': 'Nhấn để dừng',
        'record.btn.processing': 'Đang xử lý…',
        'record.hint.recording': 'Đang ghi… tối đa 30 giây',
        'record.hint.processing': 'Đang phân tích trên thiết bị…',
        'audio-ready.recording': 'Đã ghi xong ({dur}s)',
        // ---- Upload / analyze ----
        or: 'hoặc',
        'upload.btn': 'Tải file âm thanh (.wav · .mp3 · .m4a · .webm)',
        'upload.btn.aria': 'Tải file âm thanh',
        'analyze.btn': '🔍 Phân tích tiếng khóc',
        'analyze.btn.loading': '⏳ Đang phân tích…',
        'analyze.btn.aria': 'Phân tích tiếng khóc của bé',
        // ---- Processing steps ----
        'step.features': 'Đang trích xuất đặc trưng âm thanh…',
        'step.classify': 'Đang chạy bộ phân loại trên thiết bị…',
        'step.prepare': 'Đang chuẩn bị kết quả…',
        // ---- Result card ----
        'result.what-to-do': 'Cần làm gì',
        'result.signal-breakdown': 'Phân tích tín hiệu',
        'result.privacy-note': 'Tất cả phân tích chạy cục bộ trên thiết bị. Không có âm thanh nào được truyền đi.',
        'result.uncertain': 'Tín hiệu không rõ — thử ghi trên 5 giây với ít tiếng ồn nền hơn để có kết quả chính xác hơn.',
        'result.feat.pitch': 'Cao độ',
        'result.feat.rhythm': 'Nhịp điệu',
        'result.feat.active-time': 'Thời gian khóc',
        'result.feat.onset-rate': 'Tần suất khởi phát',
        'result.confidence': 'độ tin cậy {pct}%',
        'urgency.label': 'mức độ {level}',
        'urgency.high': 'khẩn cấp',
        'urgency.medium': 'vừa phải',
        'urgency.low': 'nhẹ nhàng',
        // ---- Need meta — labels ----
        'need.hunger.label': 'Đói bụng',
        'need.tired.label': 'Buồn ngủ',
        'need.pain.label': 'Đau hoặc khó chịu',
        'need.diaper.label': 'Cần thay tã',
        'need.attention.label': 'Muốn được chú ý',
        'need.unknown.label': 'Chưa rõ',
        // ---- Need meta — tips ----
        'need.hunger.tip.0': 'Cho bú hoặc cho uống sữa — đây là điều đầu tiên cần thử',
        'need.hunger.tip.1': 'Kiểm tra lần bú cuối; tiếng khóc đói thường xuất hiện mỗi 2–3 giờ',
        'need.hunger.tip.2': 'Chú ý phản xạ tìm kiếm: bé quay đầu và mở miệng',
        'need.hunger.tip.3': 'Nếu bú bình, chuẩn bị bình sữa mới ở nhiệt độ cơ thể',
        'need.hunger.tip.4': 'Sau khi bú, giữ bé thẳng đứng 15–20 phút để giúp tiêu hóa khí',
        'need.tired.tip.0': 'Tạo môi trường yên tĩnh, ánh sáng mờ và giảm kích thích',
        'need.tired.tip.1': 'Thử đung đưa hoặc ẵm nhẹ — bắt chước chuyển động trong bụng mẹ',
        'need.tired.tip.2': 'Quấn chặt bé để kích hoạt phản xạ bình tĩnh',
        'need.tired.tip.3': 'Tiếng ồn trắng (quạt, tiếng mưa) có thể che khuất những âm thanh gây giật mình',
        'need.tired.tip.4': 'Chú ý dấu hiệu buồn ngủ: dụi mắt, ngáp, ánh mắt mờ nhạt',
        'need.pain.tip.0': 'Kiểm tra kích ứng: tóc quấn quanh ngón chân/tay, hăm tã, nhãn quần áo',
        'need.pain.tip.1': 'Nếu kèm sốt (>38°C / 100.4°F), liên hệ bác sĩ ngay',
        'need.pain.tip.2': 'Thử giảm đau bụng: đạp chân như đạp xe, xoa bụng theo chiều kim đồng hồ, vỗ ợ hơi',
        'need.pain.tip.3': 'Tiếng khóc dạng colic kéo dài >3 giờ/ngày, >3 ngày/tuần cần được khám bác sĩ',
        'need.pain.tip.4': 'Giữ bình tĩnh và ôm bé chắc chắn — nhịp tim của bạn giúp bé an tâm',
        'need.diaper.tip.0': 'Kiểm tra tã ngay — tã ướt hoặc bẩn gây kích ứng da rất nhanh',
        'need.diaper.tip.1': 'Vệ sinh kỹ từ trước ra sau và để khô thoáng trước khi mặc tã mới',
        'need.diaper.tip.2': 'Thoa kem bảo vệ (zinc oxide) nếu da có dấu hiệu đỏ',
        'need.diaper.tip.3': 'Đảm bảo tã vừa vặn: khít ở eo nhưng có thể lồng hai ngón tay vào bụng',
        'need.diaper.tip.4': 'Trẻ sơ sinh có thể cần thay 8–12 tã mỗi ngày — hoàn toàn bình thường',
        'need.attention.tip.0': 'Bế và ôm bé — bé sơ sinh không thể bị hư vì được bồng bế quá nhiều',
        'need.attention.tip.1': 'Tiếp xúc da kề da giúp điều hòa nhiệt độ, nhịp tim và cortisol',
        'need.attention.tip.2': 'Nhìn vào mắt bé, mỉm cười và nói chuyện nhẹ nhàng — nhận ra khuôn mặt sẽ xoa dịu bé',
        'need.attention.tip.3': 'Thử đi dạo ngắn ngoài trời; không khí và chuyển động nhẹ thường giúp ích',
        'need.attention.tip.4': 'Cho bé ngón tay sạch hoặc núm vú giả để thỏa mãn phản xạ bú',
        'need.unknown.tip.0': 'Đảm bảo bé được thoải mái và kiểm tra các nhu cầu cơ bản trước',
        'need.unknown.tip.1': 'Thử cho bú, rồi thay tã, rồi bế bé',
        // ---- History ----
        'history.title': 'Phiên gần đây',
        'history.clear': 'Xóa',
        'session-count': '{total} phiên đã phân tích trên thiết bị này',
        'session-count.plural': '{total} phiên đã phân tích trên thiết bị này',
        // ---- Feedback ----
        'feedback.question': 'Kết quả này có chính xác không?',
        'feedback.yes': '✓ Đúng, chính xác',
        'feedback.no': '✗ Không, sai',
        'feedback.picker.initial': 'Bé đang cần gì?',
        'feedback.picker.correct': 'Thực ra bé đang cần gì?',
        'feedback.saved': 'Đã lưu! {count} trong {total} mẫu cần để huấn luyện lại.',
        'feedback.training-start': 'Cảm ơn! Bắt đầu huấn luyện với {count} mẫu…',
        'feedback.save-error': 'Cảm ơn! (Lưu thất bại: {err})',
        // ---- Training panel ----
        'training.title': '🧠 Đang huấn luyện trên thiết bị…',
        'training.fitting': 'Điều chỉnh theo phản hồi của bạn…',
        'training.done-ok': '✓ Mô hình đã cập nhật — kết quả sẽ cải thiện.',
        'training.done-fail': 'Huấn luyện thất bại: {err}',
        'training.worker-error': 'Lỗi worker: {err}',
        'training.epoch': 'Vòng {epoch} / {epochs}',
        // ---- Toasts ----
        'toast.mic-denied': 'Quyền microphone bị từ chối. Vui lòng cho phép truy cập trong cài đặt trình duyệt.',
        'toast.mic-error': 'Không thể truy cập microphone: {err}',
        'toast.too-short': 'Bản ghi quá ngắn. Vui lòng ghi ít nhất 2 giây tiếng khóc.',
        'toast.not-audio': 'Vui lòng chọn file âm thanh.',
        'toast.analysis-failed': 'Phân tích thất bại: {err}',
        // ---- iOS install modal ----
        'ios.modal.title': 'Cài đặt ứng dụng trên iOS',
        'ios.step1.title': 'Bước 1: Nhấn Chia sẻ',
        'ios.step1.desc': 'Nhấn nút Chia sẻ ở dưới cùng trình duyệt.',
        'ios.step2.title': 'Bước 2: Thêm vào màn hình chính',
        'ios.step2.desc': 'Cuộn xuống và nhấn "Thêm vào màn hình chính".',
        'ios.step3.title': 'Bước 3: Nhấn Thêm',
        'ios.step3.desc': 'Nhấn "Thêm" ở góc trên bên phải để xác nhận.',
        'ios.modal.got-it': 'Hiểu rồi!',
        // ---- Cloud model sync ----
        'cloud.title': 'Mô hình cộng đồng',
        'cloud.desc': 'Chia sẻ mô hình đã huấn luyện để giúp cha mẹ khác. Âm thanh không bao giờ được tải lên — chỉ có trọng số mô hình.',
        'cloud.count': '{count} cha mẹ đã đóng góp',
        'cloud.status.syncing': '🔄 Đang đồng bộ…',
        'cloud.status.synced': '✓ Đã đồng bộ',
        'cloud.status.uploading': '⬆ Đang tải lên…',
        'cloud.status.error': '⚠ Đồng bộ thất bại — sẽ thử lại sau',
        // ---- Share ----
        'share.btn': 'Chia sẻ với bạn bè có con nhỏ',
        'share.text': 'Bé của mình đang {need} ({pct}% độ tin cậy). Hushh phân tích được — miễn phí, riêng tư, không cần internet 🍼',
        'share.copied': 'Đã sao chép liên kết!',
        // ---- Feedback ----
        'feedback.footer.btn': '💬 Gửi phản hồi',
        'feedback.modal.title': 'Gửi Phản Hồi',
        'feedback.type.suggestion': '💡 Góp ý',
        'feedback.type.bug': '🐛 Lỗi',
        'feedback.type.other': '💬 Khác',
        'feedback.label': 'Bạn muốn chia sẻ điều gì?',
        'feedback.submit': 'Gửi',
        'feedback.success.msg': '✓ Cảm ơn bạn! Phản hồi của bạn giúp cải thiện Hushh.',
        // ---- Medical disclaimer ----
        'disclaimer.btn': '⚕️ Tuyên bố y tế',
        'disclaimer.modal.title': '⚕️ Tuyên Bố Y Tế',
        'disclaimer.body.intro': 'Ứng dụng này chỉ là công cụ hỗ trợ và không phải thiết bị y tế. Ứng dụng sử dụng phân tích âm thanh heuristic và không thể thay thế phán đoán của cha mẹ hay lời khuyên từ bác sĩ.',
        'disclaimer.body.if': 'Nếu bé của bạn:',
        'disclaimer.symptom.0': 'Khóc hơn 3 giờ mỗi ngày',
        'disclaimer.symptom.1': 'Sốt trên 38°C / 100.4°F',
        'disclaimer.symptom.2': 'Có vẻ đang đau nghiêm trọng',
        'disclaimer.symptom.3': 'Có bất kỳ triệu chứng đáng lo ngại nào khác',
        'disclaimer.body.urgent': 'Vui lòng liên hệ ngay bác sĩ nhi khoa hoặc nhà cung cấp dịch vụ y tế.',
        'disclaimer.got-it': 'Đã hiểu'
    }
};
const SUPPORTED = [
    'en',
    'vi'
];
function detectLang() {
    var _globalThis_navigator;
    // localStorage can throw (private mode, storage disabled) and doesn't exist in Node
    let saved = null;
    try {
        var _globalThis_localStorage;
        saved = (_globalThis_localStorage = globalThis.localStorage) === null || _globalThis_localStorage === void 0 ? void 0 : _globalThis_localStorage.getItem('hushh-lang');
    } catch (e) {}
    if (saved && SUPPORTED.includes(saved)) return saved;
    const browser = (((_globalThis_navigator = globalThis.navigator) === null || _globalThis_navigator === void 0 ? void 0 : _globalThis_navigator.language) || 'en').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(browser) ? browser : 'en';
}
let _current = detectLang();
function t(key) {
    let vars = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    var _LANGS__current;
    var _LANGS__current_key, _ref;
    const str = (_ref = (_LANGS__current_key = (_LANGS__current = LANGS[_current]) === null || _LANGS__current === void 0 ? void 0 : _LANGS__current[key]) !== null && _LANGS__current_key !== void 0 ? _LANGS__current_key : LANGS.en[key]) !== null && _ref !== void 0 ? _ref : key;
    if (!vars || !Object.keys(vars).length) return str;
    return Object.entries(vars).reduce((s, param)=>{
        let [k, v] = param;
        return s.replaceAll("{".concat(k, "}"), String(v));
    }, str);
}
function setLanguage(lang) {
    if (!SUPPORTED.includes(lang)) return;
    _current = lang;
    try {
        var _globalThis_localStorage;
        (_globalThis_localStorage = globalThis.localStorage) === null || _globalThis_localStorage === void 0 ? void 0 : _globalThis_localStorage.setItem('hushh-lang', lang);
    } catch (e) {}
    if (globalThis.document) document.documentElement.lang = lang;
}
function getLanguage() {
    return _current;
}
const SUPPORTED_LANGS = SUPPORTED;
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/analytics.js [app-client] (ecmascript)", ((__turbopack_context__) => {
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
gaScript.src = "https://www.googletagmanager.com/gtag/js?id=".concat(GA_ID);
document.head.appendChild(gaScript);
function trackEvent(name) {
    let params = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    try {
        gtag('event', name, params);
    } catch (e) {}
} /**
 * Send a Facebook Pixel standard or custom event.
 * Safe to call even when FB is blocked.
 */  // export function trackFBEvent(name, params = {}) {
 //   try { window.fbq('track', name, params); } catch { /* ad blocker */ }
 // }
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/model-cloud.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* =========================================================
   lib/model-cloud.js — Hushh
   Optional anonymous cloud model sync via Supabase Storage.
   No SDK — plain fetch only (works in static export).

   Storage format v2: weights are int8-quantized and
   base64-encoded (~9× smaller than v1 float JSON arrays).
   v1 format is still accepted for backwards compatibility.

   Setup:
   1. Create a Supabase project at https://supabase.com
   2. Go to Storage → New bucket → name it "hushh-models" (private)
   3. Run these policies in the SQL editor:

      CREATE POLICY "anon read"
        ON storage.objects FOR SELECT TO anon
        USING (bucket_id = 'hushh-models');

      CREATE POLICY "anon insert"
        ON storage.objects FOR INSERT TO anon
        WITH CHECK (bucket_id = 'hushh-models');

      CREATE POLICY "anon update"
        ON storage.objects FOR UPDATE TO anon
        USING (bucket_id = 'hushh-models');

   4. In Vercel → Settings → Environment Variables, add:
        NEXT_PUBLIC_SUPABASE_URL      = https://xxxx.supabase.co
        NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...
   ========================================================= */ __turbopack_context__.s([
    "downloadAndMerge",
    ()=>downloadAndMerge,
    "getContributorCount",
    ()=>getContributorCount,
    "isCloudConfigured",
    ()=>isCloudConfigured,
    "isSyncEnabled",
    ()=>isSyncEnabled,
    "setSyncEnabled",
    ()=>setSyncEnabled,
    "uploadAndMerge",
    ()=>uploadAndMerge
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
const SB_URL = ("TURBOPACK compile-time value", "https://yailtfayjxznazxclnsf.supabase.co") || '';
const SB_KEY = ("TURBOPACK compile-time value", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaWx0ZmF5anh6bmF6eGNsbnNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNzYxODEsImV4cCI6MjA5NDc1MjE4MX0.3pPl5220DgaNkrT9WxhvQyusM71MYBgvVF0NFgFOyV4") || '';
// Set > 0 to slow down progress animation for demo/dev visibility.
// Each real network chunk is spread across DEMO_STEPS ticks × DEMO_STEP_MS ms.
// Set to 0 for production (progress reflects actual network speed).
const DEMO_STEP_MS = 0;
const DEMO_STEPS = 20;
const BUCKET = 'hushh-models';
const K_SYNC = 'hushh-cloud-sync';
const K_UID = 'hushh-device-id';
const isCloudConfigured = ()=>!!(SB_URL && SB_KEY);
const isSyncEnabled = ()=>isCloudConfigured() && localStorage.getItem(K_SYNC) === 'true';
const setSyncEnabled = (val)=>localStorage.setItem(K_SYNC, val ? 'true' : 'false');
function getDeviceId() {
    let id = localStorage.getItem(K_UID);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(K_UID, id);
    }
    return id;
}
/* ---- Supabase Storage (REST) ---- */ const sbHeaders = (extra)=>({
        apikey: SB_KEY,
        Authorization: "Bearer ".concat(SB_KEY),
        ...extra
    });
async function storagePut(path, data) {
    const r = await fetch("".concat(SB_URL, "/storage/v1/object/").concat(BUCKET, "/").concat(path), {
        method: 'POST',
        headers: sbHeaders({
            'Content-Type': 'application/json',
            'x-upsert': 'true'
        }),
        body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error("storage upload ".concat(path, ": ").concat(r.status));
}
/**
 * Fetch a Supabase storage object.
 * - Checks Cache API first (stale-while-revalidate):
 *   cached hit → return immediately, revalidate in background.
 *   no cache  → fetch with optional ReadableStream progress, then cache.
 * - onProgress(0..1) is called only during an actual network download.
 */ async function storageGet(path, onProgress) {
    const url = "".concat(SB_URL, "/storage/v1/object/").concat(BUCKET, "/").concat(path);
    if ('caches' in globalThis) {
        try {
            const cache = await caches.open('hushh-models-v1');
            const cached = await cache.match(url);
            if (cached) {
                // Return stale data immediately, refresh cache in background
                _revalidateCache(url, cache).catch(()=>{});
                return cached.json();
            }
        } catch (e) {}
    }
    return _fetchAndCache(url, path, onProgress);
}
async function _revalidateCache(url, cache) {
    // Fire-and-forget: update cache without blocking the caller
    const r = await fetch(url, {
        headers: sbHeaders({})
    });
    if (r.ok) {
        const text = await r.text();
        await cache.put(url, new Response(text, {
            headers: {
                'Content-Type': 'application/json'
            }
        }));
    }
}
async function _fetchAndCache(url, path, onProgress) {
    const r = await fetch(url, {
        headers: sbHeaders({})
    });
    if (r.status === 404) return null;
    if (r.status === 400) {
        const body = await r.json().catch(()=>({}));
        var _body_error, _ref;
        const msg = ((_ref = (_body_error = body === null || body === void 0 ? void 0 : body.error) !== null && _body_error !== void 0 ? _body_error : body === null || body === void 0 ? void 0 : body.message) !== null && _ref !== void 0 ? _ref : '').toLowerCase();
        if (msg.includes('not found')) return null;
        var _body_message, _ref1;
        throw new Error((_ref1 = (_body_message = body === null || body === void 0 ? void 0 : body.message) !== null && _body_message !== void 0 ? _body_message : body === null || body === void 0 ? void 0 : body.error) !== null && _ref1 !== void 0 ? _ref1 : "storage 400: ".concat(path));
    }
    if (!r.ok) throw new Error("storage download ".concat(path, ": ").concat(r.status));
    let text;
    if (onProgress && DEMO_STEP_MS > 0) {
        // Demo mode: Supabase omits Content-Length, so decouple animation from bytes.
        // Fetch and animate in parallel — whichever takes longer determines total wait.
        const animPromise = (async ()=>{
            for(let i = 1; i <= DEMO_STEPS; i++){
                await new Promise((res)=>setTimeout(res, DEMO_STEP_MS));
                onProgress(i / DEMO_STEPS);
            }
        })();
        [text] = await Promise.all([
            r.text(),
            animPromise
        ]);
    } else if (onProgress) {
        const total = parseInt(r.headers.get('content-length') || '0', 10);
        if (r.body && total > 0) {
            // Real streaming progress when content-length is known
            let loaded = 0;
            const reader = r.body.getReader();
            const chunks = [];
            while(true){
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                onProgress(Math.min(loaded / total, 1));
            }
            text = new TextDecoder().decode(_concatChunks(chunks));
        } else {
            // No content-length (common with Supabase) — fetch and snap to 100%
            text = await r.text();
            onProgress(1);
        }
    } else {
        text = await r.text();
    }
    const data = JSON.parse(text);
    if ('caches' in globalThis) {
        caches.open('hushh-models-v1').then((c)=>c.put(url, new Response(text, {
                headers: {
                    'Content-Type': 'application/json'
                }
            }))).catch(()=>{});
    }
    return data;
}
function _concatChunks(chunks) {
    const total = chunks.reduce((s, c)=>s + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks){
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}
/* ---- int8 weight quantization (symmetric, per-tensor) ---- */ // Reduces the Supabase payload ~9× vs storing raw float32 JSON arrays.
function _quantizeWeights(weights) {
    return weights.map((w)=>{
        const arr = w.data;
        let absMax = 0;
        for(let i = 0; i < arr.length; i++){
            const a = Math.abs(arr[i]);
            if (a > absMax) absMax = a;
        }
        const scale = absMax / 127 || 1e-8;
        const q = new Int8Array(arr.length);
        for(let i = 0; i < arr.length; i++){
            q[i] = Math.max(-127, Math.min(127, Math.round(arr[i] / scale)));
        }
        // Encode Int8 bytes as base64 without spread (avoids call-stack limit on large arrays)
        const bytes = new Uint8Array(q.buffer);
        let binary = '';
        for(let i = 0; i < bytes.length; i++)binary += String.fromCharCode(bytes[i]);
        return {
            shape: w.shape,
            b64: btoa(binary),
            scale
        };
    });
}
function _dequantizeWeights(qWeights) {
    return qWeights.map((qw)=>{
        // Accept legacy v1 format (plain float arrays) transparently
        if (Array.isArray(qw.data)) return qw;
        const bytes = Uint8Array.from(atob(qw.b64), (c)=>c.charCodeAt(0));
        const q = new Int8Array(bytes.buffer);
        const data = new Array(q.length);
        for(let i = 0; i < q.length; i++)data[i] = q[i] * qw.scale;
        return {
            shape: qw.shape,
            data
        };
    });
}
/* ---- Weight serialization ---- */ async function serializeWeights(model) {
    // getWeights() returns refs to the model's own tensors — do NOT dispose them
    return Promise.all(model.getWeights().map(async (w)=>({
            shape: w.shape,
            data: Array.from(await w.data())
        })));
}
function applyWeights(model, ws) {
    const tensors = ws.map((w)=>window.tf.tensor(w.data, w.shape));
    model.setWeights(tensors);
    tensors.forEach((t)=>t.dispose());
}
/* Weighted average (FedAvg) of two weight arrays */ function fedAvg(wA, wB, ratioA) {
    return wA.map((la, i)=>{
        const lb = wB[i];
        if (!lb || la.data.length !== lb.data.length) return la;
        return {
            shape: la.shape,
            data: la.data.map((v, j)=>v * ratioA + lb.data[j] * (1 - ratioA))
        };
    });
}
async function getContributorCount() {
    if (!isCloudConfigured()) //TURBOPACK unreachable
    ;
    try {
        const d = await storageGet('models/community.json');
        var _d_contributors;
        return Number((_d_contributors = d === null || d === void 0 ? void 0 : d.contributors) !== null && _d_contributors !== void 0 ? _d_contributors : 0);
    } catch (e) {
        return 0;
    }
}
async function uploadAndMerge(localModel) {
    const uid = getDeviceId();
    const local = await serializeWeights(localModel);
    // Save this device's contribution (for auditing / future re-weighting)
    await storagePut("contributions/".concat(uid, ".json"), {
        weights: local,
        ts: Date.now()
    });
    // Download current community model (v1 or v2)
    const community = await storageGet('models/community.json').catch(()=>null);
    var _community_weights;
    // Normalize to float arrays regardless of storage format
    const communityWeights = (community === null || community === void 0 ? void 0 : community.v) === 2 ? _dequantizeWeights(community.qWeights) : (_community_weights = community === null || community === void 0 ? void 0 : community.weights) !== null && _community_weights !== void 0 ? _community_weights : null;
    // FedAvg: 80% old community + 20% new contribution
    const merged = (communityWeights === null || communityWeights === void 0 ? void 0 : communityWeights.length) === local.length ? fedAvg(communityWeights, local, 0.8) : local; // first-ever contribution becomes the community baseline
    const contributors = (Number(community === null || community === void 0 ? void 0 : community.contributors) || 0) + 1;
    // Publish v2 (quantized) format
    await storagePut('models/community.json', {
        v: 2,
        qWeights: _quantizeWeights(merged),
        contributors,
        ts: Date.now()
    });
}
async function downloadAndMerge(localModel, onProgress) {
    const community = await storageGet('models/community.json', onProgress);
    if (!community) return false;
    // Handle v1 (plain floats) and v2 (quantized) transparently
    const communityWeights = community.v === 2 ? _dequantizeWeights(community.qWeights) : community.weights;
    if (!communityWeights) return false;
    const local = await serializeWeights(localModel);
    if (local.length !== communityWeights.length) return false;
    // The bucket is writable by any anon client — treat downloads as untrusted.
    // A single NaN/Infinity would permanently poison the merged local model.
    if (!_weightsAreSane(communityWeights, local)) return false;
    applyWeights(localModel, fedAvg(local, communityWeights, 0.6));
    return true;
}
/* Every tensor must match the local tensor's size and contain only finite numbers */ function _weightsAreSane(candidate, reference) {
    return candidate.every((w, i)=>{
        const data = w === null || w === void 0 ? void 0 : w.data;
        if (!data || data.length !== reference[i].data.length) return false;
        for(let j = 0; j < data.length; j++){
            if (!Number.isFinite(data[j])) return false;
        }
        return true;
    });
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/app-logic.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* =========================================================
   lib/app-logic.js — Hushh
   Main application controller. Exported init() is called
   by HushhApp.tsx after TF.js has loaded.
   All audio processing and inference happens entirely
   on-device via Web Audio API and TensorFlow.js.
   ========================================================= */ __turbopack_context__.s([
    "init",
    ()=>init
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$audio$2d$analyzer$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/audio-analyzer.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/cry-model.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/i18n.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$analytics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/analytics.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/model-cloud.js [app-client] (ecmascript)");
;
;
;
;
;
// TF.js is a UMD global from CDN. When init() runs via the 20s fallback timer the
// CDN script may still land later, so window.tf must be read lazily at call time.
const getTf = ()=>window.tf;
/* ---- State ---- */ // Allowlists used to validate history entries loaded from localStorage
const VALID_HISTORY_LABELS = new Set([
    'hunger',
    'tired',
    'pain',
    'diaper',
    'attention',
    'unknown'
]);
const COLOR_HEX_RE = /^#[0-9a-fA-F]{3,6}$/;
function sanitizeHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((h)=>{
        var _h_color;
        return h && typeof h === 'object' && VALID_HISTORY_LABELS.has(h.label) && typeof h.confidence === 'number' && COLOR_HEX_RE.test((_h_color = h.color) !== null && _h_color !== void 0 ? _h_color : '');
    });
}
const state = {
    phase: 'idle',
    audioBlob: null,
    mediaRecorder: null,
    audioChunks: [],
    streamAnalyzer: null,
    recordingSeconds: 0,
    timerInterval: null,
    animFrame: null,
    model: null,
    history: sanitizeHistory(JSON.parse(localStorage.getItem('babyCryHistory') || '[]')),
    liveRms: new Array(60).fill(0),
    localSessions: 0,
    lossHistory: [],
    lastResult: null,
    modelStatusKey: 'loading',
    modelStatusMsg: null,
    modelDownloadPct: null
};
const analyzer = new __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$audio$2d$analyzer$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AudioAnalyzer"]();
/* ---- Training Queue (IndexedDB) ---- */ const MIN_TRAIN_SAMPLES = 5;
function openTrainDB() {
    return new Promise((resolve, reject)=>{
        const req = indexedDB.open('hushh-training', 1);
        req.onupgradeneeded = (e)=>e.target.result.createObjectStore('queue', {
                autoIncrement: true
            });
        req.onsuccess = (e)=>resolve(e.target.result);
        req.onerror = ()=>reject(req.error);
    });
}
async function enqueueSample(vector, labelIndex) {
    const db = await openTrainDB();
    return new Promise((resolve, reject)=>{
        const tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').add({
            vector: Array.from(vector),
            labelIndex
        });
        tx.oncomplete = resolve;
        tx.onerror = ()=>reject(tx.error);
    });
}
async function getQueueCount() {
    const db = await openTrainDB();
    return new Promise((resolve, reject)=>{
        const tx = db.transaction('queue', 'readonly');
        const req = tx.objectStore('queue').count();
        req.onsuccess = ()=>resolve(req.result);
        req.onerror = ()=>reject(req.error);
    });
}
async function drainQueue() {
    const db = await openTrainDB();
    return new Promise((resolve, reject)=>{
        const tx = db.transaction('queue', 'readwrite');
        const store = tx.objectStore('queue');
        const records = [];
        store.openCursor().onsuccess = (e)=>{
            const c = e.target.result;
            if (c) {
                records.push(c.value);
                c.delete();
                c.continue();
            } else resolve(records);
        };
        tx.onerror = ()=>reject(tx.error);
    });
}
/* ---- Feedback UI ---- */ function renderFeedback(result) {
    var _el_querySelector, _el_querySelector1;
    const el = document.createElement('div');
    el.className = 'feedback-bar';
    const uncertain = result.label === 'unknown';
    el.innerHTML = '\n    <p class="fb-question">'.concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('feedback.question'), '</p>\n    <div class="fb-btns').concat(uncertain ? ' hidden' : '', '">\n      ').concat(!uncertain ? '<button class="btn-fb btn-fb-yes">'.concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('feedback.yes'), "</button>") : '', '\n      <button class="btn-fb btn-fb-no">').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('feedback.no'), '</button>\n    </div>\n    <div class="label-picker').concat(uncertain ? '' : ' hidden', '">\n      <p class="lp-prompt">').concat(uncertain ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('feedback.picker.initial') : (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('feedback.picker.correct'), '</p>\n      <div class="lp-grid">').concat(__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LABELS"].map((lbl, i)=>{
        const m = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NEED_META"][lbl];
        return '<button class="btn-pick" data-idx="'.concat(i, '" style="--c:').concat(m.color, ";--bg:").concat(m.bgLight, '">').concat(m.icon, "<span>").concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('need.' + lbl + '.label'), "</span></button>");
    }).join(''), '</div>\n    </div>\n    <p class="fb-thanks hidden"></p>\n  ');
    $('resultSection').appendChild(el);
    const btnsEl = el.querySelector('.fb-btns');
    const pickerEl = el.querySelector('.label-picker');
    const thanksEl = el.querySelector('.fb-thanks');
    const dismiss = (msg)=>{
        btnsEl.classList.add('hidden');
        pickerEl.classList.add('hidden');
        thanksEl.textContent = msg;
        thanksEl.classList.remove('hidden');
    };
    const submit = async (labelIndex)=>{
        el.querySelectorAll('button').forEach((b)=>{
            b.disabled = true;
        });
        try {
            await enqueueSample((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["featuresToVector"])(result.features), labelIndex);
            const count = await getQueueCount();
            dismiss(count >= MIN_TRAIN_SAMPLES ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('feedback.training-start', {
                count
            }) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('feedback.saved', {
                count,
                total: MIN_TRAIN_SAMPLES
            }));
            if (count >= MIN_TRAIN_SAMPLES) checkAndTrain();
        } catch (err) {
            dismiss((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('feedback.save-error', {
                err: err.message
            }));
        }
    };
    (_el_querySelector = el.querySelector('.btn-fb-yes')) === null || _el_querySelector === void 0 ? void 0 : _el_querySelector.addEventListener('click', ()=>{
        const idx = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LABELS"].indexOf(result.label);
        if (idx >= 0) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$analytics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trackEvent"])('feedback_submit', {
                label: result.label,
                correct: true
            });
            submit(idx);
        }
    });
    (_el_querySelector1 = el.querySelector('.btn-fb-no')) === null || _el_querySelector1 === void 0 ? void 0 : _el_querySelector1.addEventListener('click', ()=>{
        pickerEl.classList.remove('hidden');
    });
    el.querySelectorAll('.btn-pick').forEach((btn)=>btn.addEventListener('click', ()=>{
            const idx = +btn.dataset.idx;
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$analytics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trackEvent"])('feedback_submit', {
                label: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LABELS"][idx],
                correct: false
            });
            submit(idx);
        }));
}
/* ---- Training Orchestration ---- */ const TRAIN_EPOCHS = 20;
let isTraining = false;
async function checkAndTrain() {
    const tf = getTf();
    if (isTraining || !tf) return;
    let records;
    try {
        records = await drainQueue();
    } catch (e) {
        return;
    }
    if (records.length < MIN_TRAIN_SAMPLES) return;
    isTraining = true;
    showTrainingPanel();
    try {
        let model;
        try {
            model = await tf.loadLayersModel('indexeddb://hushh-model');
        } catch (e) {
            model = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["buildModel"])(records[0].vector.length);
        }
        // Freeze all layers except the output head — prevents catastrophic forgetting on small datasets
        model.layers.forEach((l)=>{
            l.trainable = l.name === 'output';
        });
        model.compile({
            optimizer: tf.train.adam(0.005),
            loss: 'categoricalCrossentropy',
            metrics: [
                'accuracy'
            ]
        });
        const NUM_CLASSES = 5;
        const xs = tf.tensor2d(records.map((r)=>r.vector));
        const ys = tf.tensor2d(records.map((r)=>Array.from({
                length: NUM_CLASSES
            }, (_, k)=>+(k === r.labelIndex))));
        await model.fit(xs, ys, {
            epochs: TRAIN_EPOCHS,
            shuffle: true,
            callbacks: {
                onEpochEnd: (epoch, logs)=>updateTrainingPanel(epoch + 1, TRAIN_EPOCHS, logs.loss)
            }
        });
        tf.dispose([
            xs,
            ys
        ]);
        await model.save('indexeddb://hushh-model');
        model.dispose(); // loadTFModel() reloads a fresh copy into state.model
        finishTrainingPanel((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('training.done-ok'));
        await loadTFModel();
    } catch (err) {
        // Put the samples back so a transient failure doesn't lose user feedback
        for (const r of records){
            try {
                await enqueueSample(r.vector, r.labelIndex);
            } catch (e) {
                break;
            }
        }
        finishTrainingPanel((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('training.done-fail', {
            err: err.message || 'unknown'
        }));
    } finally{
        isTraining = false;
    }
}
function getOrCreatePanel() {
    let p = $('trainingPanel');
    if (!p) {
        p = document.createElement('div');
        p.id = 'trainingPanel';
        p.className = 'training-panel hidden';
        p.innerHTML = '\n      <div class="tp-head">\n        <span class="tp-title">'.concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('training.title'), '</span>\n        <span class="tp-ep" id="tpEp"></span>\n      </div>\n      <div class="tp-track"><div class="tp-fill" id="tpFill"></div></div>\n      <canvas class="tp-loss" id="tpLoss"></canvas>\n      <p class="tp-status" id="tpStatus">').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('training.fitting'), "</p>\n    ");
        document.querySelector('.app-shell').appendChild(p);
    }
    return p;
}
function showTrainingPanel() {
    state.lossHistory = [];
    getOrCreatePanel().classList.remove('hidden');
    $('tpFill').style.width = '0%';
    $('tpStatus').textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('training.fitting');
    $('tpEp').textContent = '';
    $('trainingPanel').scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });
}
function updateTrainingPanel(epoch, epochs, loss) {
    $('tpEp').textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('training.epoch', {
        epoch,
        epochs
    });
    $('tpFill').style.width = "".concat(Math.round(epoch / epochs * 100), "%");
    state.lossHistory.push(loss);
    drawLoss();
}
function finishTrainingPanel(msg) {
    $('tpFill').style.width = '100%';
    $('tpStatus').textContent = msg;
    $('tpEp').textContent = '';
    setTimeout(()=>getOrCreatePanel().classList.add('hidden'), 5000);
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isSyncEnabled"])() && state.model) {
        updateCloudStatus('uploading');
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["uploadAndMerge"])(state.model).then(()=>{
            updateCloudStatus('synced');
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getContributorCount"])();
        }).then(updateContributorCount).catch((err)=>{
            console.warn('[App] Cloud upload:', err.message);
            updateCloudStatus('error');
        });
    }
}
/* ---- Cloud sync UI helpers ---- */ function updateCloudStatus(s) {
    const el = $('cloudSyncStatus');
    const text = $('cloudSyncStatusText');
    if (!el || !text) return;
    const msgs = {
        syncing: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('cloud.status.syncing'),
        synced: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('cloud.status.synced'),
        uploading: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('cloud.status.uploading'),
        error: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('cloud.status.error')
    };
    var _msgs_s;
    text.textContent = (_msgs_s = msgs[s]) !== null && _msgs_s !== void 0 ? _msgs_s : '';
    el.dataset.state = s;
    el.classList.toggle('hidden', !msgs[s]);
}
function updateContributorCount(count) {
    const el = $('cloudContribCount');
    if (!el) return;
    if (count > 0) {
        el.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('cloud.count', {
            count
        });
        el.classList.remove('hidden');
    }
}
function initCloudSyncUI() {
    const card = $('cloudSyncCard');
    const toggle = $('cloudSyncToggle');
    if (!card || !toggle) return;
    card.classList.remove('hidden');
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isCloudConfigured"])()) {
        toggle.disabled = true;
        return;
    }
    toggle.checked = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isSyncEnabled"])();
    // Load contributor count (non-blocking)
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getContributorCount"])().then(updateContributorCount).catch(()=>{});
    toggle.addEventListener('change', (e)=>{
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setSyncEnabled"])(e.target.checked);
        if (e.target.checked && state.model) {
            applyCloudSync(state.model).catch(()=>{});
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getContributorCount"])().then(updateContributorCount).catch(()=>{});
        } else if (!e.target.checked) {
            var _$;
            (_$ = $('cloudSyncStatus')) === null || _$ === void 0 ? void 0 : _$.classList.add('hidden');
        }
    });
}
function drawLoss() {
    const canvas = $('tpLoss');
    if (!canvas || state.lossHistory.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 280, H = 40;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const losses = state.lossHistory;
    const max = Math.max(...losses), min = Math.min(...losses);
    const range = max - min || 0.001;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#d4785a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    losses.forEach((l, i)=>{
        const x = i / (losses.length - 1) * W;
        const y = H - 4 - (l - min) / range * (H - 10);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
}
/* ---- i18n ---- */ function translatePage() {
    document.querySelectorAll('[data-i18n]').forEach((el)=>{
        el.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])(el.dataset.i18n);
    });
}
function applyLang(lang) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setLanguage"])(lang);
    translatePage();
    updateRecordUI();
    updatePrivacyBadge();
    updateAnalyzeBtn(state.phase === 'processing');
    var _state_modelDownloadPct;
    setModelStatus(state.modelStatusKey, state.modelStatusMsg, (_state_modelDownloadPct = state.modelDownloadPct) !== null && _state_modelDownloadPct !== void 0 ? _state_modelDownloadPct : undefined);
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
/* ---- Theme ---- */ const THEME_CYCLE = [
    'system',
    'light',
    'dark'
];
const THEME_ICONS = {
    system: '🌓',
    light: '☀️',
    dark: '🌙'
};
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('hushh-theme', theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = THEME_ICONS[theme];
}
/* ---- DOM refs ---- */ const $ = (id)=>document.getElementById(id);
function init() {
    var _$;
    applyLang((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getLanguage"])());
    // Register all event listeners immediately — UI is fully interactive before model loads
    $('recordBtn').addEventListener('click', toggleRecord);
    $('fileInput').addEventListener('change', handleFileUpload);
    $('analyzeBtn').addEventListener('click', runAnalysis);
    $('uploadTrigger').addEventListener('click', ()=>$('fileInput').click());
    (_$ = $('clearHistoryBtn')) === null || _$ === void 0 ? void 0 : _$.addEventListener('click', clearHistory);
    initCloudSyncUI();
    // Theme toggle — sync icon with current state, then cycle on click
    const themeBtn = $('themeToggle');
    if (themeBtn) {
        var _THEME_ICONS_document_documentElement_dataset_theme;
        themeBtn.textContent = (_THEME_ICONS_document_documentElement_dataset_theme = THEME_ICONS[document.documentElement.dataset.theme]) !== null && _THEME_ICONS_document_documentElement_dataset_theme !== void 0 ? _THEME_ICONS_document_documentElement_dataset_theme : THEME_ICONS.system;
        themeBtn.addEventListener('click', ()=>{
            const cur = document.documentElement.dataset.theme || 'system';
            applyTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length]);
        });
    }
    // Language toggle — cycle through supported languages
    const langBtn = $('langToggle');
    if (langBtn) {
        langBtn.addEventListener('click', ()=>{
            const cur = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getLanguage"])();
            const next = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SUPPORTED_LANGS"][(__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SUPPORTED_LANGS"].indexOf(cur) + 1) % __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SUPPORTED_LANGS"].length];
            applyLang(next);
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$analytics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trackEvent"])('language_change', {
                language: next
            });
        });
    }
    // Auto-start record if deep-linked
    if (new URLSearchParams(location.search).get('action') === 'record') {
        setTimeout(()=>startRecording(), 800);
    }
    // Defer model load until the browser has a free moment — keeps first paint snappy
    const doLoad = ()=>loadTFModel().catch(console.warn);
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(doLoad, {
            timeout: 2000
        });
    } else {
        setTimeout(doLoad, 0);
    }
}
/* ---- TF.js model load ---- */ async function loadTFModel() {
    const tf = getTf();
    if (!tf) {
        state.model = null;
        setModelStatus('ready', 'model.heuristic');
        console.log('[App] TF.js unavailable — using heuristic analysis');
        return;
    }
    let statusKey;
    const oldModel = state.model;
    try {
        setModelStatus('loading');
        const loaded = await Promise.race([
            tf.loadLayersModel('indexeddb://hushh-model'),
            new Promise((_, reject)=>setTimeout(()=>reject(new Error('IndexedDB timeout')), 8000))
        ]);
        state.model = loaded;
        statusKey = 'model.personalized';
        console.log('[App] Loaded saved TF.js model from IndexedDB');
    } catch (e) {
        try {
            state.model = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["buildModel"])(25);
        } catch (e) {
            state.model = null;
        }
        statusKey = 'model.heuristic';
        console.log('[App] Using heuristic analysis (no trained weights yet)');
    }
    // Free the tensors of the model we just replaced (e.g. reload after training)
    if (oldModel && oldModel !== state.model) {
        try {
            oldModel.dispose();
        } catch (e) {}
    }
    // App is immediately usable — parents can record and analyze now
    setModelStatus('ready', statusKey);
    // Blend community model weights in the background; restore badge when done
    if (state.model && (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isSyncEnabled"])()) {
        const onProgress = (pct)=>setModelStatus('downloading', null, pct);
        applyCloudSync(state.model, onProgress).finally(()=>setModelStatus('ready', statusKey));
    }
}
/* Download community model and blend into model in-place; persist merged weights to IndexedDB */ async function applyCloudSync(model, onProgress) {
    updateCloudStatus('syncing');
    try {
        const applied = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$model$2d$cloud$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["downloadAndMerge"])(model, onProgress);
        if (applied) {
            try {
                await model.save('indexeddb://hushh-model');
            } catch (e) {}
            updateCloudStatus('synced');
            return;
        }
    } catch (e) {
        console.warn('[App] Cloud sync:', e.message);
        updateCloudStatus('error');
    }
}
function setModelStatus(status, msgKey, pct) {
    state.modelStatusKey = status;
    state.modelStatusMsg = msgKey !== null && msgKey !== void 0 ? msgKey : null;
    state.modelDownloadPct = pct !== null && pct !== void 0 ? pct : null;
    const badge = $('modelBadge');
    if (!badge) return;
    if (pct !== undefined) {
        badge.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('model.downloading', {
            pct: Math.round(pct * 100)
        });
        badge.dataset.status = 'loading';
    } else {
        badge.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])(msgKey !== null && msgKey !== void 0 ? msgKey : 'model.' + status);
        badge.dataset.status = status;
    }
}
/* ---- Recording ---- */ async function toggleRecord() {
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
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: true
            }
        });
        state.audioChunks = [];
        state.recordingSeconds = 0;
        state.phase = 'recording';
        state.audioBlob = null;
        state.liveRms = new Array(60).fill(0);
        // Live waveform analyzer
        state.streamAnalyzer = analyzer.createStreamAnalyzer(stream);
        // MediaRecorder for capture
        const mimeType = getSupportedMimeType();
        state.mediaRecorder = new MediaRecorder(stream, {
            mimeType
        });
        state.mediaRecorder.ondataavailable = (e)=>{
            if (e.data.size > 0) state.audioChunks.push(e.data);
        };
        state.mediaRecorder.onstop = ()=>{
            stream.getTracks().forEach((t)=>t.stop());
            state.audioBlob = new Blob(state.audioChunks, {
                type: mimeType
            });
            onRecordingComplete();
        };
        state.mediaRecorder.start(100);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$analytics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trackEvent"])('recording_start');
        // UI updates
        updateRecordUI();
        startTimer();
        startWaveformAnimation();
    } catch (err) {
        console.error('[App] Mic error:', err);
        showToast(err.name === 'NotAllowedError' ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('toast.mic-denied') : (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('toast.mic-error', {
            err: err.message
        }), 'error');
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
    return types.find((mime)=>MediaRecorder.isTypeSupported(mime)) || '';
}
function onRecordingComplete() {
    const dur = state.recordingSeconds;
    if (dur < 2) {
        showToast((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('toast.too-short'), 'warn');
        state.phase = 'idle';
        updateRecordUI();
        return;
    }
    state.phase = 'idle';
    updateRecordUI();
    setAudioReady((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('audio-ready.recording', {
        dur
    }));
    $('analyzeBtn').disabled = false;
}
/* ---- Timer ---- */ function startTimer() {
    $('timerDisplay').textContent = '0:00';
    state.timerInterval = setInterval(()=>{
        state.recordingSeconds++;
        $('timerDisplay').textContent = formatTime(state.recordingSeconds);
        if (state.recordingSeconds >= 30) stopRecording();
    }, 1000);
}
function formatTime(s) {
    return "".concat(Math.floor(s / 60), ":").concat(String(s % 60).padStart(2, '0'));
}
/* ---- Waveform animation ---- */ function startWaveformAnimation() {
    const canvas = $('waveCanvas');
    const ctx = canvas.getContext('2d');
    function draw() {
        if (state.phase !== 'recording') return;
        state.animFrame = requestAnimationFrame(draw);
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.clientWidth;
        const H = canvas.clientHeight;
        // Resizing a canvas resets and reallocates it — only do so when dimensions change
        if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
            canvas.width = W * dpr;
            canvas.height = H * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        if (!state.streamAnalyzer) return;
        const rms = state.streamAnalyzer.getRms();
        // Rolling RMS bars
        state.liveRms.push(rms);
        if (state.liveRms.length > 60) state.liveRms.shift();
        const barW = W / state.liveRms.length;
        state.liveRms.forEach((r, i)=>{
            const h = Math.max(2, r * H * 8);
            const alpha = 0.4 + i / state.liveRms.length * 0.6;
            ctx.fillStyle = "rgba(212, 120, 90, ".concat(alpha, ")");
            ctx.beginPath();
            ctx.roundRect(i * barW, (H - h) / 2, barW - 2, h, 2);
            ctx.fill();
        });
    }
    draw();
}
/* ---- File Upload ---- */ function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    // video/mp4 and video/quicktime cover .m4a files on iOS — same MPEG-4 container as audio/mp4
    const isAudio = file.type.startsWith('audio/') || file.type === 'video/mp4' || file.type === 'video/quicktime';
    if (!isAudio) {
        showToast((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('toast.not-audio'), 'error');
        return;
    }
    state.audioBlob = file;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$analytics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trackEvent"])('file_upload');
    setAudioReady(file.name);
    $('analyzeBtn').disabled = false;
    state.recordingSeconds = 0;
}
/* ---- Analysis ---- */ async function runAnalysis() {
    if (!state.audioBlob) return;
    state.phase = 'processing';
    updateAnalyzeBtn(true);
    $('resultSection').classList.add('hidden');
    try {
        showProcessingStep((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('step.features'));
        const features = await analyzer.blobToFeatures(state.audioBlob);
        showProcessingStep((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('step.classify'));
        const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["classify"])(features, state.model);
        showProcessingStep((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('step.prepare'));
        await new Promise((r)=>setTimeout(r, 300)); // brief pause for UX
        renderResult(result);
        renderFeedback(result);
        saveToHistory(result);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$analytics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trackEvent"])('analysis_complete', {
            need: result.label,
            confidence: result.confidence,
            uncertain: result.isUncertain
        });
        // trackFBEvent('ViewContent', { content_name: result.label });
        state.phase = 'result';
        state.localSessions++;
        updateSessionCount();
    } catch (err) {
        console.error('[App] Analysis error:', err);
        showToast((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('toast.analysis-failed', {
            err: err.message
        }), 'error');
        state.phase = 'idle';
    } finally{
        updateAnalyzeBtn(false);
    }
}
function showProcessingStep(msg) {
    const el = $('processingStep');
    if (el) el.textContent = msg;
}
/* ---- Render result ---- */ function renderResult(result) {
    var // Share button
    _document_getElementById;
    state.lastResult = result;
    const meta = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NEED_META"][result.label] || {
        icon: '🤔',
        color: '#888',
        bgLight: '#f5f5f5',
        urgency: 'low'
    };
    const urgencyColors = {
        high: '#e24b4a',
        medium: '#f4a940',
        low: '#4caf92'
    };
    const displayLabel = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('need.' + result.label + '.label');
    const urgencyLevel = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('urgency.' + meta.urgency);
    const probBars = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LABELS"].map((lbl)=>{
        const m = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NEED_META"][lbl];
        const pct = Math.round((result.probabilities[lbl] || 0) * 100);
        return '\n      <div class="prob-row">\n        <span class="prob-label">'.concat(m.icon, " ").concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('need.' + lbl + '.label'), '</span>\n        <div class="prob-bar-track">\n          <div class="prob-bar-fill" style="width:').concat(pct, "%;background:").concat(m.color, '" data-pct="').concat(pct, '"></div>\n        </div>\n        <span class="prob-pct">').concat(pct, "%</span>\n      </div>");
    }).join('');
    const tipCount = result.label === 'unknown' ? 2 : 5;
    const tipsHtml = Array.from({
        length: tipCount
    }, (_, i)=>'<li class="tip-item"><span class="tip-dot" style="background:'.concat(meta.color, '"></span>').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('need.' + result.label + '.tip.' + i), "</li>")).join('');
    $('resultSection').innerHTML = '\n    <div class="result-card animate-in" style="--accent-color:'.concat(meta.color, ";--accent-bg:").concat(meta.bgLight, '">\n\n      <div class="result-hero">\n        <div class="result-icon-wrap" style="background:').concat(meta.bgLight, '">\n          <span class="result-icon">').concat(meta.icon, '</span>\n        </div>\n        <div class="result-hero-text">\n          <h2 class="result-title">').concat(displayLabel, '</h2>\n          <div class="result-badges">\n            <span class="badge" style="background:').concat(meta.bgLight, ";color:").concat(meta.color, '">\n              ').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('result.confidence', {
        pct: result.confidence
    }), '\n            </span>\n            <span class="badge urgency-badge" style="background:').concat(urgencyColors[meta.urgency], "1a;color:").concat(urgencyColors[meta.urgency], '">\n              ').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('urgency.label', {
        level: urgencyLevel
    }), "\n            </span>\n          </div>\n        </div>\n      </div>\n\n      ").concat(result.isUncertain ? '\n        <div class="uncertain-notice">\n          <span>💡</span>\n          <span>'.concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('result.uncertain'), "</span>\n        </div>\n      ") : '', '\n\n      <div class="section-block">\n        <div class="section-label">').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('result.what-to-do'), '</div>\n        <ul class="tips-list">').concat(tipsHtml, '</ul>\n      </div>\n\n      <details class="details-block">\n        <summary>').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('result.signal-breakdown'), '</summary>\n        <div class="prob-bars">').concat(probBars, '</div>\n        <div class="feature-grid">\n          <div class="feat-cell">\n            <span class="feat-name">').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('result.feat.pitch'), '</span>\n            <span class="feat-val">').concat(Math.round(result.features.pitch_mean), ' Hz</span>\n          </div>\n          <div class="feat-cell">\n            <span class="feat-name">').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('result.feat.rhythm'), '</span>\n            <span class="feat-val">').concat(Math.round(result.features.rhythm_score * 100), '%</span>\n          </div>\n          <div class="feat-cell">\n            <span class="feat-name">').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('result.feat.active-time'), '</span>\n            <span class="feat-val">').concat(Math.round(result.features.cry_burst_ratio * 100), '%</span>\n          </div>\n          <div class="feat-cell">\n            <span class="feat-name">').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('result.feat.onset-rate'), '</span>\n            <span class="feat-val">').concat(result.features.onset_rate.toFixed(1), '/s</span>\n          </div>\n        </div>\n      </details>\n\n      <div class="privacy-note">\n        <span>🔒</span> ').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('result.privacy-note'), '\n      </div>\n\n      <div class="share-row">\n        <button class="share-btn" id="shareResultBtn" type="button">\n          🔗 ').concat((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('share.btn'), "\n        </button>\n      </div>\n    </div>\n  ");
    $('resultSection').classList.remove('hidden');
    $('resultSection').scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });
    // Animate probability bars
    requestAnimationFrame(()=>{
        document.querySelectorAll('.prob-bar-fill').forEach((bar)=>{
            const pct = bar.dataset.pct;
            bar.style.width = '0%';
            requestAnimationFrame(()=>{
                bar.style.transition = 'width 0.7s ease';
                bar.style.width = pct + '%';
            });
        });
    });
    (_document_getElementById = document.getElementById('shareResultBtn')) === null || _document_getElementById === void 0 ? void 0 : _document_getElementById.addEventListener('click', async ()=>{
        const shareText = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('share.text', {
            need: displayLabel,
            pct: result.confidence
        });
        const shareUrl = window.location.origin;
        try {
            if (navigator.share) {
                await navigator.share({
                    title: 'Hushh',
                    text: shareText,
                    url: shareUrl
                });
            } else {
                await navigator.clipboard.writeText("".concat(shareText, "\n").concat(shareUrl));
                showToast((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('share.copied'), 'info');
            }
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$analytics$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trackEvent"])('share', {
                label: result.label,
                method: navigator.share ? 'native' : 'clipboard'
            });
        } catch (e) {}
    });
}
/* ---- History ---- */ function saveToHistory(result) {
    const meta = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cry$2d$model$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NEED_META"][result.label] || {};
    const entry = {
        label: result.label,
        icon: meta.icon || '🤔',
        color: meta.color || '#888',
        confidence: result.confidence,
        time: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        }),
        date: new Date().toLocaleDateString([], {
            month: 'short',
            day: 'numeric'
        })
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
        section === null || section === void 0 ? void 0 : section.classList.add('hidden');
        return;
    }
    section === null || section === void 0 ? void 0 : section.classList.remove('hidden');
    container.textContent = '';
    state.history.forEach((h, i)=>{
        const item = document.createElement('div');
        item.className = 'history-item';
        item.style.animationDelay = "".concat(i * 0.05, "s");
        const icon = document.createElement('span');
        icon.className = 'h-icon';
        icon.textContent = h.icon;
        const info = document.createElement('div');
        info.className = 'h-info';
        const lbl = document.createElement('span');
        lbl.className = 'h-label';
        lbl.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('need.' + h.label + '.label');
        const time = document.createElement('span');
        time.className = 'h-time';
        time.textContent = "".concat(h.date, " · ").concat(h.time);
        const conf = document.createElement('span');
        conf.className = 'h-confidence';
        conf.style.color = COLOR_HEX_RE.test(h.color) ? h.color : '#888';
        conf.textContent = "".concat(h.confidence, "%");
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
/* ---- UI helpers ---- */ function updateRecordUI() {
    const btn = $('recordBtn');
    const label = $('recordBtnLabel');
    const hint = $('recordHint');
    btn.setAttribute('aria-pressed', state.phase === 'recording' ? 'true' : 'false');
    if (state.phase === 'recording') {
        btn.classList.add('recording');
        btn.querySelector('.mic-icon').textContent = '⏹';
        label.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('record.btn.stop');
        hint.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('record.hint.recording');
        $('waveSection').classList.remove('hidden');
    } else if (state.phase === 'processing') {
        btn.classList.remove('recording');
        btn.querySelector('.mic-icon').textContent = '⏳';
        label.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('record.btn.processing');
        hint.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('record.hint.processing');
    } else {
        btn.classList.remove('recording');
        btn.querySelector('.mic-icon').textContent = '🎙';
        label.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('record.btn.idle');
        hint.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('record.hint.idle');
        if (state.phase !== 'result') $('waveSection').classList.add('hidden');
        $('timerDisplay').textContent = '';
    }
}
function setAudioReady(msg) {
    const el = $('audioReadyMsg');
    if (el) {
        el.textContent = '✓ ' + msg;
        el.classList.remove('hidden');
    }
}
function updateAnalyzeBtn(loading) {
    const btn = $('analyzeBtn');
    if (loading) {
        btn.disabled = true;
        btn.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('analyze.btn.loading');
    } else {
        btn.disabled = !state.audioBlob;
        btn.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('analyze.btn');
    }
}
function updatePrivacyBadge() {
    const el = $('privacyBadge');
    if (el) el.textContent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('privacy-badge');
}
function showSessionCount(total) {
    const el = $('sessionCount');
    if (!el || total <= 0) return;
    el.classList.remove('hidden');
    el.textContent = total === 1 ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('session-count', {
        total
    }) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$i18n$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["t"])('session-count.plural', {
        total
    });
}
function updateSessionCount() {
    const total = parseInt(localStorage.getItem('totalSessions') || '0', 10) + 1;
    localStorage.setItem('totalSessions', String(total));
    showSessionCount(total);
}
function renderSessionCount() {
    showSessionCount(parseInt(localStorage.getItem('totalSessions') || '0', 10));
}
function showToast(msg) {
    let type = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 'info';
    const toast = document.createElement('div');
    toast.className = "toast toast-".concat(type);
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(()=>toast.classList.add('visible'));
    setTimeout(()=>{
        toast.classList.remove('visible');
        setTimeout(()=>toast.remove(), 400);
    }, 4000);
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=lib_926f3234._.js.map