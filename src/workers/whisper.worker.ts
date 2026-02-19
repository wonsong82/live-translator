import { pipeline, env } from '@huggingface/transformers';
import { config } from '../config';

env.allowLocalModels = false;

type Transcriber = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>;

type WorkerMessage =
  | { type: 'load' }
  | { type: 'transcribe'; audio: Float32Array };

type WorkerResponse =
  | { type: 'loading'; file: string; progress: number; loaded?: number; total?: number }
  | { type: 'ready'; backend: string }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'transcript-update'; sentences: string[]; pending: string }
  | { type: 'translation-update'; text: string }
  | { type: 'error'; message: string };

const sentenceBufferedEnabled =
  config.mode === 'cloud' &&
  config.cloud.pipeline === 'transcribe-translate' &&
  config.cloud.sentenceBuffered;

const proofReadEnabled =
  sentenceBufferedEnabled &&
  config.cloud.proofReading;

let transcriber: Transcriber | null = null;
let sentenceBuffer = '';
let completedSentences: string[] = [];
let contextBuffer: string[] = [];

async function detectWebGPU(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

async function loadLocalModel(): Promise<void> {
  const hasWebGPU = await detectWebGPU();
  const device = hasWebGPU ? 'webgpu' : 'wasm';
  
  let dtype: string;
  if (config.local.dtype === 'auto') {
    dtype = hasWebGPU ? 'fp32' : 'q8';
  } else {
    dtype = config.local.dtype;
  }

  transcriber = await (pipeline as Function)(
    'automatic-speech-recognition',
    config.local.model,
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

async function loadCloudMode(): Promise<void> {
  if (!config.cloud.apiKey) {
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
  formData.append('model', config.cloud.model);
    formData.append('response_format', 'json');

  const response = await fetch('https://api.openai.com/v1/audio/translations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.cloud.apiKey}` },
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

async function transcribeAudio(audio: Float32Array): Promise<string> {
  const wavBlob = float32ToWav(audio, 16000);
  const formData = new FormData();
  formData.append('file', wavBlob, 'audio.wav');
  formData.append('model', config.cloud.transcribeModel);
  formData.append('response_format', 'json');
  formData.append('language', 'ko');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.cloud.apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Transcribe error: ${response.status}`);
  }

  const result = await response.json();
  return result.text || '';
}

async function translate(text: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.cloud.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.cloud.translateModel,
      messages: [
        { role: 'system', content: 'Translate the following Korean text to English. Output ONLY the English translation, nothing else.' },
        { role: 'user', content: text },
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
      'Authorization': `Bearer ${config.cloud.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.cloud.sentenceModel,
      messages: [
        {
          role: 'system',
          content: `You are a Korean sentence boundary detector. Given Korean text from a live speech transcription, split it into complete sentences and any remaining incomplete fragment.

Rules:
- A complete sentence ends with a natural sentence-ending pattern (e.g., 다, 요, 죠, 까, 네, 지, 야, etc.)
- Maintain the EXACT original text — do not modify, correct, or rephrase anything
- Do not include puncuation marks in the response
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

async function proofreadSentences(newSentences: string[], context: string[]): Promise<string[]> {
  if (newSentences.length === 0) return [];

  const contextBlock = context.length > 0
    ? context.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '(no previous context)';

  const newBlock = newSentences.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.cloud.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.cloud.proofReadModel,
      messages: [
        {
          role: 'system',
          content: `You are a Korean speech transcription proofreader. You receive newly transcribed Korean sentences and previous context sentences. Your job is to check the NEW sentences for mis-transcriptions and correct them.

Rules:
- Only correct words that are clearly wrong given the conversational context
- Do NOT rephrase, rewrite, or change sentence structure
- Do NOT add or remove punctuation marks
- Preserve the speaker's original meaning, tone, and style
- If a sentence looks correct, return it unchanged
- Return exactly the same number of sentences as the input, in the same order

Previous sentences for context:
${contextBlock}

Respond with ONLY valid JSON: {"corrected": ["교정된 문장1", "교정된 문장2"]}`
        },
        { role: 'user', content: `New sentences to proofread:\n${newBlock}` },
      ],
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Proofread error: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content?.trim() || '{}';

  try {
    const parsed = JSON.parse(content) as { corrected?: string[] };
    const corrected = Array.isArray(parsed.corrected) ? parsed.corrected : [];
    return corrected.length === newSentences.length ? corrected : newSentences;
  } catch {
    return newSentences;
  }
}

async function cloudTranscribeTranslate(audio: Float32Array): Promise<void> {
  const koreanText = await transcribeAudio(audio);
  if (!koreanText.trim()) return;

  const englishText = await translate(koreanText);
  const finalText = filterHallucinations(englishText);
  if (finalText) {
    self.postMessage({ type: 'final', text: finalText } satisfies WorkerResponse);
  }
}

async function cloudSentenceBuffered(audio: Float32Array): Promise<void> {
  const koreanText = await transcribeAudio(audio);
  if (!koreanText.trim()) return;

  sentenceBuffer = sentenceBuffer ? sentenceBuffer + ' ' + koreanText.trim() : koreanText.trim();

  if (proofReadEnabled) {
    self.postMessage({
      type: 'transcript-update',
      sentences: completedSentences.slice(),
      pending: sentenceBuffer,
    } satisfies WorkerResponse);
  }

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

  let sentencesToTranslate = sentences;

  if (proofReadEnabled && sentences.length > 0) {
    try {
      const corrected = await proofreadSentences(sentences, contextBuffer);
      const insertIndex = completedSentences.length - sentences.length;
      for (let i = 0; i < corrected.length; i++) {
        completedSentences[insertIndex + i] = corrected[i];
      }

      self.postMessage({
        type: 'transcript-update',
        sentences: completedSentences.slice(),
        pending: sentenceBuffer,
      } satisfies WorkerResponse);

      sentencesToTranslate = corrected;
    } catch {
      // Proofread failed — use raw sentences, don't block translation
    }

    contextBuffer.push(...sentencesToTranslate);
    if (contextBuffer.length > config.cloud.proofReadContextSize) {
      contextBuffer = contextBuffer.slice(-config.cloud.proofReadContextSize);
    }
  }

  for (const sentence of sentencesToTranslate) {
    const englishText = await translate(sentence);
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
    if (config.cloud.pipeline === 'transcribe-translate' && sentenceBufferedEnabled) {
      await cloudSentenceBuffered(audio);
    } else if (config.cloud.pipeline === 'transcribe-translate') {
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
      task: config.local.task,
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
    sentenceBuffer = '';
    completedSentences = [];
    contextBuffer = [];

    try {
      if (config.mode === 'cloud') {
        await loadCloudMode();
      } else {
        await loadLocalModel();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize';
      self.postMessage({ type: 'error', message } satisfies WorkerResponse);
    }
  }

  if (type === 'transcribe') {
    if (config.mode === 'cloud') {
      await transcribeCloud(event.data.audio);
    } else {
      await transcribeLocal(event.data.audio);
    }
  }
};
