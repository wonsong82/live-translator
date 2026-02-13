import './App.css';
import { useWhisper } from './hooks/useWhisper';

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
    return (
      <div className="container">
        <div className="loading-container">
          <div className="loading-text">
            Loading model... {Math.round(loadingProgress)}%
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (isReady && !isRecording) {
    return (
      <div className="container">
        <div className="ready-container">
          {backend && (
            <div className="backend-badge">
              {backend === 'webgpu' ? 'WebGPU Accelerated' : 'WASM'}
            </div>
          )}
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
