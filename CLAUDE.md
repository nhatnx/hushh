# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hushh** is a baby cry analyzer — a Progressive Web App that classifies infant vocalizations (hunger, pain, fatigue, etc.) entirely on-device. No audio ever leaves the device. Built with **Next.js 15** (App Router, static export) + React 19. Business logic is bundled and minified — not directly viewable as source.

## Running Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. HTTPS is required in production for `getUserMedia`; localhost is exempt.

## Build & Deploy

```bash
pnpm run build   # generates out/ (static export)
```

**Note for Windows:** The `Collecting page data` build phase calls `fs.readlink()` on module files. On certain Windows drives (NTFS with non-standard reparse-point behavior), this returns EISDIR for regular files — a Node.js/Windows bug. **Vercel builds on Linux where this does not occur.** To deploy: push to Git and let Vercel build in its cloud environment. Local `pnpm run dev` is unaffected and works normally.

## Generating Icons

```bash
npm run icons   # runs generate-icons.cjs → public/icons/icon-192.png, icon-512.png
```

## Architecture

```
app/
  layout.tsx        HTML shell, meta tags, theme inline script
  page.tsx          Renders <HushhApp>
  globals.css       Design system (CSS custom properties, warm theme)

components/
  HushhApp.tsx      Client component — JSX structure + loads TF.js via <Script onLoad>

lib/
  app-logic.js      Main controller (state machine, recording, UI). Exports init().
  audio-analyzer.js AudioAnalyzer class — acoustic feature extraction
  cry-model.js      TF.js model definition + heuristic classifier
  i18n.js           Translation dictionaries (en, vi) + t() helper
  analytics.js      GA4 + Facebook Pixel initialization and trackEvent()

public/
  sw.js             Service worker — cache-first offline strategy (Next.js-aware)
  train-worker.js   Web Worker for on-device model fine-tuning
  manifest.json     PWA manifest (installable, portrait lock, shortcuts)
  icons/            PWA icons (192 and 512)
```

### TF.js loading

TF.js is loaded as a UMD global via `<Script strategy="afterInteractive" onLoad={...}>` in `HushhApp.tsx`. The `onLoad` callback dynamically imports `lib/app-logic.js` and calls `init()`, ensuring `window.tf` is always defined before any app code runs. **Do not add an ESM import of TF.js** (`tf.esm.js` does not exist in 4.17.0's dist). Both `app-logic.js` and `cry-model.js` access it as `const tf = window.tf`.

### Audio Pipeline

`AudioAnalyzer` (lib/audio-analyzer.js) processes raw PCM via Web Audio API:
- **Frame/hop**: 2048 samples / 512 hop at 44 100 Hz
- **Features extracted per frame**: RMS energy, ZCR, spectral centroid, pitch (McLeod Pitch Method), 13 MFCCs via mel filter bank + DCT-II
- **Aggregated stats**: mean/std/max + rhythm score (autocorrelation of energy envelope), onset rate, cry burst ratio
- **Output**: a 25-dimensional feature vector passed to the classifier

Magnitude spectrum is computed once per frame via `_magnitude()` (Cooley-Tukey radix-2 FFT in `_fft()`) and passed to both `_spectralCentroid()` and `_mfcc()`. Do not call `_magnitude()` inside those methods — it would reintroduce an O(n²) bottleneck.

`_pitch()` also uses FFT-based autocorrelation (zero-padded to 4096, two FFT passes + prefix-sum normalization). Do not revert it to the direct NSDF nested loop — that is O(n²) per frame and will hang the main thread.

`blobToFeatures()` decodes a recorded `Blob` via `OfflineAudioContext`; `createStreamAnalyzer()` wraps a live `MediaStream` for real-time waveform visualization.

### Classifier (lib/cry-model.js)

Two-stage classification:
1. **Heuristic** (`heuristicClassify`): rule-based scoring on acoustic features, grounded in infant cry research. Always runs.
2. **TF.js neural net** (`buildModel`): 2-layer dense network (64→32→5 softmax). Only contributes when personalized weights exist in IndexedDB (`indexeddb://baby-cry-model`). Blended 60/40 (model/heuristic) when available.

Classes: `hunger`, `tired`, `pain`, `diaper`, `attention`. Result marked uncertain when top confidence < 35% or margin to second class < 8 pp.

### App State Machine (lib/app-logic.js)

`state.phase` drives all UI: `idle → recording → processing → result`. Key flows:
- **Recording**: `getUserMedia` → `MediaRecorder` (webm/opus preferred) + `createStreamAnalyzer` for live waveform → auto-stop at 30 s
- **Analysis**: `blobToFeatures` → `classify` → `renderResult` → `saveToHistory` (localStorage, max 10 entries)
- **Model boot**: tries `indexeddb://baby-cry-model`; falls back to `buildModel()` (heuristic-only mode)

The component (`HushhApp.tsx`) renders the HTML structure as JSX and never re-renders after mount (no state/props). All dynamic UI updates are direct DOM manipulation inside `app-logic.js`, which is safe since React never triggers a re-render.

### Service Worker (public/sw.js)

Cache name versioned as `hushh-v2.x`. Upgrade the version string when deploying changes to force cache invalidation. Handles three asset types: TF.js CDN (cache-first), Next.js hashed chunks `/_next/static/` (cache-first, immutable), and all other same-origin assets (cache-first with network fallback).

## Key Domain Concepts

- **Vocalization types**: hunger (Neh — tongue-palate reflex), pain (Heh), fatigue (Owh — yawn reflex), discomfort/diaper (Eair), attention
- **Acoustic fingerprints**: pain → pitch > 450 Hz, high ZCR, sharp onsets; hunger → rhythmic (high rhythm score), 280–500 Hz; tired → lower pitch, low burst ratio, fewer onsets
- **On-device fine-tuning**: call `model.fit(xs, ys)` then `model.save('indexeddb://baby-cry-model')` to persist personalized weights across sessions without any server

## Code Quality

SonarLint is configured (project: `nhatnx_hushh`) — see [.vscode/settings.json](.vscode/settings.json).
