import { useState } from 'react';
import './App.css';
import { useWhisper } from './hooks/useWhisper';
import { config } from './config';

function App() {
  const {
    isLoading,
    loadingProgress,
    isReady,
    isRecording,
    partialText,
    textHistory,
    error,
    backend,
    sentenceBuffered,
    transcriptSentences,
    transcriptPending,
    translations,
    startRecording,
    stopRecording,
  } = useWhisper();

  const [showTranscript, setShowTranscript] = useState(true);

  if (error && !isRecording) {
    return (
      <div className="container">
        <div className="error-container">
          <div className="error-text">{error}</div>
          <button className="retry-button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    const encoderDecoderFiles = Object.entries(loadingProgress).filter(([filename]) => 
      filename.includes('encoder') || filename.includes('decoder')
    );
    const overallProgress = encoderDecoderFiles.length > 0
      ? encoderDecoderFiles.reduce((sum, [, progress]) => sum + progress, 0) / encoderDecoderFiles.length
      : 0;

    return (
      <div className="container">
        <div className="loading-container">
          <div className="loading-text">Loading model...</div>
          
          <div className="progress-list">
            {encoderDecoderFiles.map(([filename, progress]) => {
              const label = filename.includes('encoder') ? 'Encoder' : 'Decoder';
              return (
                <div key={filename} className="progress-item">
                  <div className="progress-label">
                    <span>{label}</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {encoderDecoderFiles.length > 0 && (
            <div className="overall-progress">
              Overall: {Math.round(overallProgress)}%
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isReady && !isRecording) {
    return (
      <div className="container">
        <div className="ready-container">
          <div className="backend-badge">
            {config.mode === 'cloud'
              ? `Cloud: ${config.cloud.pipeline === 'transcribe-translate' ? 'gpt-4o + translate' : 'whisper-1'}`
              : backend === 'webgpu' ? 'WebGPU' : 'WASM'}
          </div>
          <div className="ready-text">Speak Korean, see English</div>
          <button className="start-button" onClick={startRecording}>
            Start
          </button>
        </div>
      </div>
    );
  }

  if (isRecording && sentenceBuffered) {
    return (
      <div className="container">
        <div className="recording-container">
          <div className="recording-header">
            <div className="recording-indicator">
              <div className="recording-dot" />
              <span>Recording</span>
            </div>
            <button
              className="toggle-transcript-button"
              onClick={() => setShowTranscript(prev => !prev)}
            >
              {showTranscript ? 'Hide Korean' : 'Show Korean'}
            </button>
          </div>

          <div className={`dual-pane ${showTranscript ? '' : 'single-pane'}`}>
            {showTranscript && (
              <div className="pane transcript-pane">
                <div className="pane-label">Korean</div>
                <div className="pane-content">
                  {transcriptSentences.slice(-10).map((sentence, index, arr) => (
                    <div
                      key={index}
                      className="sentence-line"
                      style={{ opacity: Math.max(0.3, (index + 1) / arr.length) }}
                    >
                      {sentence}
                    </div>
                  ))}
                  {transcriptPending && (
                    <div className="sentence-line">
                      <span className="pending-text">{transcriptPending}</span>
                    </div>
                  )}
                  {transcriptSentences.length === 0 && !transcriptPending && (
                    <div className="partial-text">Listening...</div>
                  )}
                </div>
              </div>
            )}

            <div className="pane translation-pane">
              <div className="pane-label">English</div>
              <div className="pane-content">
                {translations.map((text, index) => (
                  <div
                    key={index}
                    className="history-line"
                    style={{ opacity: Math.max(0.3, (index + 1) / translations.length) }}
                  >
                    {text}
                  </div>
                ))}
                {translations.length === 0 && (
                  <div className="partial-text">Waiting for sentences...</div>
                )}
              </div>
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}

          <div className="stop-button-container">
            <button className="stop-button" onClick={stopRecording}>
              Stop
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isRecording) {
    return (
      <div className="container">
        <div className="recording-container">
          <div className="recording-indicator">
            <div className="recording-dot" />
            <span>Recording</span>
          </div>

          <div className="transcript-display">
            <div className="text-history">
              {textHistory.map((text, index) => (
                <div
                  key={index}
                  className="history-line"
                  style={{ opacity: (index + 1) / textHistory.length }}
                >
                  {text}
                </div>
              ))}
            </div>
            {partialText && <div className="partial-text">{partialText}</div>}
            {!partialText && textHistory.length === 0 && (
              <div className="partial-text">Listening...</div>
            )}
          </div>

          {error && <div className="error-text">{error}</div>}

          <div className="stop-button-container">
            <button className="stop-button" onClick={stopRecording}>
              Stop
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default App;
