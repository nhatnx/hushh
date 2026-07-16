import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LABELS, NEED_META, heuristicClassify, classify, featuresToVector,
} from '../lib/cry-model.js';

const painFeatures = {
  pitch_mean: 620, pitch_std: 90, pitch_voiced: 0.8,
  rms_mean: 0.09, rms_std: 0.04, rms_max: 0.3,
  zcr_mean: 0.2, zcr_std: 0.05,
  centroid_mean: 3500, centroid_std: 700,
  rhythm_score: 0.1, onset_rate: 3.5, cry_burst_ratio: 0.7,
  mfcc: new Array(13).fill(0),
};

test('featuresToVector produces the 25-dimensional layout', () => {
  const vec = featuresToVector(painFeatures);
  assert.equal(vec.length, 25);
  assert.ok(vec.every(Number.isFinite));
});

test('featuresToVector tolerates missing fields', () => {
  const vec = featuresToVector({});
  assert.equal(vec.length, 25);
  assert.ok(vec.every(v => v === 0));
});

test('heuristicClassify returns a probability distribution over all labels', () => {
  const probs = heuristicClassify(painFeatures);
  assert.deepEqual(Object.keys(probs).sort(), [...LABELS].sort());
  const sum = Object.values(probs).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `probabilities sum to ${sum}`);
  assert.ok(Object.values(probs).every(p => p >= 0 && p <= 1));
});

test('heuristicClassify ranks pain highest for a pain-fingerprint cry', () => {
  const probs = heuristicClassify(painFeatures);
  const top = LABELS.reduce((a, b) => (probs[a] >= probs[b] ? a : b));
  assert.equal(top, 'pain');
});

test('classify() without a TF model falls back to the heuristic', async () => {
  const result = await classify(painFeatures, null);
  assert.ok(LABELS.includes(result.label) || result.label === 'unknown');
  assert.equal(typeof result.confidence, 'number');
  assert.equal(typeof result.isUncertain, 'boolean');
  assert.equal(result.features, painFeatures);
});

test('every label has display metadata', () => {
  for (const label of LABELS) {
    const meta = NEED_META[label];
    assert.ok(meta?.icon && meta?.color && meta?.bgLight && meta?.urgency, label);
  }
});
