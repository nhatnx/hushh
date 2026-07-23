# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hushh** is a baby cry analyzer — a Progressive Web App that classifies infant vocalizations (hunger, pain, fatigue, etc.) entirely on-device. No audio ever leaves the device. Built with **Next.js 15** (App Router, static export) + React 19.

## Commands

```bash
npm install          # install deps — use npm, not pnpm (pnpm-lock.yaml is for build only)
npm run dev          # dev server with Turbopack at https://localhost:3000 (--experimental-https)
npm test             # zero-dependency unit tests (node --test) for lib/ pure logic
node --test test/audio-analyzer.test.mjs   # run a single test file
npm run typecheck    # tsc --noEmit
npm run icons        # generate-icons.cjs → public/icons/icon-192.png, icon-512.png
                     # (the `canvas` devDependency exists only for this script)
```

```bash
pnpm run build       # static export to out/ (Turbopack; pnpm-lock.yaml ships with repo)
```

The dev server runs over **HTTPS** (`--experimental-https`) so `getUserMedia` works when testing from other devices on the LAN (allowed dev origins are listed in `next.config.js`). Next.js auto-generates certificates into `certificates/` — that directory and `assets/` (marketing media) are gitignored local artifacts.

Tests live in `test/*.test.mjs` and use Node's built-in `node:test` runner — no test dependencies. They cover the pure logic in `lib/` (audio-analyzer DSP, cry-model heuristics/vector layout, i18n). `lib/package.json` (`{"type":"module"}`) exists solely so Node can import the ESM `lib/*.js` files in tests; Next.js bundles them regardless. There is no ESLint configuration — only SonarLint (project: `nhatnx_hushh`). `tsconfig.json` has `strict: false` and `allowJs: true`, so `.js` files in `lib/` are included but loosely typed.

**Note for Windows:** The `Collecting page data` build phase calls `fs.readlink()` on module files. On NTFS with non-standard reparse-point behavior, this returns EISDIR for regular files — a Node.js/Windows bug. **Vercel builds on Linux where this does not occur.** To deploy: push to Git and let Vercel build. Local `npm run dev` is unaffected.

HTTPS is required in production for `getUserMedia`; localhost is exempt.

## Architecture

```text
app/
  layout.tsx        HTML shell, meta tags, theme + install-prompt inline scripts
  page.tsx          Renders <HushhApp>
  globals.css       Design system (CSS custom properties, warm theme)

components/
  HushhApp.tsx      Client component — JSX structure, TF.js loader, SW registration,
                    install banner (Android + iOS), disclaimer/feedback modals,
                    global JS error reporting to GA4

lib/
  app-logic.js      Main controller (state machine, recording, UI, training). Exports init().
  audio-analyzer.js AudioAnalyzer class — acoustic feature extraction
  cry-model.js      TF.js model definition + heuristic classifier
  model-cloud.js    Optional anonymous cloud model sync via Supabase Storage (plain fetch, no SDK)
  i18n.js           Translation dictionaries (en, vi) + t() helper
  analytics.js      GA4 + Facebook Pixel initialization and trackEvent()

public/
  sw.js             Service worker — offline caching (Next.js-aware, see below)
  train-worker.js   Legacy Web Worker artifact — NOT used by the Next.js app (see below)
  manifest.json     PWA manifest (installable, portrait lock, shortcuts)
  models/
    hushh-base.json Metadata descriptor of the model architecture (NOT TF.js weights —
                    nothing in lib/ loads it; it is only precached by sw.js)
  icons/            PWA icons (192 and 512)
```

### Legacy artifacts

`index.html` at the repo root and `public/train-worker.js` are leftovers from the pre-Next.js plain-HTML version and are **not part of the active app** — the canonical source is under `app/`, `lib/`, `components/`, and `public/`. Do not edit them or wire them in.

### TF.js loading

TF.js is loaded as a UMD global via `<Script strategy="afterInteractive">` (with SRI integrity hash) in `HushhApp.tsx`. Both `onLoad` and `onError` call `initApp()`, which dynamically imports `lib/app-logic.js` and calls `init()` exactly once (guarded by a ref) — so the app starts whether the CDN succeeds or fails. **Do not add an ESM import of TF.js** (`tf.esm.js` does not exist in 4.17.0's dist). Both `app-logic.js` and `cry-model.js` resolve it **lazily per call** via a `getTf()` helper — never capture `const tf = window.tf` at module scope, because when `init()` runs via the 20 s fallback timer the CDN script can still arrive later, and a module-scope capture would permanently see `undefined`.

If TF.js fires neither `onLoad` nor `onError` within 20 s (slow network, blocked CDN), a fallback timer in `HushhApp.tsx` starts the app in heuristic-only mode anyway.

The TF.js version (4.17.0) is pinned in **three places that must change together** when upgrading: the script `src` URL and its SRI `integrity` hash in `HushhApp.tsx`, and the version-pinned `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/` path in the `script-src` CSP directive in `vercel.json`. Missing the CSP update blocks the script in production only.

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
2. **TF.js neural net** (`buildModel`): 2-layer dense network (64→32→5 softmax). Only contributes when personalized weights exist in IndexedDB (`indexeddb://hushh-model`). Blended 60/40 (model/heuristic) when available.

Classes: `hunger`, `tired`, `pain`, `diaper`, `attention`. Result marked uncertain when top confidence < 35% or margin to second class < 8 pp.

### App State Machine (lib/app-logic.js)

`state.phase` drives all UI: `idle → recording → processing → result`. Key flows:

- **Recording**: `getUserMedia` → `MediaRecorder` (webm/opus preferred) + `createStreamAnalyzer` for live waveform → auto-stop at 30 s
- **Analysis**: `blobToFeatures` → `classify` → `renderResult` (includes a share button — `navigator.share` with clipboard fallback) → `saveToHistory` (localStorage key `babyCryHistory`, max 10 entries)
- **Model boot**: deferred via `requestIdleCallback` (2 s timeout) to keep first paint snappy. Tries `indexeddb://hushh-model` (8 s timeout); falls back to fresh `buildModel(25)` (heuristic-only mode). The app is usable immediately — if cloud sync is enabled, community weights are blended in the background afterwards, with download progress shown in the model badge.

The component (`HushhApp.tsx`) renders the HTML structure as JSX and never re-renders after mount (no state/props). All dynamic UI updates are direct DOM manipulation inside `app-logic.js`, which is safe since React never triggers a re-render. Interactive elements whose attributes browser extensions may mutate carry `suppressHydrationWarning`.

### app/layout.tsx inline scripts

Two `dangerouslySetInnerHTML` scripts run before React hydrates:

1. **Theme restore** — reads `localStorage('hushh-theme')` and sets `document.documentElement.dataset.theme` immediately, preventing a flash of wrong theme on first paint.
2. **`beforeinstallprompt` capture** — the PWA install event fires during initial HTML parse, before `useEffect` runs. The inline script saves it to `window.__hushhInstallEvent`; `HushhApp.tsx` picks it up on mount. If you move this to `useEffect`, Android Chrome users will miss the prompt.

The `<link rel="manifest">` is also hardcoded in `<head>` (not via `metadata.manifest`) because Next.js 15 injects metadata via RSC streaming after JS loads — Chrome requires the manifest link in initial HTML to detect PWA installability.

iOS never fires `beforeinstallprompt`, so `HushhApp.tsx` detects iOS (including iPadOS 13+ masquerading as "Macintosh" — checked via `maxTouchPoints`) and shows the install banner manually; tapping it opens a step-by-step "Add to Home Screen" modal instead of a programmatic prompt.

### On-device Fine-tuning (lib/app-logic.js)

Training runs on the **main thread** inside `app-logic.js` (not in a Web Worker). The flow:

- User feedback enqueues a `{ vector, labelIndex }` sample to IndexedDB (`hushh-training` store)
- Once 5+ samples queue up (`MIN_TRAIN_SAMPLES`), `checkAndTrain()` drains the queue and runs `model.fit()`
- Only the output head (`l.name === 'output'`, 160 params) is trained — prevents catastrophic forgetting on small datasets
- Trained weights are saved back to `indexeddb://hushh-model`

`public/train-worker.js` is a legacy artifact (uses `importScripts`, saves to `indexeddb://hushh-model`) and is **not imported by the Next.js app**.

### Cloud Model Sync (lib/model-cloud.js)

Optional anonymous federated learning via **Supabase Storage** — no SDK, plain `fetch` only (required for static export).

- `uploadAndMerge(model)` — saves this device's weights to `contributions/{deviceId}.json`, FedAvgs them 80/20 into the community model, increments contributor count, uploads to `models/community.json`
- `downloadAndMerge(model, onProgress)` — downloads community model and blends into local model 60/40 (local-heavy); caller persists back to IndexedDB
- **Storage format v2**: weights are int8-quantized (symmetric, per-tensor) and base64-encoded — ~9× smaller than the v1 float-array format, which is still accepted on read
- Downloads go through the **Cache API** (`hushh-models-v1` cache) with stale-while-revalidate: cached weights return instantly and refresh in the background. `onProgress(0..1)` fires only on real network downloads
- `DEMO_STEP_MS` in model-cloud.js (normally 0) artificially slows the progress animation for demos — keep it 0 in production
- Device identity is a random UUID in `localStorage` (`hushh-device-id`)
- The cloud sync UI card is hidden in `HushhApp.tsx`; `app-logic.js` shows it only when env vars are present

**Required env vars** (set in Vercel → Settings → Environment Variables; for local dev put them in `.env.local` at the repo root — gitignored). All are `NEXT_PUBLIC_*` and therefore inlined at build time by the static export — changing them requires a rebuild (or dev-server restart), not just a redeploy of the same build:

```text
NEXT_PUBLIC_SUPABASE_URL      = https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...

NEXT_PUBLIC_FEEDBACK_FORM_URL      = https://docs.google.com/forms/d/e/FORM_ID/formResponse
NEXT_PUBLIC_FEEDBACK_ENTRY_MESSAGE = entry.XXXXXXXXXX
NEXT_PUBLIC_FEEDBACK_ENTRY_TYPE    = entry.YYYYYYYYYY
```

The `FEEDBACK_*` vars power the in-app feedback modal (posts to a Google Form via `no-cors` fetch). To get the entry IDs: open the Google Form, right-click → Inspect → submit a test response and look for `entry.` field names in the network request body.

Supabase Storage bucket name: `hushh-models` (private). Required SQL policies: anon read, insert, update on `storage.objects` for `bucket_id = 'hushh-models'` (full SQL in the model-cloud.js header comment).

### Service Worker (public/sw.js)

The cache name is versioned **per build**: `HushhApp.tsx` registers `/sw.js?v=${NEXT_PUBLIC_BUILD_ID}` (build id generated in `next.config.js`), and `sw.js` reads the version from its own query string (`self.location.search`) — so every deploy is automatically a new SW, no manual version bump needed. This query-param indirection is required because files in `public/` are copied verbatim by the static export — they are never bundled, so `process.env.*` / `NEXT_PUBLIC_*` references in `sw.js` (or `train-worker.js`) are not substituted and would throw `ReferenceError: process is not defined` at SW evaluation, silently breaking registration.

**Update flow (user-prompted, not automatic):** the SW does **not** call `skipWaiting()` on install — a new SW parks in `waiting`. `HushhApp.tsx` detects this (`reg.waiting` on load, plus `updatefound`/`statechange`, guarded by `navigator.serviceWorker.controller` so the first install never prompts) and reveals the `#updateBanner`. Tapping Update posts `SKIP_WAITING` to the waiting SW; it activates, deletes old caches, and broadcasts `SW_UPDATED`, which reloads every open tab. `reg.update()` is also called on `visibilitychange` so long-lived installed-PWA sessions still discover updates. On activate, old caches are deleted **except `hushh-models-v1`** (community model weights, managed by model-cloud.js via the Cache API — don't wipe it in the SW cleanup). Caching strategies by asset type:

- **Navigation (HTML)**: network-first (ensures users always get the latest deploy)
- **Next.js chunks** `/_next/static/`: cache-first (immutable content hashes)
- **TF.js CDN** (`cdn.jsdelivr.net`): cache-first (versioned URL, immutable)
- **Other same-origin assets**: stale-while-revalidate

Sends `{ type: 'SW_UPDATED' }` to all clients when a new SW activates (updates only, not first install — detected via leftover old caches), triggering a page reload via the listener in `HushhApp.tsx`.

### CSP (vercel.json)

Production ships a strict Content-Security-Policy from `vercel.json`. If you add a new external endpoint (analytics, CDN, form target), you must also add it to the appropriate CSP directive there or requests will be silently blocked in production while working fine in dev.

## Key Domain Concepts

- **Vocalization types**: hunger (Neh — tongue-palate reflex), pain (Heh), fatigue (Owh — yawn reflex), discomfort/diaper (Eair), attention
- **Acoustic fingerprints**: pain → pitch > 450 Hz, high ZCR, sharp onsets; hunger → rhythmic (high rhythm score), 280–500 Hz; tired → lower pitch, low burst ratio, fewer onsets
- **Feature vector**: 25 dimensions — see `featuresToVector()` in `lib/cry-model.js` for the exact layout
