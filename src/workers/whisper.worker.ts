import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

type Transcriber = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>;

type DType = 'fp32' | 'fp16' | 'q8' | 'q4' | 'int8' | 'uint8' | 'auto';

type Task = 'transcribe' | 'translate';
type CloudPipeline = 'direct' | 'transcribe-translate';

type WorkerMessage =
  | { type: 'load'; mode: 'cloud' | 'local'; apiKey?: string; model?: string; task?: Task; dtype?: DType; cloudPipeline?: CloudPipeline; cloudModel?: string; cloudTranslateModel?: string; sentenceBuffered?: boolean; sentenceModel?: string }
  | { type: 'transcribe'; audio: Float32Array };

type WorkerResponse =
  | { type: 'loading'; file: string; progress: number; loaded?: number; total?: number }
  | { type: 'ready'; backend: string }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'transcript-update'; sentences: string[]; pending: string }
  | { type: 'translation-update'; text: string }
  | { type: 'error'; message: string };

let transcriber: Transcriber | null = null;
let currentMode: 'cloud' | 'local' = 'local';
let currentTask: Task = 'translate';
let currentCloudPipeline: CloudPipeline = 'direct';
let currentCloudModel = 'whisper-1';
let currentCloudTranslateModel = 'gpt-4o-mini';
let cloudApiKey = '';
let sentenceBufferedEnabled = false;
let sentenceModelName = 'gpt-4.1-mini';

let sentenceBuffer = '';
let completedSentences: string[] = [];

async function detectWebGPU(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

async function loadLocalModel(model: string, requestedDtype: DType = 'auto'): Promise<void> {
  const hasWebGPU = await detectWebGPU();
  const device = hasWebGPU ? 'webgpu' : 'wasm';
  
  let dtype: string;
  if (requestedDtype === 'auto') {
    dtype = hasWebGPU ? 'fp32' : 'q8';
  } else {
    dtype = requestedDtype;
  }

  transcriber = await (pipeline as Function)(
    'automatic-speech-recognition',
    model,
    {
      device,
      dtype,
      progress_callback: (progress: { progress?: number; status?: string; file?: string; loaded?: number; total?: number }) => {
        if (progress.progress !== undefined && progress.file) {
          self.postMessage({ 
            type: 'loading', 
            file: progress.file,
            progress: progress.progress,
            loaded: progress.loaded,
            total: progress.total,
          } satisfies WorkerResponse);
        }
      },
    }
  ) as Transcriber;

  self.postMessage({ type: 'ready', backend: device } satisfies WorkerResponse);
}

async function loadCloudMode(apiKey: string): Promise<void> {
  cloudApiKey = apiKey;
  if (!cloudApiKey) {
    throw new Error('OpenAI API key required. Set VITE_OPENAI_API_KEY in .env');
  }
  self.postMessage({ type: 'ready', backend: 'cloud (OpenAI)' } satisfies WorkerResponse);
}

function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function cloudDirect(audio: Float32Array): Promise<void> {
  const wavBlob = float32ToWav(audio, 16000);
  const formData = new FormData();
  formData.append('file', wavBlob, 'audio.wav');
  formData.append('model', currentCloudModel);
    formData.append('response_format', 'json');

  const response = await fetch('https://api.openai.com/v1/audio/translations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cloudApiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const result = await response.json();
  const finalText = filterHallucinations(result.text || '');
  if (finalText) {
    self.postMessage({ type: 'final', text: finalText } satisfies WorkerResponse);
  }
}

async function transcribeAudioToKorean(audio: Float32Array): Promise<string> {
  const wavBlob = float32ToWav(audio, 16000);
  const formData = new FormData();
  formData.append('file', wavBlob, 'audio.wav');
  formData.append('model', 'gpt-4o-transcribe');
  formData.append('response_format', 'json');
  formData.append('language', 'ko');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cloudApiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Transcribe error: ${response.status}`);
  }

  const result = await response.json();
  return result.text || '';
}

async function translateKoreanToEnglish(koreanText: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cloudApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: currentCloudTranslateModel,
      messages: [
        { role: 'system', content: 'Translate the following Korean text to English. Output ONLY the English translation, nothing else.' },
        { role: 'user', content: koreanText },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Translate error: ${response.status}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content?.trim() || '';
}

interface SentenceSplit {
  sentences: string[];
  pending: string;
}

async function detectSentenceBoundaries(text: string): Promise<SentenceSplit> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cloudApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: sentenceModelName,
      messages: [
        {
          role: 'system',
          content: `You are a Korean sentence boundary detector. Given Korean text from a live speech transcription, split it into complete sentences and any remaining incomplete fragment.

Rules:
- A complete sentence ends with a natural sentence-ending pattern (e.g., 다, 요, 죠, 까, 네, 지, 야, etc.)
- Maintain the EXACT original text — do not modify, correct, or rephrase anything
- The "pending" field should contain text that is not yet a complete sentence
- If the entire text is incomplete, return it all as "pending"
- Preserve chronological order

Respond with ONLY valid JSON: {"sentences": ["완전한 문장1", "완전한 문장2"], "pending": "미완성 부분"}`
        },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Sentence detection error: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content?.trim() || '{}';

  try {
    const parsed = JSON.parse(content) as { sentences?: string[]; pending?: string };
    return {
      sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [],
      pending: typeof parsed.pending === 'string' ? parsed.pending : '',
    };
  } catch {
    return { sentences: [], pending: text };
  }
}

async function cloudTranscribeTranslate(audio: Float32Array): Promise<void> {
  const koreanText = await transcribeAudioToKorean(audio);
  if (!koreanText.trim()) return;

  const englishText = await translateKoreanToEnglish(koreanText);
  const finalText = filterHallucinations(englishText);
  if (finalText) {
    self.postMessage({ type: 'final', text: finalText } satisfies WorkerResponse);
  }
}

async function cloudSentenceBuffered(audio: Float32Array): Promise<void> {
  const koreanText = await transcribeAudioToKorean(audio);
  if (!koreanText.trim()) return;

  sentenceBuffer = sentenceBuffer ? sentenceBuffer + ' ' + koreanText.trim() : koreanText.trim();

  const { sentences, pending } = await detectSentenceBoundaries(sentenceBuffer);

  if (sentences.length > 0) {
    completedSentences.push(...sentences);
  }
  sentenceBuffer = pending;

  self.postMessage({
    type: 'transcript-update',
    sentences: completedSentences.slice(),
    pending: sentenceBuffer,
  } satisfies WorkerResponse);

  for (const sentence of sentences) {
    const englishText = await translateKoreanToEnglish(sentence);
    const filtered = filterHallucinations(englishText);
    if (filtered) {
      self.postMessage({ type: 'translation-update', text: filtered } satisfies WorkerResponse);
    }
  }
}

async function transcribeCloud(audio: Float32Array): Promise<void> {
  const energy = getAudioEnergy(audio);
  if (energy < SILENCE_THRESHOLD) return;
  if (!hasSpeechActivity(audio)) return;

  try {
    if (currentCloudPipeline === 'transcribe-translate' && sentenceBufferedEnabled) {
      await cloudSentenceBuffered(audio);
    } else if (currentCloudPipeline === 'transcribe-translate') {
      await cloudTranscribeTranslate(audio);
    } else {
      await cloudDirect(audio);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cloud transcription failed';
    self.postMessage({ type: 'error', message } satisfies WorkerResponse);
  }
}

function getAudioEnergy(audio: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < audio.length; i++) {
    sum += audio[i] * audio[i];
  }
  return Math.sqrt(sum / audio.length);
}

const SILENCE_THRESHOLD = 0.01;
const SPEECH_ENERGY_THRESHOLD = 0.04;

const recentOutputs: string[] = [];
const MAX_RECENT = 10;

function hasSpeechActivity(audio: Float32Array): boolean {
  const frameSize = 1600;
  let speechFrames = 0;
  const totalFrames = Math.floor(audio.length / frameSize);

  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    for (let j = 0; j < frameSize; j++) {
      const sample = audio[i * frameSize + j];
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / frameSize);
    if (rms > SPEECH_ENERGY_THRESHOLD) speechFrames++;
  }

  return speechFrames >= 2;
}

const HALLUCINATION_SET = new Set([
  'thank you', 'thank you for watching', 'thanks', 'thanks for watching',
  'please subscribe', 'subscribe', 'like and subscribe',
  'i\'m sorry', 'sorry', 'bye', 'goodbye', 'good bye', 'bye bye', 'bye-bye',
  'hello', 'hey', 'hi', 'okay', 'ok', 'yes', 'no', 'yeah', 'yep', 'nope',
  'hmm', 'uh', 'ah', 'oh', 'um', 'er', 'mhm',
  'music', 'applause', 'laughter', 'silence',
  'cheering', 'laughing', 'clapping', 'sighing', 'coughing',
  'see you', 'see you next time', 'have a good night', 'have a good day',
  'good night', 'good morning', 'good evening', 'good afternoon',
  'have a nice day', 'take care', 'you', 'the', 'i', 'it', 'a',
]);

function filterHallucinations(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  if (/^[\s.,!?\-…:;'"]+$/.test(trimmed)) return '';
  if (/^\(.*\)$/.test(trimmed) || /^\[.*\]$/.test(trimmed)) return '';

  const cleaned = trimmed.replace(/[.,!?…\-:;'"]+$/, '').replace(/^[.,!?…\-:;'"]+/, '').trim().toLowerCase();
  if (!cleaned || cleaned.length < 2) return '';

  if (HALLUCINATION_SET.has(cleaned)) return '';

  const duplicateCount = recentOutputs.filter(o => o === cleaned).length;
  if (duplicateCount >= 2) return '';

  recentOutputs.push(cleaned);
  if (recentOutputs.length > MAX_RECENT) recentOutputs.shift();

  return trimmed;
}

async function transcribeLocal(audio: Float32Array): Promise<void> {
  if (!transcriber) {
    self.postMessage({ type: 'error', message: 'Model not loaded' } satisfies WorkerResponse);
    return;
  }

  const energy = getAudioEnergy(audio);
  if (energy < SILENCE_THRESHOLD) return;
  if (!hasSpeechActivity(audio)) return;

  try {
    const result = await transcriber(audio, {
      top_k: 0,
      do_sample: false,
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'korean',
      task: currentTask,
      return_timestamps: false,
      force_full_sequences: false,
    } as Record<string, unknown>);

    const rawText = Array.isArray(result) ? result[0]?.text ?? '' : result.text ?? '';
    const finalText = filterHallucinations(rawText);
    if (finalText) {
      self.postMessage({ type: 'final', text: finalText } satisfies WorkerResponse);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcription failed';
    self.postMessage({ type: 'error', message } satisfies WorkerResponse);
  }
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type } = event.data;

  if (type === 'load') {
    const { mode, apiKey, model, task, dtype, cloudPipeline, cloudModel, cloudTranslateModel, sentenceBuffered, sentenceModel } = event.data;
    currentMode = mode;
    currentTask = task || 'translate';
    currentCloudPipeline = cloudPipeline || 'direct';
    currentCloudModel = cloudModel || 'whisper-1';
    currentCloudTranslateModel = cloudTranslateModel || 'gpt-4o-mini';
    sentenceBufferedEnabled = sentenceBuffered || false;
    sentenceModelName = sentenceModel || 'gpt-4.1-mini';
    sentenceBuffer = '';
    completedSentences = [];

    try {
      if (mode === 'cloud') {
        await loadCloudMode(apiKey || '');
      } else {
        await loadLocalModel(model || 'onnx-community/whisper-small', dtype || 'auto');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize';
      self.postMessage({ type: 'error', message } satisfies WorkerResponse);
    }
  }

  if (type === 'transcribe') {
    if (currentMode === 'cloud') {
      await transcribeCloud(event.data.audio);
    } else {
      await transcribeLocal(event.data.audio);
    }
  }
};
