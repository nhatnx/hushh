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
   ========================================================= */

export class AudioAnalyzer {
  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.frameSize = 2048;
    this.hopSize = 512;
    this.melBands = 26;
    this.numMFCC = 13;
    this._melBankCache = new Map(); // numBins → filter bank (identical for every frame)
  }

  /* ----------------------------------------------------------
     Main entry point: analyze a Float32Array of PCM samples
     Returns a feature vector ready for the classifier
  ---------------------------------------------------------- */
  analyze(samples) {
    if (samples.length < this.frameSize) {
      throw new Error('Audio too short — need at least ' + this.frameSize + ' samples');
    }

    // Split into overlapping frames
    const frames = this._frame(samples);

    // Per-frame features
    const rmsArr       = frames.map(f => this._rms(f));
    const zcrArr       = frames.map(f => this._zcr(f));
    const mags         = frames.map(f => this._magnitude(f));
    const centroidArr  = mags.map(m => this._spectralCentroid(m));
    const pitchArr     = frames.map(f => this._pitch(f));
    const mfccMatrix   = mags.map(m => this._mfcc(m));

    // Aggregate statistics
    const features = {
      // Energy
      rms_mean:      this._mean(rmsArr),
      rms_std:       this._std(rmsArr),
      rms_max:       Math.max(...rmsArr),

      // Pitch
      pitch_mean:    this._mean(pitchArr.filter(p => p > 0)),
      pitch_std:     this._std(pitchArr.filter(p => p > 0)),
      pitch_voiced:  pitchArr.filter(p => p > 80).length / pitchArr.length,

      // Brightness
      centroid_mean: this._mean(centroidArr),
      centroid_std:  this._std(centroidArr),

      // Roughness
      zcr_mean:      this._mean(zcrArr),
      zcr_std:       this._std(zcrArr),

      // Rhythm
      rhythm_score:  this._rhythmScore(rmsArr),
      onset_rate:    this._onsetRate(rmsArr),
      cry_burst_ratio: this._cryBurstRatio(rmsArr),

      // MFCCs (mean of each coefficient)
      mfcc: this._colMeans(mfccMatrix),

      // Duration stats
      total_frames: frames.length,
      active_frames: rmsArr.filter(r => r > 0.01).length
    };

    return features;
  }

  /* ----------------------------------------------------------
     Analyze a MediaRecorder Blob → Float32Array via OfflineAudioContext
  ---------------------------------------------------------- */
  async blobToFeatures(blob) {
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
  ---------------------------------------------------------- */
  createStreamAnalyzer(stream) {
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
      getFrame: () => {
        analyser.getFloatTimeDomainData(buffer);
        return Float32Array.from(buffer);
      },
      getFrequency: () => {
        analyser.getByteFrequencyData(freqBuffer);
        return Uint8Array.from(freqBuffer);
      },
      // Cheap per-animation-frame reading — O(n), no FFT
      getRms: () => {
        analyser.getFloatTimeDomainData(buffer);
        return this._rms(buffer);
      },
      getInstantFeatures: () => {
        analyser.getFloatTimeDomainData(buffer);
        const frame = Float32Array.from(buffer);
        return {
          rms: this._rms(frame),
          zcr: this._zcr(frame),
          centroid: this._spectralCentroid(this._magnitude(frame)),
          pitch: this._pitch(frame)
        };
      },
      stop: () => {
        source.disconnect();
        ctx.close();
      }
    };
  }

  /* ----------------------------------------------------------
     Private helpers
  ---------------------------------------------------------- */

  _mixToMono(audioBuffer) {
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const mono = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const ch = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += ch[i] / channels;
    }
    return mono;
  }

  _frame(samples) {
    const frames = [];
    for (let i = 0; i + this.frameSize <= samples.length; i += this.hopSize) {
      frames.push(samples.slice(i, i + this.frameSize));
    }
    return frames;
  }

  _rms(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / frame.length);
  }

  _zcr(frame) {
    let crossings = 0;
    for (let i = 1; i < frame.length; i++) {
      if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) crossings++;
    }
    return crossings / frame.length;
  }

  _spectralCentroid(mag) {
    let weightedSum = 0, totalMag = 0;
    for (let k = 0; k < mag.length; k++) {
      weightedSum += k * mag[k];
      totalMag += mag[k];
    }
    if (totalMag === 0) return 0;
    return (weightedSum / totalMag) * (this.sampleRate / this.frameSize);
  }

  /* McLeod Pitch Method via FFT-based autocorrelation — O(n log n) */
  _pitch(frame) {
    const n = frame.length;
    const fftSize = n * 2; // zero-pad to get linear (not circular) autocorrelation

    // r[tau] = IFFT(|FFT(x)|²)[tau]
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    for (let i = 0; i < n; i++) real[i] = frame[i];

    this._fft(real, imag);
    for (let k = 0; k < fftSize; k++) {
      real[k] = real[k] * real[k] + imag[k] * imag[k];
      imag[k] = 0;
    }
    this._fft(real, imag);
    // IFFT via forward FFT: r[tau] = real[(fftSize - tau) & (fftSize-1)] / fftSize

    // Prefix sums of x² allow O(1) NSDF normalization: m[tau] = sqSum[n-tau] + sqSum[n] - sqSum[tau]
    const sqSum = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) sqSum[i + 1] = sqSum[i] + frame[i] * frame[i];

    const acfAt  = tau => real[(fftSize - tau) & (fftSize - 1)] / fftSize;
    const nsdfAt = tau => {
      const m = sqSum[n - tau] + sqSum[n] - sqSum[tau];
      return m === 0 ? 0 : 2 * acfAt(tau) / m;
    };

    // Only search lags that correspond to infant-cry frequencies (60–1200 Hz)
    const tauMin = Math.floor(this.sampleRate / 1200); // ~37 samples
    const tauMax = Math.min(Math.ceil(this.sampleRate / 60), n - 1); // ~735 samples

    let maxNsdf = -Infinity, maxTau = -1;
    let inPositive = false;

    for (let tau = 1; tau <= tauMax; tau++) {
      const nsdf = nsdfAt(tau);
      if (nsdf > 0) inPositive = true;
      if (inPositive && tau >= tauMin && nsdf > 0.8) {
        if (nsdf > maxNsdf) { maxNsdf = nsdf; maxTau = tau; }
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
    return (freq >= 60 && freq <= 1200) ? freq : 0;
  }

  _magnitude(frame) {
    const n = frame.length;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      real[i] = frame[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    }
    this._fft(real, imag);
    const half = n / 2;
    const mag = new Float32Array(half);
    for (let k = 0; k < half; k++) {
      mag[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
    }
    return mag;
  }

  // Cooley-Tukey radix-2 DIT FFT (in-place). O(n log n) vs O(n²) naive DFT.
  _fft(real, imag) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = real[i]; real[i] = real[j]; real[j] = t;
        t = imag[i]; imag[i] = imag[j]; imag[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      const hlen = len >> 1;
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        for (let j = 0; j < hlen; j++) {
          const uRe = real[i + j], uIm = imag[i + j];
          const vRe = real[i + j + hlen] * curRe - imag[i + j + hlen] * curIm;
          const vIm = real[i + j + hlen] * curIm + imag[i + j + hlen] * curRe;
          real[i + j]        = uRe + vRe;
          imag[i + j]        = uIm + vIm;
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
    const melEnergies = melFilters.map(filter => {
      let e = 0;
      for (let k = 0; k < mag.length; k++) e += mag[k] * filter[k];
      return Math.log(e + 1e-10);
    });

    // DCT-II
    const mfcc = new Array(this.numMFCC);
    for (let n = 0; n < this.numMFCC; n++) {
      let sum = 0;
      for (let m = 0; m < this.melBands; m++) {
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
    const melPoints = Array.from({ length: this.melBands + 2 }, (_, i) =>
      melMin + i * (melMax - melMin) / (this.melBands + 1)
    );
    const hzPoints = melPoints.map(m => this._mel2hz(m));
    const binPoints = hzPoints.map(f => Math.round(f * this.frameSize / this.sampleRate));

    return Array.from({ length: this.melBands }, (_, m) => {
      const filter = new Float32Array(numBins);
      for (let k = binPoints[m]; k < binPoints[m + 1]; k++) {
        filter[k] = (k - binPoints[m]) / (binPoints[m + 1] - binPoints[m]);
      }
      for (let k = binPoints[m + 1]; k < binPoints[m + 2]; k++) {
        filter[k] = (binPoints[m + 2] - k) / (binPoints[m + 2] - binPoints[m + 1]);
      }
      return filter;
    });
  }

  _hz2mel(hz) { return 2595 * Math.log10(1 + hz / 700); }
  _mel2hz(mel) { return 700 * (Math.pow(10, mel / 2595) - 1); }

  /* Rhythm: autocorrelation of energy envelope to detect periodicity */
  _rhythmScore(rmsArr) {
    const n = Math.min(rmsArr.length, 128);
    const arr = rmsArr.slice(0, n);
    const mean = this._mean(arr);
    const centered = arr.map(v => v - mean);

    let acf0 = centered.reduce((s, v) => s + v * v, 0);
    if (acf0 === 0) return 0;

    let maxAcf = 0;
    for (let lag = 2; lag < n / 2; lag++) {
      let acf = 0;
      for (let i = 0; i + lag < n; i++) acf += centered[i] * centered[i + lag];
      maxAcf = Math.max(maxAcf, acf / acf0);
    }
    return Math.max(0, Math.min(1, maxAcf));
  }

  /* How many cry bursts per second */
  _onsetRate(rmsArr) {
    const threshold = this._mean(rmsArr) + 0.5 * this._std(rmsArr);
    let onsets = 0;
    let wasAbove = false;
    for (const r of rmsArr) {
      const above = r > threshold;
      if (above && !wasAbove) onsets++;
      wasAbove = above;
    }
    // frames are hopSize / sampleRate seconds each
    const durationSec = rmsArr.length * (this.hopSize / this.sampleRate);
    return durationSec > 0 ? onsets / durationSec : 0;
  }

  /* Fraction of time actively crying vs silent */
  _cryBurstRatio(rmsArr) {
    const threshold = 0.015;
    return rmsArr.filter(r => r > threshold).length / rmsArr.length;
  }

  _mean(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  _std(arr) {
    if (!arr || arr.length < 2) return 0;
    const m = this._mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  }

  _colMeans(matrix) {
    if (matrix.length === 0) return new Array(this.numMFCC).fill(0);
    const means = new Array(matrix[0].length).fill(0);
    for (const row of matrix) row.forEach((v, i) => means[i] += v / matrix.length);
    return means;
  }
}
