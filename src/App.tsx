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
    startRecording,
    stopRecording,
  } = useWhisper();

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
            {config.mode === 'cloud' ? 'Cloud (OpenAI)' : backend === 'webgpu' ? 'WebGPU' : 'WASM'}
          </div>
          <div className="ready-text">Speak Korean, see English</div>
          <button className="start-button" onClick={startRecording}>
            Start
          </button>
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
