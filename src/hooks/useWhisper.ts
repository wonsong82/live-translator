import { useState, useEffect, useRef, useCallback } from 'react';
import {
  startMicrophoneCapture,
  stopMicrophoneCapture,
  convertBlobToFloat32Array,
  getSupportedMimeType,
  MicrophoneError,
} from '../utils/audio';
import { config } from '../config';

const isSentenceBuffered =
  config.mode === 'cloud' &&
  config.cloud.pipeline === 'transcribe-translate' &&
  config.cloud.sentenceBuffered;

const RECORDING_DURATION_MS = config.mode === 'cloud'
  ? config.cloud.recordingIntervalMs
  : config.local.recordingIntervalMs;

type WorkerResponse =
  | { type: 'loading'; file: string; progress: number; loaded?: number; total?: number }
  | { type: 'ready'; backend: string }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'transcript-update'; sentences: string[]; pending: string }
  | { type: 'translation-update'; text: string }
  | { type: 'error'; message: string };

interface LoadingProgress {
  [filename: string]: number;
}

interface UseWhisperReturn {
  isLoading: boolean;
  loadingProgress: LoadingProgress;
  isReady: boolean;
  isRecording: boolean;
  partialText: string;
  textHistory: string[];
  error: string | null;
  backend: string | null;
  sentenceBuffered: boolean;
  transcriptSentences: string[];
  transcriptPending: string;
  translations: string[];
  startRecording: () => Promise<void>;
  stopRecording: () => void;
}

export function useWhisper(): UseWhisperReturn {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress>({});
  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [partialText, setPartialText] = useState('');
  const [textHistory, setTextHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<string | null>(null);

  const [transcriptSentences, setTranscriptSentences] = useState<string[]>([]);
  const [transcriptPending, setTranscriptPending] = useState('');
  const [translations, setTranslations] = useState<string[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/whisper.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;

      switch (data.type) {
        case 'loading':
          setLoadingProgress(prev => ({
            ...prev,
            [data.file]: data.progress,
          }));
          break;
        case 'ready':
          setIsLoading(false);
          setIsReady(true);
          setBackend(data.backend);
          break;
        case 'partial':
          setPartialText(data.text);
          break;
        case 'final':
          setTextHistory(prev => [...prev.slice(-9), data.text]);
          setPartialText('');
          break;
        case 'transcript-update':
          setTranscriptSentences(data.sentences);
          setTranscriptPending(data.pending);
          break;
        case 'translation-update':
          setTranslations(prev => [...prev.slice(-9), data.text]);
          break;
        case 'error':
          setError(data.message);
          break;
      }
    };

    worker.onerror = (event) => {
      setError(`Worker error: ${event.message}`);
      setIsLoading(false);
    };

    workerRef.current = worker;
    worker.postMessage({ type: 'load' });

    return () => {
      worker.terminate();
    };
  }, []);

  const isRecordingRef = useRef(false);

  const processRecording = useCallback(async (blob: Blob) => {
    if (!workerRef.current || blob.size === 0) return;

    try {
      const audioData = await convertBlobToFloat32Array(blob);
      if (audioData.length > 0) {
        workerRef.current.postMessage({ type: 'transcribe', audio: audioData });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Audio processing failed';
      setError(message);
    }
  }, []);

  const startNewRecording = useCallback(() => {
    if (!streamRef.current || !isRecordingRef.current) return;

    const mimeType = getSupportedMimeType();
    const mediaRecorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = mediaRecorder;

    const chunks: Blob[] = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      processRecording(blob);

      if (isRecordingRef.current && streamRef.current) {
        startNewRecording();
      }
    };

    mediaRecorder.start();

    setTimeout(() => {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, RECORDING_DURATION_MS);
  }, [processRecording]);

  const startRecording = useCallback(async () => {
    if (!isReady || isRecording) return;

    setError(null);
    setPartialText('');
    setTextHistory([]);
    setTranscriptSentences([]);
    setTranscriptPending('');
    setTranslations([]);

    try {
      const stream = await startMicrophoneCapture();
      streamRef.current = stream;
      isRecordingRef.current = true;
      setIsRecording(true);

      startNewRecording();
    } catch (err) {
      if (err instanceof MicrophoneError) {
        setError(err.message);
      } else {
        setError('Failed to start recording');
      }
    }
  }, [isReady, isRecording, startNewRecording]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (streamRef.current) {
      stopMicrophoneCapture(streamRef.current);
      streamRef.current = null;
    }

    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current?.stop();
      if (streamRef.current) stopMicrophoneCapture(streamRef.current);
    };
  }, []);

  return {
    isLoading,
    loadingProgress,
    isReady,
    isRecording,
    partialText,
    textHistory,
    error,
    backend,
    sentenceBuffered: isSentenceBuffered,
    transcriptSentences,
    transcriptPending,
    translations,
    startRecording,
    stopRecording,
  };
}
