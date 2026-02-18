/**
 * =============================================================================
 * WHISPER MODEL CONFIGURATION FOR KOREAN → ENGLISH TRANSLATION
 * =============================================================================
 *
 * All multilingual Whisper models support:
 * - Korean language input (and 99+ other languages)
 * - task: 'translate' → outputs English text
 *
 * =============================================================================
 * AVAILABLE MODELS (Public, No Auth Required)
 * =============================================================================
 *
 * ┌─────────────────────────────────────┬────────┬─────────────┬─────────────┐
 * │ Model ID                            │ Params │ Translation │ Status      │
 * ├─────────────────────────────────────┼────────┼─────────────┼─────────────┤
 * │ onnx-community/whisper-tiny         │ 39M    │ ✅ Yes      │ ✅ Works    │
 * │ onnx-community/whisper-base         │ 74M    │ ✅ Yes      │ ✅ Works    │
 * │ onnx-community/whisper-small        │ 244M   │ ✅ Yes      │ ✅ Works    │
 * │ onnx-community/whisper-medium       │ 769M   │ ✅ Yes      │ ⚠️  Auth Req │
 * │ onnx-community/whisper-large-v3-turbo│ 809M  │ ❌ No       │ Transcribe  │
 * │ Xenova/whisper-tiny                 │ 39M    │ ✅ Yes      │ ✅ Works    │
 * │ Xenova/whisper-base                 │ 74M    │ ✅ Yes      │ ✅ Works    │
 * │ Xenova/whisper-small                │ 244M   │ ✅ Yes      │ ✅ Works    │
 * │ Xenova/whisper-medium               │ 769M   │ ✅ Yes      │ ⚠️  May fail │
 * │ Xenova/whisper-large-v3             │ 1550M  │ ✅ Yes      │ ⚠️  May fail │
 * └─────────────────────────────────────┴────────┴─────────────┴─────────────┘
 *
 * Notes:
 * - "Auth Req" = Requires HuggingFace login
 * - "May fail" = Large models may hit memory limits or execution errors
 * - "Transcribe" = Only supports transcription, NOT translation
 *
 * =============================================================================
 * QUANTIZATIONS (dtype options)
 * =============================================================================
 *
 * ┌─────────┬─────────────────────────────┬───────────────┬─────────────────┐
 * │ dtype   │ Description                 │ Best Backend  │ Model Size      │
 * ├─────────┼─────────────────────────────┼───────────────┼─────────────────┤
 * │ fp32    │ Full precision (32-bit)     │ WebGPU/WASM   │ 100% (baseline) │
 * │ fp16    │ Half precision (16-bit)     │ WebGPU        │ ~50%            │
 * │ q8      │ 8-bit quantized             │ WASM          │ ~25%            │
 * │ int8    │ 8-bit integer               │ WASM          │ ~25%            │
 * │ uint8   │ 8-bit unsigned integer      │ WASM          │ ~25%            │
 * │ q4      │ 4-bit quantized             │ WASM          │ ~12.5%          │
 * │ bnb4    │ 4-bit block-normalized      │ WASM          │ ~12.5%          │
 * └─────────┴─────────────────────────────┴───────────────┴─────────────────┘
 *
 * Recommendations:
 * - WebGPU (Chrome/Edge): Use 'fp32' or 'fp16'
 * - WASM (Firefox/Safari): Use 'q8' or 'int8'
 * - Low memory: Use 'q4' (may reduce accuracy)
 *
 * =============================================================================
 * APPROXIMATE DOWNLOAD SIZES
 * =============================================================================
 *
 * whisper-tiny:   ~150MB (fp32), ~76MB (fp16), ~40MB (q8)
 * whisper-base:   ~290MB (fp32), ~145MB (fp16), ~75MB (q8)
 * whisper-small:  ~967MB (fp32), ~484MB (fp16), ~244MB (q8)  ← Current
 * whisper-medium: ~3GB (fp32), ~1.5GB (fp16), ~750MB (q8)
 *
 * =============================================================================
 * QUALITY vs SPEED TRADEOFF
 * =============================================================================
 *
 * Model          │ Quality │ Speed  │ Korean Accuracy │ Recommended For
 * ───────────────┼─────────┼────────┼─────────────────┼──────────────────
 * whisper-tiny   │ ★★☆☆☆  │ ★★★★★ │ Fair            │ Testing, demos
 * whisper-base   │ ★★★☆☆  │ ★★★★☆ │ Good            │ Casual use
 * whisper-small  │ ★★★★☆  │ ★★★☆☆ │ Very Good       │ Production ← Current
 * whisper-medium │ ★★★★★  │ ★★☆☆☆ │ Excellent       │ High accuracy needs
 *
 * =============================================================================
 * CLOUD PIPELINE OPTIONS
 * =============================================================================
 *
 * pipeline: 'direct'
 *   whisper-1 → /audio/translations → English text
 *   - Single API call, lower latency
 *   - Cost: $0.006/min
 *
 * pipeline: 'transcribe-translate'
 *   gpt-4o-transcribe → Korean text → gpt-4o-mini → English text
 *   - Two API calls, higher latency (~2x)
 *   - Better transcription accuracy (gpt-4o-transcribe > whisper-1)
 *   - Better translation quality (LLM vs Whisper's built-in translate)
 *   - Cost: ~$0.006/min (transcribe) + ~$0.001 per chunk (translate)
 *
 * =============================================================================
 */

export const config = {
  mode: 'cloud' as 'cloud' | 'local',

  cloud: {
    apiKey: import.meta.env.VITE_OPENAI_API_KEY as string || '',
    model: 'whisper-1' as string,
    transcribeModel: 'gpt-4o-transcribe' as string,
    pipeline: 'transcribe-translate' as 'direct' | 'transcribe-translate',
    translateModel: 'gpt-4.1' as string,
    recordingIntervalMs: 1500,

    /**
     * Sentence-buffered mode (only works with 'transcribe-translate' pipeline)
     *
     * When enabled:
     * - Accumulates Korean transcript in a buffer
     * - Uses LLM to detect complete sentences vs incomplete fragments
     * - Sends only complete sentences for translation (much better quality)
     * - Shows dual-pane UI: left = Korean transcript, right = English translation
     *
     * When disabled:
     * - Current behavior: each chunk is independently transcribed + translated
     *
     * Tip: Set recordingIntervalMs to 1000ms for faster feedback in this mode
     */
    sentenceBuffered: true,
    sentenceModel: 'gpt-4.1' as string,

    /**
     * Proofreading mode (only works with sentenceBuffered enabled)
     *
     * When enabled:
     * - Combines sentence detection and proofreading into a single LLM call
     * - Maintains a context buffer of recent sentences (default 20)
     * - Uses context to detect and correct mis-transcriptions
     * - Shows raw text immediately, then replaces with corrected version
     *
     * When disabled:
     * - Uses standalone sentence detection (no correction)
     */
    proofReading: true,
    proofReadModel: 'gpt-4.1' as string,
    proofReadContextSize: 20,
  },

  local: {
    model: 'onnx-community/whisper-small',
    task: 'translate' as 'transcribe' | 'translate',
    dtype: 'fp16' as 'fp32' | 'fp16' | 'q8' | 'q4' | 'int8' | 'uint8' | 'auto',
    recordingIntervalMs: 2000,
  },
};
