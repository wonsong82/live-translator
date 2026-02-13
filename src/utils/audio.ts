const TARGET_SAMPLE_RATE = 16000;

export class MicrophoneError extends Error {
  readonly cause?: unknown;
  
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'MicrophoneError';
    this.cause = cause;
  }
}

export async function startMicrophoneCapture(): Promise<MediaStream> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: { ideal: TARGET_SAMPLE_RATE },
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    return stream;
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new MicrophoneError('Microphone permission denied. Please allow microphone access.', error);
      }
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new MicrophoneError('No microphone found. Please connect a microphone.', error);
      }
    }
    throw new MicrophoneError('Failed to access microphone.', error);
  }
}

export function stopMicrophoneCapture(stream: MediaStream): void {
  stream.getTracks().forEach(track => track.stop());
}

export async function resampleAudio(audioBuffer: AudioBuffer): Promise<Float32Array> {
  if (audioBuffer.sampleRate === TARGET_SAMPLE_RATE) {
    return audioBuffer.getChannelData(0);
  }

  const resampledLength = Math.round(audioBuffer.duration * TARGET_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, resampledLength, TARGET_SAMPLE_RATE);

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}

export async function convertBlobToFloat32Array(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const resampled = await resampleAudio(audioBuffer);
    return resampled;
  } finally {
    await audioContext.close();
  }
}

export function mergeFloat32Arrays(arrays: Float32Array[]): Float32Array {
  if (arrays.length === 0) return new Float32Array(0);
  if (arrays.length === 1) return arrays[0];

  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const merged = new Float32Array(totalLength);
  
  let offset = 0;
  for (const array of arrays) {
    merged.set(array, offset);
    offset += array.length;
  }
  
  return merged;
}

export function getSupportedMimeType(): string {
  const mimeTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  
  for (const mimeType of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  
  return '';
}
