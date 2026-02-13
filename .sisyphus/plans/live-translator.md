# Live Korean-English Translator Vite App

## TL;DR

> **Quick Summary**: Build a browser-based app that captures Korean speech via microphone, transcribes and translates to English using Whisper (running locally in WebGPU/WASM), and displays the translated text fullscreen with visual feedback for partial vs final results.
> 
> **Deliverables**:
> - Vite + TypeScript + React app
> - Web Worker running Whisper transcription
> - Fullscreen dark UI with live translation display
> - Partial results (light color) → Final results (solid color) transition
> 
> **Estimated Effort**: Medium (3-5 hours)
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5

---

## Context

### Original Request
User wants to create a Vite app that listens to Korean speech in real-time and shows translated English text on screen.

### Interview Summary
**Key Discussions**:
- **Architecture**: Browser-only, no backend server
- **Translation**: Korean → English using Whisper's built-in translation
- **UI Style**: Simple fullscreen text on dark background
- **Display Mode**: Partial results in light/faded color, final results in solid color
- **History**: Replace mode - only show current translation, old text disappears
- **Use Case**: Personal use / local development

**Research Findings**:
- `@huggingface/transformers` is the recommended library for browser Whisper
- WebGPU provides ~100x speedup over WASM
- Whisper can transcribe AND translate to English in one step via `task: 'translate'`
- Must run Whisper in Web Worker to avoid blocking main thread
- Audio must be resampled to 16kHz using OfflineAudioContext

### Metis Review
**Identified Gaps** (addressed):
- Audio resampling: MediaRecorder doesn't output 16kHz → Use OfflineAudioContext
- Chunk strategy: Process every 3-5 seconds of accumulated audio
- Worker protocol: Defined message types for main↔worker communication
- Memory management: Clear audio buffers after processing

---

## Work Objectives

### Core Objective
Create a privacy-first, browser-based live translation app that converts Korean speech to English text in real-time using locally-running Whisper AI.

### Concrete Deliverables
- `/src/App.tsx` - Main fullscreen UI component
- `/src/hooks/useWhisper.ts` - React hook managing worker + transcription state
- `/src/workers/whisper.worker.ts` - Web Worker running Whisper pipeline
- `/src/utils/audio.ts` - Audio capture and resampling utilities
- `/index.html` + `/vite.config.ts` - Vite configuration
- `/package.json` - Dependencies

### Definition of Done
- [ ] `npm run build` completes with exit code 0
- [ ] `npm run dev` starts server, app loads in browser
- [ ] Speaking Korean into microphone produces English text on screen
- [ ] Partial results appear in faded color, finals in solid white
- [ ] Works in Chrome (WebGPU) and falls back gracefully in Firefox (WASM)

### Must Have
- Microphone permission handling with clear error states
- Model loading progress indicator
- WebGPU detection with WASM fallback
- Visual distinction between partial and final results
- Start/Stop recording button

### Must NOT Have (Guardrails)
- ❌ Backend server or API calls
- ❌ Settings/configuration panel
- ❌ Dark mode toggle (it's already dark)
- ❌ Multiple language support (Korean→English only)
- ❌ Audio waveform visualization
- ❌ Download/export functionality
- ❌ History persistence or session storage
- ❌ Voice activity detection (VAD)
- ❌ Speaker diarization
- ❌ Over-engineered folder structure

---

## Verification Strategy

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
> ALL verification is executed by agents using tools. No manual testing required.

### Test Decision
- **Infrastructure exists**: NO (new project)
- **Automated tests**: NO (personal dev project, QA scenarios sufficient)
- **Framework**: N/A

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

All verification uses Playwright for browser automation and Bash for build commands.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Project scaffolding (Vite + deps)
└── Task 2: Audio utilities (capture + resample) [can start after package.json exists]

Wave 2 (After Wave 1):
├── Task 3: Web Worker with Whisper pipeline
└── Task 4: useWhisper React hook

Wave 3 (After Wave 2):
└── Task 5: Main App UI + integration
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 2, 3, 4, 5 | None |
| 2 | 1 | 3, 5 | None |
| 3 | 1, 2 | 4, 5 | None |
| 4 | 3 | 5 | None |
| 5 | 4 | None | None |

---

## TODOs

- [ ] 1. Project Scaffolding

  **What to do**:
  - Create Vite project with React + TypeScript template
  - Install dependencies: `@huggingface/transformers`
  - Configure Vite for Web Worker bundling
  - Set up basic index.html with dark background

  **Must NOT do**:
  - Don't add testing frameworks
  - Don't add CSS frameworks (raw CSS is fine)
  - Don't add routing

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple scaffolding task, single-focus
  - **Skills**: `[]`
    - No special skills needed for npm/vite setup

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (alone)
  - **Blocks**: Tasks 2, 3, 4, 5
  - **Blocked By**: None

  **References**:

  **External References**:
  - Vite React-TS template: `npm create vite@latest -- --template react-ts`
  - Transformers.js docs: https://huggingface.co/docs/transformers.js
  - Vite worker config: https://vite.dev/guide/features.html#web-workers

  **Acceptance Criteria**:

  - [ ] Project directory created with Vite React-TS template
  - [ ] `@huggingface/transformers` installed in package.json
  - [ ] `npm run dev` starts without errors

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Project builds successfully
    Tool: Bash
    Preconditions: Project directory exists
    Steps:
      1. cd /Users/won/code/translate && npm install
      2. npm run build
      3. Assert: Exit code is 0
      4. Assert: dist/ directory exists
    Expected Result: Build completes without errors
    Evidence: Build output captured
  
  Scenario: Dev server starts
    Tool: Bash
    Preconditions: Dependencies installed
    Steps:
      1. npm run dev &
      2. sleep 5
      3. curl -s http://localhost:5173 | grep -q "root"
      4. pkill -f "vite"
    Expected Result: Server responds with HTML
    Evidence: curl response captured
  ```

  **Commit**: YES
  - Message: `feat: scaffold vite project with transformers.js`
  - Files: `package.json, vite.config.ts, index.html, src/*`
  - Pre-commit: `npm run build`

---

- [ ] 2. Audio Capture and Resampling Utilities

  **What to do**:
  - Create `/src/utils/audio.ts`
  - Implement `startMicrophoneCapture()` - returns MediaStream
  - Implement `resampleAudio(audioBuffer, targetSampleRate)` - uses OfflineAudioContext
  - Implement `convertBlobToFloat32Array(blob)` - for Whisper input format
  - Handle microphone permission errors

  **Must NOT do**:
  - Don't add VAD (voice activity detection)
  - Don't add audio visualization
  - Don't use external audio processing libraries

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused utility module, well-defined scope
  - **Skills**: `[]`
    - Standard Web Audio APIs, no special skills

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (after Task 1)
  - **Blocks**: Tasks 3, 5
  - **Blocked By**: Task 1

  **References**:

  **External References**:
  - MDN MediaDevices.getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
  - MDN OfflineAudioContext: https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext
  - Whisper requires 16kHz mono Float32Array

  **Pattern Reference** (from research):
  ```typescript
  // Resampling pattern using OfflineAudioContext
  async function resampleTo16kHz(audioBuffer: AudioBuffer): Promise<Float32Array> {
    const offlineCtx = new OfflineAudioContext(
      1, // mono
      audioBuffer.duration * 16000,
      16000 // target sample rate
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    const resampled = await offlineCtx.startRendering();
    return resampled.getChannelData(0);
  }
  ```

  **Acceptance Criteria**:

  - [ ] `src/utils/audio.ts` exports `startMicrophoneCapture`, `resampleAudio`, `convertBlobToFloat32Array`
  - [ ] TypeScript compiles without errors: `npx tsc --noEmit`
  - [ ] Functions handle permission denial gracefully (throw typed error)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Audio utilities compile
    Tool: Bash
    Preconditions: Task 1 complete
    Steps:
      1. cd /Users/won/code/translate
      2. npx tsc --noEmit
      3. Assert: Exit code 0
    Expected Result: No TypeScript errors
    Evidence: tsc output captured

  Scenario: Audio module exports expected functions
    Tool: Bash
    Preconditions: src/utils/audio.ts exists
    Steps:
      1. grep -E "export (async )?function (startMicrophoneCapture|resampleAudio|convertBlobToFloat32Array)" src/utils/audio.ts
      2. Assert: All 3 functions found
    Expected Result: All exports present
    Evidence: grep output captured
  ```

  **Commit**: YES
  - Message: `feat: add audio capture and resampling utilities`
  - Files: `src/utils/audio.ts`
  - Pre-commit: `npx tsc --noEmit`

---

- [ ] 3. Web Worker with Whisper Pipeline

  **What to do**:
  - Create `/src/workers/whisper.worker.ts`
  - Initialize `@huggingface/transformers` pipeline in worker
  - Use `whisper-small` model with `task: 'translate'`, `language: 'korean'`
  - Implement message protocol:
    - Receive: `{type: 'load'}`, `{type: 'transcribe', audio: Float32Array}`
    - Send: `{type: 'loading', progress: number}`, `{type: 'ready'}`, `{type: 'partial', text: string}`, `{type: 'final', text: string}`, `{type: 'error', message: string}`
  - Use `callback_function` for partial results, `chunk_callback` for finals
  - Detect WebGPU availability, fall back to WASM

  **Must NOT do**:
  - Don't import worker into main thread directly (use `new Worker()`)
  - Don't use Service Workers (WebGPU unstable there)
  - Don't add caching logic

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex async logic, worker communication, ML pipeline setup
  - **Skills**: `[]`
    - Core JS/TS task, no specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: Tasks 1, 2

  **References**:

  **External References**:
  - Transformers.js ASR pipeline: https://huggingface.co/docs/transformers.js/api/pipelines#module_pipelines.AutomaticSpeechRecognitionPipeline
  - Xenova/whisper-web worker pattern: https://github.com/xenova/whisper-web/blob/main/src/worker.js
  - Vite Worker syntax: `new Worker(new URL('./workers/whisper.worker.ts', import.meta.url), { type: 'module' })`

  **Pattern Reference** (from research):
  ```typescript
  // Worker initialization pattern
  import { pipeline, env } from '@huggingface/transformers';
  
  // Disable local model check (browser environment)
  env.allowLocalModels = false;
  
  let transcriber: any = null;
  
  self.onmessage = async (e) => {
    const { type, audio } = e.data;
    
    if (type === 'load') {
      // Detect WebGPU
      const device = navigator.gpu ? 'webgpu' : 'wasm';
      
      transcriber = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-small',
        {
          device,
          dtype: device === 'webgpu' ? 'fp16' : 'q8',
          progress_callback: (progress) => {
            self.postMessage({ type: 'loading', progress: progress.progress });
          }
        }
      );
      self.postMessage({ type: 'ready' });
    }
    
    if (type === 'transcribe' && transcriber) {
      const result = await transcriber(audio, {
        language: 'korean',
        task: 'translate', // Translates to English
        chunk_length_s: 30,
        return_timestamps: true,
        callback_function: (partial) => {
          self.postMessage({ type: 'partial', text: partial.text });
        }
      });
      self.postMessage({ type: 'final', text: result.text });
    }
  };
  ```

  **Acceptance Criteria**:

  - [ ] `src/workers/whisper.worker.ts` exists with message handlers
  - [ ] Worker uses `Xenova/whisper-small` model
  - [ ] Worker passes `task: 'translate'` and `language: 'korean'`
  - [ ] Worker sends `partial` and `final` message types
  - [ ] Worker detects WebGPU and falls back to WASM
  - [ ] TypeScript compiles: `npx tsc --noEmit`

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Worker file has correct structure
    Tool: Bash
    Preconditions: src/workers/whisper.worker.ts exists
    Steps:
      1. grep -q "task.*translate" src/workers/whisper.worker.ts
      2. grep -q "language.*korean" src/workers/whisper.worker.ts
      3. grep -q "whisper-small" src/workers/whisper.worker.ts
      4. grep -q "postMessage.*partial" src/workers/whisper.worker.ts
      5. grep -q "postMessage.*final" src/workers/whisper.worker.ts
      6. Assert: All greps return 0
    Expected Result: Worker contains required patterns
    Evidence: grep outputs captured

  Scenario: Worker compiles without errors
    Tool: Bash
    Preconditions: Worker file exists
    Steps:
      1. npx tsc --noEmit
      2. Assert: Exit code 0
    Expected Result: No TypeScript errors
    Evidence: tsc output
  ```

  **Commit**: YES
  - Message: `feat: add whisper web worker with korean translation`
  - Files: `src/workers/whisper.worker.ts`
  - Pre-commit: `npx tsc --noEmit`

---

- [ ] 4. useWhisper React Hook

  **What to do**:
  - Create `/src/hooks/useWhisper.ts`
  - Manage worker lifecycle (create, terminate)
  - Expose: `{ isLoading, isReady, isRecording, partialText, finalText, error, startRecording, stopRecording }`
  - Handle audio capture → chunking (every 3 seconds) → send to worker
  - Accumulate audio chunks, resample to 16kHz before sending
  - Clear audio buffer after sending to prevent memory leaks

  **Must NOT do**:
  - Don't expose internal worker reference
  - Don't add configuration options
  - Don't add retry logic (keep simple)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex state management, worker communication, audio streaming
  - **Skills**: `[]`
    - React hooks pattern, no specialized skills

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `src/workers/whisper.worker.ts` - Worker message protocol to match
  - `src/utils/audio.ts` - Audio functions to use

  **External References**:
  - React useEffect cleanup: https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development

  **Hook Interface**:
  ```typescript
  interface UseWhisperReturn {
    isLoading: boolean;      // Model is downloading/loading
    loadingProgress: number; // 0-100
    isReady: boolean;        // Model loaded, ready to transcribe
    isRecording: boolean;    // Currently capturing audio
    partialText: string;     // Current partial transcription
    finalText: string;       // Last finalized transcription
    error: string | null;    // Error message if any
    startRecording: () => void;
    stopRecording: () => void;
  }
  ```

  **Acceptance Criteria**:

  - [ ] `src/hooks/useWhisper.ts` exports `useWhisper` hook
  - [ ] Hook returns all interface properties listed above
  - [ ] Hook creates worker on mount, terminates on unmount
  - [ ] Hook processes audio in ~3 second chunks
  - [ ] TypeScript compiles: `npx tsc --noEmit`

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Hook exports correct interface
    Tool: Bash
    Preconditions: src/hooks/useWhisper.ts exists
    Steps:
      1. grep -q "isLoading" src/hooks/useWhisper.ts
      2. grep -q "isReady" src/hooks/useWhisper.ts
      3. grep -q "partialText" src/hooks/useWhisper.ts
      4. grep -q "finalText" src/hooks/useWhisper.ts
      5. grep -q "startRecording" src/hooks/useWhisper.ts
      6. grep -q "stopRecording" src/hooks/useWhisper.ts
      7. Assert: All greps succeed
    Expected Result: All interface properties present
    Evidence: grep outputs

  Scenario: Hook file compiles
    Tool: Bash
    Preconditions: All dependencies exist
    Steps:
      1. npx tsc --noEmit
      2. Assert: Exit code 0
    Expected Result: No TypeScript errors
    Evidence: tsc output
  ```

  **Commit**: YES
  - Message: `feat: add useWhisper hook for transcription state`
  - Files: `src/hooks/useWhisper.ts`
  - Pre-commit: `npx tsc --noEmit`

---

- [ ] 5. Main App UI and Integration

  **What to do**:
  - Update `/src/App.tsx` with fullscreen dark UI
  - Display `partialText` in light/faded color (opacity 0.5)
  - Display `finalText` in solid white
  - Show loading progress bar during model download
  - Show "Ready" state when model loaded
  - Add Start/Stop button
  - Handle and display errors clearly
  - Style: dark background (#0a0a0a), white text, centered, large font

  **Must NOT do**:
  - Don't add settings or configuration
  - Don't add multiple views/pages
  - Don't add CSS framework (plain CSS)
  - Don't add animations beyond simple transitions

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI implementation with specific visual requirements
  - **Skills**: `["frontend-ui-ux"]`
    - UI/UX skill helpful for clean visual implementation

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (final)
  - **Blocks**: None (final task)
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `src/hooks/useWhisper.ts` - Hook to consume

  **UI Specification**:
  ```
  Layout:
  - Full viewport height and width
  - Centered content (flexbox)
  - Background: #0a0a0a
  - Text: white, large (2-3rem), sans-serif
  
  States:
  1. Loading: "Loading model... X%" with progress bar
  2. Ready: "Click Start to begin" + Start button
  3. Recording: Pulsing indicator + text display + Stop button
  4. Error: Red error message + Retry option
  
  Text Display:
  - partialText: opacity 0.5, same position
  - finalText: opacity 1.0, replaces partial
  - Transition: 200ms ease
  ```

  **Acceptance Criteria**:

  - [ ] App shows loading progress during model download
  - [ ] App shows Start button when ready
  - [ ] Clicking Start requests microphone permission
  - [ ] Partial text appears with reduced opacity
  - [ ] Final text appears with full opacity
  - [ ] Stop button stops recording
  - [ ] Errors display clearly in red
  - [ ] `npm run build` succeeds
  - [ ] `npm run dev` shows working app

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: App displays loading state
    Tool: Playwright (playwright skill)
    Preconditions: npm run dev running on localhost:5173
    Steps:
      1. Navigate to http://localhost:5173
      2. Wait for: text matching /loading|downloading/i (timeout: 10s)
      3. Assert: Progress indicator visible (progress element or percentage text)
      4. Screenshot: .sisyphus/evidence/task-5-loading-state.png
    Expected Result: Loading state visible
    Evidence: .sisyphus/evidence/task-5-loading-state.png

  Scenario: App shows ready state after model loads
    Tool: Playwright (playwright skill)
    Preconditions: Dev server running
    Steps:
      1. Navigate to http://localhost:5173
      2. Wait for: button containing "Start" (timeout: 120s - model download)
      3. Assert: Start button is enabled
      4. Screenshot: .sisyphus/evidence/task-5-ready-state.png
    Expected Result: Start button visible and clickable
    Evidence: .sisyphus/evidence/task-5-ready-state.png

  Scenario: App handles microphone permission denial
    Tool: Playwright (playwright skill)
    Preconditions: Dev server running, model loaded
    Steps:
      1. Navigate to http://localhost:5173
      2. Wait for Start button
      3. Set browser context to deny microphone permission
      4. Click Start button
      5. Wait for: error message visible (timeout: 5s)
      6. Assert: Error text contains "microphone" or "permission"
      7. Screenshot: .sisyphus/evidence/task-5-permission-error.png
    Expected Result: Clear error message displayed
    Evidence: .sisyphus/evidence/task-5-permission-error.png

  Scenario: Build succeeds
    Tool: Bash
    Preconditions: All code complete
    Steps:
      1. cd /Users/won/code/translate
      2. npm run build
      3. Assert: Exit code 0
      4. Assert: dist/index.html exists
    Expected Result: Production build created
    Evidence: Build output captured
  ```

  **Commit**: YES
  - Message: `feat: add fullscreen translator UI with live display`
  - Files: `src/App.tsx, src/App.css, src/index.css`
  - Pre-commit: `npm run build`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat: scaffold vite project with transformers.js` | package.json, vite.config.ts, index.html, src/* | npm run build |
| 2 | `feat: add audio capture and resampling utilities` | src/utils/audio.ts | npx tsc --noEmit |
| 3 | `feat: add whisper web worker with korean translation` | src/workers/whisper.worker.ts | npx tsc --noEmit |
| 4 | `feat: add useWhisper hook for transcription state` | src/hooks/useWhisper.ts | npx tsc --noEmit |
| 5 | `feat: add fullscreen translator UI with live display` | src/App.tsx, src/App.css | npm run build |

---

## Success Criteria

### Verification Commands
```bash
# Build check
npm run build  # Expected: Exit code 0

# Type check
npx tsc --noEmit  # Expected: Exit code 0

# Dev server
npm run dev  # Expected: Server starts on :5173
```

### Final Checklist
- [ ] Speaking Korean into mic produces English text on screen
- [ ] Partial results show in faded color
- [ ] Final results show in solid white
- [ ] Model loading shows progress
- [ ] Works in Chrome with WebGPU
- [ ] Falls back to WASM in Firefox
- [ ] Microphone permission denial shows error
- [ ] No console errors during normal operation
- [ ] No "Must NOT Have" items present (settings, dark mode toggle, etc.)
