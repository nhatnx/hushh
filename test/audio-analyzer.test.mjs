import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioAnalyzer } from '../lib/audio-analyzer.js';

const SR = 44100;

function sine(freq, seconds, sampleRate = SR) {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

test('analyze() detects the pitch of a pure tone', () => {
  const analyzer = new AudioAnalyzer(SR);
  const { pitch_mean } = analyzer.analyze(sine(440, 1));
  assert.ok(Math.abs(pitch_mean - 440) < 5, `expected ~440 Hz, got ${pitch_mean}`);
});

test('analyze() rejects audio shorter than one frame', () => {
  const analyzer = new AudioAnalyzer(SR);
  assert.throws(() => analyzer.analyze(new Float32Array(100)), /too short/);
});

test('RMS of a full-scale sine is ~1/sqrt(2)', () => {
  const analyzer = new AudioAnalyzer(SR);
  const rms = analyzer._rms(sine(440, 2048 / SR));
  assert.ok(Math.abs(rms - Math.SQRT1_2) < 0.01, `got ${rms}`);
});

test('magnitude spectrum peaks at the tone frequency bin', () => {
  const analyzer = new AudioAnalyzer(SR);
  const frame = sine(440, 2048 / SR).slice(0, 2048);
  const mag = analyzer._magnitude(frame);
  let peakBin = 0;
  for (let k = 1; k < mag.length; k++) if (mag[k] > mag[peakBin]) peakBin = k;
  const peakHz = (peakBin * SR) / 2048;
  assert.ok(Math.abs(peakHz - 440) < SR / 2048 + 1, `peak at ${peakHz} Hz`);
});

test('mel filter bank is cached per bin count', () => {
  const analyzer = new AudioAnalyzer(SR);
  const a = analyzer._melFilterBank(1024);
  const b = analyzer._melFilterBank(1024);
  assert.equal(a, b, 'expected the same cached instance');
  assert.equal(a.length, analyzer.melBands);
});

test('feature extraction produces finite aggregate values', () => {
  const analyzer = new AudioAnalyzer(SR);
  const f = analyzer.analyze(sine(350, 0.5));
  for (const key of ['rms_mean', 'zcr_mean', 'centroid_mean', 'rhythm_score', 'onset_rate', 'cry_burst_ratio']) {
    assert.ok(Number.isFinite(f[key]), `${key} = ${f[key]}`);
  }
  assert.equal(f.mfcc.length, analyzer.numMFCC);
  assert.ok(f.mfcc.every(Number.isFinite));
});
