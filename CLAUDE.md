# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hushh** is a baby cry analyzer — a Progressive Web App that classifies infant vocalizations (hunger, pain, fatigue, etc.) entirely on-device. No audio ever leaves the device. The entire app is vanilla HTML/CSS/JS with no build step.

## Running Locally

HTTPS or `localhost` is required for `getUserMedia` (microphone access):

```bash
# Python (zero install)
python3 -m http.server 8080

# Node.js
npx serve .
```

Open `http://localhost:8080` in a browser. The service worker and PWA install banner only activate on HTTPS in production.

## Generating Icons

```bash
npm install canvas
node generate-icons.cjs
# Outputs icons/icon-192.png and icons/icon-512.png
```

There is no other build step, `npm run dev`, or test suite.

## Architecture

The app is five plain ES modules — no bundler, no framework:

```
index.html          PWA shell; loads TF.js from CDN, then app.js as a module
style.css           Single design system (CSS custom properties, warm theme)
app.js              Main controller: state machine, recording, UI, history
audio-analyzer.js   AudioAnalyzer class — all acoustic feature extraction
cry-model.js        TF.js model definition + heuristic classifier
sw.js               Service worker — cache-first offline strategy
manifest.json       PWA manifest (installable, portrait lock, shortcuts)
```

### TF.js loading

TF.js is loaded as a UMD global via `<script src="...tf.min.js">` in `index.html`. **Do not add an ESM import of TF.js** (`tf.esm.js` does not exist in 4.17.0's dist). Both `app.js` and `cry-model.js` access it as `const tf = window.tf`.

### Audio Pipeline

`AudioAnalyzer` (audio-analyzer.js) processes raw PCM via Web Audio API:
- **Frame/hop**: 2048 samples / 512 hop at 44 100 Hz
- **Features extracted per frame**: RMS energy, ZCR, spectral centroid, pitch (McLeod Pitch Method), 13 MFCCs via mel filter bank + DCT-II
- **Aggregated stats**: mean/std/max + rhythm score (autocorrelation of energy envelope), onset rate, cry burst ratio
- **Output**: a 25-dimensional feature vector passed to the classifier

Magnitude spectrum is computed once per frame via `_magnitude()` (Cooley-Tukey radix-2 FFT in `_fft()`) and passed to both `_spectralCentroid()` and `_mfcc()`. Do not call `_magnitude()` inside those methods — it would reintroduce an O(n²) bottleneck.

`_pitch()` also uses FFT-based autocorrelation (zero-padded to 4096, two FFT passes + prefix-sum normalization). Do not revert it to the direct NSDF nested loop — that is O(n²) per frame and will hang the main thread.

`blobToFeatures()` decodes a recorded `Blob` via `OfflineAudioContext`; `createStreamAnalyzer()` wraps a live `MediaStream` for real-time waveform visualization.

### Classifier (cry-model.js)

Two-stage classification:
1. **Heuristic** (`heuristicClassify`): rule-based scoring on acoustic features, grounded in infant cry research. Always runs.
2. **TF.js neural net** (`buildModel`): 2-layer dense network (64→32→5 softmax). Only contributes when personalized weights exist in IndexedDB (`indexeddb://baby-cry-model`). Blended 60/40 (model/heuristic) when available.

Classes: `hunger`, `tired`, `pain`, `diaper`, `attention`. Result marked uncertain when top confidence < 35% or margin to second class < 8 pp.

### App State Machine (app.js)

`state.phase` drives all UI: `idle → recording → processing → result`. Key flows:
- **Recording**: `getUserMedia` → `MediaRecorder` (webm/opus preferred) + `createStreamAnalyzer` for live waveform → auto-stop at 30 s
- **Analysis**: `blobToFeatures` → `classify` → `renderResult` → `saveToHistory` (localStorage, max 10 entries)
- **Model boot**: tries `indexeddb://baby-cry-model`; falls back to `buildModel()` (heuristic-only mode)

### Service Worker (sw.js)

Cache name versioned as `baby-cry-v1.x`. Upgrade the version string when deploying changes to force cache invalidation. Local assets use cache-first with network fallback; TF.js CDN assets use cache-first (large, stable files).

## Key Domain Concepts

- **Vocalization types**: hunger (Neh — tongue-palate reflex), pain (Heh), fatigue (Owh — yawn reflex), discomfort/diaper (Eair), attention
- **Acoustic fingerprints**: pain → pitch > 450 Hz, high ZCR, sharp onsets; hunger → rhythmic (high rhythm score), 280–500 Hz; tired → lower pitch, low burst ratio, fewer onsets
- **On-device fine-tuning**: call `model.fit(xs, ys)` then `model.save('indexeddb://baby-cry-model')` to persist personalized weights across sessions without any server

## Code Quality

SonarLint is configured (project: `nhatnx_hushh`) — see [.vscode/settings.json](.vscode/settings.json).
