# Live Translator

Real-time Korean to English speech translation running entirely in your browser.

## Features

- **Real-time translation**: Speak Korean, see English text instantly
- **Privacy-first**: All processing happens locally in your browser - no data leaves your machine
- **WebGPU accelerated**: Uses GPU for fast inference when available, falls back to WASM
- **No backend required**: Works offline after initial model download
- **Simple UI**: Fullscreen dark interface focused on the translated text

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome (recommended for WebGPU) or Firefox.

1. Wait for the model to download (~250MB, cached after first load)
2. Click **Start**
3. Speak Korean into your microphone
4. See English translation appear on screen

## How It Works

```
Microphone → MediaRecorder → Resample to 16kHz → Web Worker → Whisper AI → English Text
```

- **Speech Recognition**: OpenAI Whisper (`onnx-community/whisper-small`) via [@huggingface/transformers](https://huggingface.co/docs/transformers.js)
- **Translation**: Whisper's built-in `task: 'translate'` outputs English regardless of input language
- **Audio Processing**: Captures in 3-second chunks, resamples to 16kHz using OfflineAudioContext
- **Acceleration**: WebGPU when available, WASM fallback for broader compatibility

## Project Structure

```
src/
├── App.tsx                 # Main UI component
├── App.css                 # Styles (dark theme, text states)
├── hooks/
│   └── useWhisper.ts       # React hook managing transcription state
├── workers/
│   └── whisper.worker.ts   # Web Worker running Whisper pipeline
└── utils/
    └── audio.ts            # Microphone capture, audio resampling
```

## Browser Support

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome 113+ | Full | WebGPU acceleration |
| Edge 113+ | Full | WebGPU acceleration |
| Firefox 29+ | Partial | WASM only (slower) |
| Safari 14.1+ | Partial | WASM only |

## Development

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run preview  # Preview production build
```

## Documentation

- [TRD.md](./TRD.md) - Technical Requirements Document (architecture, decisions, future enhancements)
- [AGENTS.md](./AGENTS.md) - AI agent guidelines for contributing to this project

## Tech Stack

- **Framework**: React 19 + TypeScript + Vite
- **ML Runtime**: @huggingface/transformers (Whisper via ONNX)
- **Audio**: Web Audio API, MediaRecorder API
