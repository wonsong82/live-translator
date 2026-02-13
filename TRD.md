# Technical Requirements Document (TRD)

## Overview

**Project**: Live Translator  
**Purpose**: Real-time Korean to English speech translation in the browser  
**Version**: 1.0.0  
**Last Updated**: 2026-02-13

---

## 1. Current Architecture

### 1.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Main Thread)                    │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │  App.tsx    │───▶│ useWhisper   │───▶│  UI State         │  │
│  │  (React)    │    │  (Hook)      │    │  - isLoading      │  │
│  └─────────────┘    └──────┬───────┘    │  - isRecording    │  │
│                            │            │  - partialText    │  │
│                            │            │  - finalText      │  │
│                     postMessage()       └───────────────────┘  │
│                            │                                    │
│  ┌─────────────────────────▼────────────────────────────────┐  │
│  │                    Web Worker                             │  │
│  │  ┌─────────────────────────────────────────────────────┐ │  │
│  │  │  whisper.worker.ts                                  │ │  │
│  │  │  - Loads onnx-community/whisper-small model          │ │  │
│  │  │  - Detects WebGPU/WASM backend                      │ │  │
│  │  │  - Runs transcription + translation                 │ │  │
│  │  └─────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Audio Pipeline (utils/audio.ts)                         │  │
│  │  MediaStream → MediaRecorder → Blob → resample(16kHz)    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| **App** | `src/App.tsx` | UI rendering, state display, user interactions |
| **useWhisper** | `src/hooks/useWhisper.ts` | Worker lifecycle, audio capture, state management |
| **Worker** | `src/workers/whisper.worker.ts` | ML inference, model loading, WebGPU detection |
| **Audio Utils** | `src/utils/audio.ts` | Microphone access, resampling, format conversion |

### 1.3 Data Flow

1. User clicks **Start** → `useWhisper.startRecording()`
2. Request microphone permission → `startMicrophoneCapture()`
3. Create MediaRecorder, capture audio chunks every 1 second
4. Every 3 seconds, process accumulated chunks:
   - Convert Blob → ArrayBuffer → AudioBuffer
   - Resample to 16kHz mono Float32Array
   - Send to worker via `postMessage({ type: 'transcribe', audio })`
5. Worker runs Whisper inference with `task: 'translate'`
6. Worker sends back `{ type: 'final', text }` 
7. Hook updates `finalText` state → UI re-renders

---

## 2. Technical Decisions

### 2.1 Why Whisper in Browser?

| Alternative | Rejected Because |
|-------------|------------------|
| Cloud API (OpenAI, Google) | Privacy concerns, latency, ongoing costs |
| Local server (whisper.cpp) | Requires backend, not portable |
| Web Speech API | Not truly offline, limited accuracy for Korean |

**Decision**: Use @huggingface/transformers with Whisper ONNX model for fully client-side inference.

### 2.2 Why whisper-small?

| Model | Size | Korean Accuracy | Translation | Speed |
|-------|------|-----------------|-------------|-------|
| whisper-tiny | 39MB | Poor | Yes | Fast |
| whisper-base | 74MB | Fair | Yes | Fast |
| **whisper-small** | 244MB | Good | Yes | Medium |
| whisper-medium | 769MB | Great | Yes | Slow |
| whisper-large-v3-turbo | 809MB | Excellent | **No** | Medium |
| whisper-large-v3 | 1.5GB | Best | **Unsupported in transformers.js v3** | Slow |

**Decision**: `onnx-community/whisper-small` (multilingual) provides a good balance of quality, speed, and compatibility with @huggingface/transformers v3. Note: whisper-large-v3-turbo does NOT support translation (only trained on transcription), and Xenova models are incompatible with transformers.js v3.

### 2.3 Why Web Worker?

Whisper inference blocks the main thread for 1-3 seconds per chunk. Running in a Web Worker keeps the UI responsive.

### 2.4 Audio Chunk Strategy

| Interval | Trade-off |
|----------|-----------|
| 1 second | Too short for context, choppy translations |
| **3 seconds** | Good balance of latency and context |
| 5+ seconds | Too much latency for "live" feel |

**Decision**: Process every 3 seconds.

---

## 3. Current Limitations

| Limitation | Reason | Potential Solution |
|------------|--------|-------------------|
| No partial results | Whisper doesn't stream well | Use streaming-capable model or VAD |
| ~3s latency | Chunk-based processing | Implement voice activity detection |
| Large initial download | ~250MB model | Use smaller model or lazy-load |
| No other language pairs | Whisper translate → English only | Add translation API for other targets |
| No history | Replace mode only | Add transcript accumulation option |

---

## 4. Future Enhancements

### 4.1 High Priority

#### P1: Voice Activity Detection (VAD)
- **Problem**: Currently processes every 3s regardless of speech
- **Solution**: Add Silero VAD to detect speech start/end
- **Benefit**: Only process when speech detected, reduce latency

#### P2: Streaming Partial Results  
- **Problem**: Text only appears after full chunk processed
- **Solution**: Use `callback_function` if supported, or display interim "Listening..." states
- **Benefit**: More responsive feel

#### P3: Multiple Language Targets
- **Problem**: Only outputs English
- **Solution**: Add LibreTranslate or other translation API post-Whisper
- **Benefit**: Korean → Japanese, Spanish, etc.

### 4.2 Medium Priority

#### M1: Smaller Model Option
- Allow user to choose whisper-tiny for faster loads
- Store preference in localStorage

#### M2: Transcript History Mode
- Option to accumulate translations instead of replace
- Scrollable transcript with timestamps

#### M3: Audio Input Selection
- Allow selecting specific microphone
- Support system audio capture (where available)

#### M4: Export Functionality
- Export transcript as .txt or .srt
- Copy to clipboard button

### 4.3 Low Priority

#### L1: Custom Vocabulary
- Add domain-specific terms for better recognition

#### L2: Speaker Diarization
- Identify different speakers (would need additional model)

#### L3: Mobile Optimization
- Touch-friendly UI
- PWA support for installation

---

## 5. API Reference

### 5.1 Worker Message Protocol

**Main → Worker:**
```typescript
{ type: 'load' }                           // Initialize model
{ type: 'transcribe', audio: Float32Array } // Process audio
```

**Worker → Main:**
```typescript
{ type: 'loading', progress: number }  // 0-100 download progress
{ type: 'ready', backend: string }     // 'webgpu' | 'wasm'
{ type: 'partial', text: string }      // Interim result (not currently used)
{ type: 'final', text: string }        // Final transcription
{ type: 'error', message: string }     // Error occurred
```

### 5.2 useWhisper Hook Interface

```typescript
interface UseWhisperReturn {
  isLoading: boolean;       // Model downloading/loading
  loadingProgress: number;  // 0-100
  isReady: boolean;         // Ready to transcribe
  isRecording: boolean;     // Currently capturing audio
  partialText: string;      // Interim transcription
  finalText: string;        // Final transcription
  error: string | null;     // Error message
  backend: string | null;   // 'webgpu' | 'wasm'
  startRecording: () => Promise<void>;
  stopRecording: () => void;
}
```

### 5.3 Audio Utils

```typescript
startMicrophoneCapture(): Promise<MediaStream>
stopMicrophoneCapture(stream: MediaStream): void
resampleAudio(audioBuffer: AudioBuffer): Promise<Float32Array>
convertBlobToFloat32Array(blob: Blob): Promise<Float32Array>
mergeFloat32Arrays(arrays: Float32Array[]): Float32Array
getSupportedMimeType(): string
```

---

## 6. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @huggingface/transformers | ^3.x | Whisper model inference |
| @webgpu/types | ^0.x | WebGPU TypeScript definitions |
| react | ^19.x | UI framework |
| vite | ^7.x | Build tool |

---

## 7. Performance Benchmarks

| Metric | WebGPU (M1 Mac) | WASM (Firefox) |
|--------|-----------------|----------------|
| Model load | ~5s | ~8s |
| 3s audio inference | ~1.5s | ~4s |
| Memory usage | ~800MB | ~600MB |

---

## 8. Security Considerations

- **Microphone access**: Requires explicit user permission
- **No data transmission**: All processing local
- **Model source**: Downloaded from Hugging Face CDN (trusted)
- **CSP compatible**: No eval() or inline scripts in production

---

## 9. Testing Strategy

### Manual QA Scenarios

1. **Model Loading**: App shows progress, transitions to Ready state
2. **Permission Denied**: Clear error message when mic denied
3. **Recording Flow**: Start → Speak → See translation → Stop
4. **WebGPU Fallback**: Works in Firefox (WASM mode)
5. **Error Recovery**: Graceful handling of audio errors

### Automated Tests (Future)

- Unit tests for audio.ts utilities
- Integration tests with mocked MediaRecorder
- E2E tests with Playwright + audio injection
