# 🍼 Hushh - Baby Cry Analyzer — PWA

> **100% on-device.** No audio ever leaves the user's phone.

A Progressive Web App that analyzes a baby's cry using the **Web Audio API** and **TensorFlow.js**, running entirely in the browser with zero cloud dependency.

---

## Privacy Architecture

```
User's Phone
┌─────────────────────────────────────────────────┐
│  Microphone → Web Audio API → AudioAnalyzer.js  │
│       ↓                                          │
│  Acoustic Features (pitch, rhythm, MFCCs…)      │
│       ↓                                          │
│  cry-model.js (TF.js + heuristic classifier)    │
│       ↓                                          │
│  Result displayed on screen                      │
│                                                  │
│  ✗ No network requests for audio                 │
│  ✗ No API keys required                          │
│  ✗ No analytics or tracking                      │
│  ✓ History stored in localStorage only           │
└─────────────────────────────────────────────────┘
```

---

## File Structure

```
baby-cry-pwa/
├── index.html          # PWA shell — semantic HTML, ARIA labels
├── style.css           # Full design system (warm organic theme)
├── app.js              # Main controller — recording, UI, history
├── audio-analyzer.js   # On-device acoustic feature extraction
│                         (pitch via MPM, MFCCs, rhythm, ZCR, etc.)
├── cry-model.js        # TF.js model + heuristic classifier
│                         (5 classes: hunger, tired, pain, diaper, attention)
├── sw.js               # Service worker — offline support, cache
├── manifest.json       # PWA manifest — installable on Android/iOS
├── generate-icons.js   # Node script to generate PNG icons
└── icons/
    ├── icon-192.png    # PWA icon (generate or replace manually)
    └── icon-512.png
```

---

## How to Deploy

### Option A — Serve locally (development)
```bash
# Python (no install needed)
python3 -m http.server 8080

# Or Node.js
npx serve .

# Open https://localhost:8080
# Note: HTTPS or localhost required for getUserMedia
```

### Option B — Static hosting (production)
Deploy the folder to any static host:
- **Netlify**: drag-and-drop the folder at app.netlify.com
- **Vercel**: `npx vercel --prod`
- **GitHub Pages**: push to a repo, enable Pages
- **Firebase Hosting**: `firebase deploy`

> **HTTPS is required** for microphone access on mobile browsers.

---

## Generate Icons

```bash
npm install canvas
node generate-icons.js
```

Or replace `icons/icon-192.png` and `icons/icon-512.png` manually with your own 192×192 and 512×512 PNG images.

---

## How the Classifier Works

The analyzer extracts these acoustic features per recording:

| Feature | Relevance |
|---------|-----------|
| **Pitch (F0)** via McLeod Pitch Method | Pain > 450 Hz; hunger 280–500 Hz; tired < 300 Hz |
| **Rhythm score** (autocorrelation) | Hunger is periodic; pain has sharp irregular bursts |
| **Zero-crossing rate** | Higher in pain/discomfort (turbulent airflow) |
| **Spectral centroid** | Pain cries are "brighter" (higher frequency energy) |
| **Cry burst ratio** | Tired: more pauses; hunger fills time continuously |
| **Onset rate** | Pain: sudden starts; attention: gentle, intermittent |
| **13 MFCCs** | Timbral texture — nasal vs breathy vs tense quality |

These features feed a **TensorFlow.js neural network** (2 dense layers + dropout) with a **heuristic fallback** based on published infant cry research:
- Lester & Boukydis (1992) — *Infant Crying*
- Várallyay (2008) — *Baby cry recognition in the presence of noise*
- Muller et al. (2019) — *Deep learning for baby cry classification*

### Improving Accuracy Over Time

The TF.js model architecture (`cry-model.js → buildModel()`) is ready for fine-tuning. To train on your own labeled data:

```js
import * as tf from 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.esm.js';
import { buildModel, featuresToVector, LABELS } from './cry-model.js';

// Build and compile
const model = buildModel(25);

// Prepare training data (features + one-hot labels)
const xs = tf.tensor2d(featureVectors);  // shape [N, 25]
const ys = tf.tensor2d(oneHotLabels);    // shape [N, 5]

// Train locally — no server needed
await model.fit(xs, ys, {
  epochs: 50,
  validationSplit: 0.2,
  callbacks: { onEpochEnd: (e, log) => console.log(e, log) }
});

// Save to IndexedDB — persists across sessions
await model.save('indexeddb://hushh-model');
```

---

## Browser Compatibility

| Feature | Chrome Android | Safari iOS | Firefox |
|---------|:--------------:|:----------:|:-------:|
| Microphone | ✅ | ✅ | ✅ |
| Web Audio API | ✅ | ✅ | ✅ |
| TensorFlow.js | ✅ | ✅ | ✅ |
| PWA install | ✅ | ✅ (Add to HS) | ✅ |
| Offline (SW) | ✅ | ✅ | ✅ |
| IndexedDB model | ✅ | ✅ | ✅ |

---

## Important Medical Disclaimer

This app is an **assistive tool only** and is not a medical device. It uses acoustic heuristics and should not replace parental judgment or medical advice. If your baby:
- Cries for more than 3 hours/day
- Has a fever above 38°C / 100.4°F
- Appears to be in severe pain
- Has any other concerning symptoms

**Please contact a pediatrician or healthcare provider immediately.**

---

## License

MIT — free to use, modify, and distribute.
