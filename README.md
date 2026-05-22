# Hushh - Baby Cry Analyzer

> **100% on-device.** No audio ever leaves the user's phone.

A Progressive Web App that analyzes a baby's cry using the **Web Audio API** and **TensorFlow.js**, running entirely in the browser with zero cloud dependency. Built with **Next.js 15** (App Router, static export) + React 19.

---

## Privacy Architecture

```text
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
│  ✓ History stored in localStorage only           │
└─────────────────────────────────────────────────┘
```

---

## Development

```bash
npm install       # install dependencies
npm run dev       # dev server at http://localhost:3000 (Turbopack)
npm run icons     # regenerate PWA icons → public/icons/
```

```bash
pnpm run build    # static export to out/
```

> **Deploy via Vercel** (push to Git) — local builds on Windows may fail during the `Collecting page data` phase due to a Node.js/NTFS bug. `npm run dev` is unaffected.

HTTPS is required in production for `getUserMedia`; localhost is exempt.

---

## File Structure

```text
app/
  layout.tsx        HTML shell, meta tags, theme + PWA install scripts
  page.tsx          Renders <HushhApp>
  globals.css       Design system (CSS custom properties, warm theme)

components/
  HushhApp.tsx      Client component — JSX structure, TF.js loader, SW registration

lib/
  app-logic.js      Main controller — state machine, recording, UI, on-device training
  audio-analyzer.js On-device acoustic feature extraction (pitch, MFCCs, rhythm, ZCR)
  cry-model.js      TF.js model definition + heuristic classifier
  model-cloud.js    Optional anonymous federated sync via Supabase Storage
  i18n.js           Translations (en, vi)
  analytics.js      GA4 + Facebook Pixel

public/
  sw.js             Service worker — offline support (Next.js-aware caching)
  manifest.json     PWA manifest
  icons/            192×192 and 512×512 PNG icons
```

---

## How the Classifier Works

The analyzer extracts these acoustic features per recording:

| Feature | Relevance |
| ------- | --------- |
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

### On-device Fine-tuning

Users can correct predictions via thumbs-up/down feedback. Once 5+ labeled samples accumulate in IndexedDB (`hushh-training`), `checkAndTrain()` in `app-logic.js` runs `model.fit()` on-device — only the output head is retrained to prevent catastrophic forgetting. No data ever leaves the device.

---

## Cloud Model Sync (optional)

Anonymous federated averaging via Supabase Storage. Requires these environment variables (set in Vercel → Settings → Environment Variables):

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

When not configured, the cloud sync UI is hidden and the app runs fully offline.

---

## Browser Compatibility

| Feature | Chrome Android | Safari iOS | Firefox |
| ------- | :------------: | :--------: | :-----: |
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
