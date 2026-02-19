# AGENTS.md - AI Agent Knowledge Base

This file helps AI coding assistants understand and contribute to this project effectively.

---

## Project Identity

**Name**: Live Translator  
**Type**: Browser-based real-time speech translation app  
**Stack**: React 19 + TypeScript + Vite + Whisper (transformers.js)  
**Architecture**: Client-only, no backend

---

## Quick Context

```
User speaks Korean → Whisper in Web Worker → English text on screen
```

Key constraint: Everything runs in the browser. No server, no API calls for translation.

---

## File Map

| Path | Purpose | When to Modify |
|------|---------|----------------|
| `src/App.tsx` | Main UI component | UI changes, new states |
| `src/App.css` | Component styles | Visual changes |
| `src/hooks/useWhisper.ts` | Transcription state management | Audio flow, state changes |
| `src/workers/whisper.worker.ts` | ML inference | Model changes, inference options |
| `src/utils/audio.ts` | Audio capture/processing | Audio format, resampling |
| `TRD.md` | Technical decisions, future plans | After architectural changes |

---

## Code Conventions

### TypeScript
- Strict mode enabled
- No `any` types (use `unknown` or proper types)
- No `@ts-ignore` or `@ts-expect-error`

### React
- Functional components only
- Hooks for state management
- No class components

### Styling
- Plain CSS (no frameworks)
- BEM-like naming: `.container`, `.loading-text`, `.start-button`
- Dark theme: background `#0a0a0a`, text `#ffffff`

### Comments
- Minimal comments - code should be self-documenting
- No JSDoc unless truly necessary for complex APIs
- No "what changed" comments (that's what git is for)

### Documentation
- When diagrams are needed, always use Mermaid format

---

## Critical Constraints

### DO NOT
- Add a backend server
- Add settings/configuration UI (keep it simple)
- Add dark mode toggle (it's already dark)
- Add multiple language output support (Korean→English only for now)
- Use `as any` type assertions
- Add npm packages without justification

### ALWAYS
- Auto commit after changes are made, once proper testing and bug fixes are complete
- Run `npm run build` before committing
- Keep the UI minimal and focused
- Process audio in Web Worker (never block main thread)
- Handle errors gracefully with user-visible messages

---

## Common Tasks

### Adding a New Feature

1. Check docs/TRD.md "Future Enhancements" section first
2. Update docs/TRD.md if architectural changes needed
3. Implement in appropriate file (see File Map)
4. Verify: `npm run build` passes
5. Update README.md if user-facing

### Changing Audio Processing

- File: `src/utils/audio.ts`
- Critical: Whisper requires 16kHz mono Float32Array
- Test with both WebGPU and WASM backends

### Changing ML Model

- File: `src/workers/whisper.worker.ts`
- Model list: https://huggingface.co/onnx-community (for transformers.js v3 compatibility)
- Current model: `onnx-community/whisper-small` (multilingual, supports `task: 'translate'`)
- Note: Xenova models are for transformers.js v2, use onnx-community for v3
- Consider: download size, accuracy, speed trade-offs
- Update TRD.md with benchmarks

### Changing UI States

- Loading → Ready → Recording → (Error)
- All states defined in `src/App.tsx`
- Styles in `src/App.css`

---

## Worker Communication

Main thread and worker communicate via postMessage:

```typescript
// Main → Worker
worker.postMessage({ type: 'load' });
worker.postMessage({ type: 'transcribe', audio: Float32Array });

// Worker → Main
self.postMessage({ type: 'loading', progress: number });
self.postMessage({ type: 'ready', backend: 'webgpu' | 'wasm' });
self.postMessage({ type: 'final', text: string });
self.postMessage({ type: 'error', message: string });
```

---

## Testing Checklist

Before considering a change complete:

- [ ] `npm run build` exits with code 0
- [ ] App loads in Chrome (WebGPU)
- [ ] App loads in Firefox (WASM fallback)
- [ ] Model downloads and shows progress
- [ ] Start button appears after model loads
- [ ] Recording captures audio
- [ ] Translation appears on screen
- [ ] Stop button works
- [ ] No console errors during normal use

---

## Debugging Tips

### Model not loading
- Check browser console for network errors
- Verify Hugging Face CDN is accessible
- Check if model name in worker.ts is correct

### No audio captured
- Check microphone permissions in browser
- Verify `getSupportedMimeType()` returns valid type
- Check if MediaRecorder events fire

### Translation not appearing
- Add console.log in worker's transcribe function
- Check if audio Float32Array has data (not all zeros)
- Verify worker postMessage is being received

### WebGPU not detected
- Chrome 113+ required
- Check `navigator.gpu` exists
- Some systems may not support WebGPU

---

## Reference Links

- [transformers.js docs](https://huggingface.co/docs/transformers.js)
- [Whisper model card](https://huggingface.co/openai/whisper-small)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [WebGPU spec](https://www.w3.org/TR/webgpu/)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02-13 | Initial implementation |
