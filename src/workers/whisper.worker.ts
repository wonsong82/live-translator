import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

type Transcriber = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>;

type DType = 'fp32' | 'fp16' | 'q8' | 'q4' | 'int8' | 'uint8' | 'auto';

type WorkerMessage =
  | { type: 'load'; mode: 'cloud' | 'local'; apiKey?: string; model?: string; dtype?: DType }
  | { type: 'transcribe'; audio: Float32Array };

type WorkerResponse =
  | { type: 'loading'; file: string; progress: number; loaded?: number; total?: number }
  | { type: 'ready'; backend: string }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string };

let transcriber: Transcriber | null = null;
let currentMode: 'cloud' | 'local' = 'local';
let cloudApiKey = '';

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

async function transcribeCloud(audio: Float32Array): Promise<void> {
  try {
    const wavBlob = float32ToWav(audio, 16000);
    const formData = new FormData();
    formData.append('file', wavBlob, 'audio.wav');
    formData.append('model', 'whisper-1');
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
    self.postMessage({ type: 'final', text: result.text || '' } satisfies WorkerResponse);
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

function filterHallucinations(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  
  const hallucinations = [
    /^\(.*\)$/,
    /^\[.*\]$/,
    /^i'?m sorry/i,
    /^sorry/i,
    /^thank you/i,
    /^thanks for watching/i,
    /^please subscribe/i,
    /^see you/i,
    /^bye/i,
    /^goodbye/i,
    /^hello/i,
    /^hey/i,
    /^hi$/i,
    /^okay\.?$/i,
    /^ok\.?$/i,
    /^yes\.?$/i,
    /^no\.?$/i,
    /^yeah\.?$/i,
    /^hmm+\.?$/i,
    /^uh+\.?$/i,
    /^ah+\.?$/i,
    /^oh+\.?$/i,
    /^\.+$/,
    /^,+$/,
    /^!+$/,
    /^\?+$/,
    /^-+$/,
    /^\.\.\.$/,
    /^music$/i,
    /^applause$/i,
    /^laughter$/i,
    /^silence$/i,
  ];
  
  for (const pattern of hallucinations) {
    if (pattern.test(trimmed)) return '';
  }
  
  if (trimmed.length < 3) return '';
  
  return trimmed;
}

async function transcribeLocal(audio: Float32Array): Promise<void> {
  if (!transcriber) {
    self.postMessage({ type: 'error', message: 'Model not loaded' } satisfies WorkerResponse);
    return;
  }

  const energy = getAudioEnergy(audio);
  if (energy < SILENCE_THRESHOLD) {
    return;
  }

  try {
    const result = await transcriber(audio, {
      top_k: 0,
      do_sample: false,
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'korean',
      task: 'translate',
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
    const { mode, apiKey, model, dtype } = event.data;
    currentMode = mode;

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
