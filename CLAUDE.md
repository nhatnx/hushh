# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hushh** is a baby vocalization analysis application. It classifies infant cry patterns (hunger, pain, fatigue, etc.) using audio signal processing and ML. Babies produce physiologically distinct sounds for different states — e.g., "Neh" for hunger (tongue-palate reflex), "Owh" for tiredness (yawn reflex).

## Planned Architecture

- **Frontend:** Next.js (TypeScript) — real-time audio capture and feedback UI
- **ML layer:** Audio classification model (edge inference preferred, cloud fallback)
- **Backend API:** Node.js — serves predictions and stores session data
- **Deployment:** Vercel (frontend), edge-first inference

The system prioritizes low-latency feedback: classify audio on-device when possible, fall back to a cloud endpoint for heavier models.

## Development Commands

> This project is in early setup — commands below should be added here as infrastructure is established.

```bash
# Expected once package.json exists:
npm install       # install dependencies
npm run dev       # start Next.js dev server
npm run build     # production build
npm run lint      # lint
npm test          # run tests
```

## Key Domain Concepts

- **Vocalization types:** hunger (Neh), pain (Heh), fatigue (Owh), discomfort (Eair), lower gas (Eh)
- **Audio pipeline:** capture → preprocess (noise reduction, normalization) → feature extraction (MFCC or mel-spectrogram) → classify
- **Edge vs. cloud trade-off:** TensorFlow.js / ONNX for edge; server-side for larger models

## Code Quality

SonarLint is configured (project: `nhatnx_hushh`) — see [.vscode/settings.json](.vscode/settings.json).
