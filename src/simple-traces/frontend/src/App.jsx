import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [traces, setTraces] = useState([])
  const [selectedTrace, setSelectedTrace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pollingEnabled, setPollingEnabled] = useState(true)
  const [newTracesCount, setNewTracesCount] = useState(0)
  const [isPolling, setIsPolling] = useState(false)
  const previousTraceCountRef = useRef(0)
  const POLLING_INTERVAL = 5000 // 5 seconds

  useEffect(() => {
    fetchTraces()
  }, [])

  useEffect(() => {
    if (!pollingEnabled) {
      return
    }

    const intervalId = setInterval(() => {
      fetchTracesBackground()
    }, POLLING_INTERVAL)

    return () => clearInterval(intervalId)
  }, [pollingEnabled])

  const fetchTraces = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/traces')
      if (!response.ok) {
        throw new Error('Failed to fetch traces')
      }
      const data = await response.json()
      setTraces(data || [])
      previousTraceCountRef.current = (data || []).length
      setNewTracesCount(0)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchTracesBackground = async () => {
    try {
      setIsPolling(true)
      const response = await fetch('/api/traces')
      if (!response.ok) {
        return
      }
      const data = await response.json()
      const newData = data || []
      
      if (newData.length > previousTraceCountRef.current) {
        const newCount = newData.length - previousTraceCountRef.current
        setNewTracesCount(newCount)
        setTraces(newData)
        previousTraceCountRef.current = newData.length
      } else if (newData.length < previousTraceCountRef.current) {
        // Handle trace deletion - reset and update
        setTraces(newData)
        previousTraceCountRef.current = newData.length
        setNewTracesCount(0)
      }
    } catch (err) {
      // Silent fail for background polling, but log for debugging
      console.debug('Background polling error:', err)
    } finally {
      setIsPolling(false)
    }
  }

  const formatDuration = (ms) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString()
  }

  const handleRefresh = () => {
    setNewTracesCount(0)
    fetchTraces()
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🔍 Simple Traces</h1>
        <p>LLM Tracing Tool</p>
      </header>

      <div className="container">
        {loading && <div className="loading">Loading traces...</div>}
        
        {error && (
          <div className="error">
            Error: {error}
            <button onClick={fetchTraces}>Retry</button>
          </div>
        )}

        {!loading && !error && traces.length === 0 && (
          <div className="empty-state">
            <h2>No traces yet</h2>
            <p>Send a POST request to /api/traces to create your first trace</p>
            <pre className="code-block">
{`curl -X POST http://localhost:8080/api/traces \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4",
    "input": "What is AI?",
    "output": "AI is...",
    "prompt_tokens": 10,
    "output_tokens": 50,
    "duration": 1500
  }'`}
            </pre>
          </div>
        )}

        {!loading && !error && traces.length > 0 && (
          <div className="content">
            <div className="traces-list">
              <div className="list-header">
                <h2>
                  Recent Traces ({traces.length})
                  {newTracesCount > 0 && (
                    <span className="new-badge">+{newTracesCount} new</span>
                  )}
                </h2>
                <div className="header-controls">
                  <button 
                    onClick={() => setPollingEnabled(!pollingEnabled)} 
                    className={`polling-toggle ${pollingEnabled ? 'active' : ''}`}
                    title={pollingEnabled ? 'Disable auto-refresh' : 'Enable auto-refresh'}
                  >
                    {pollingEnabled ? '⏸️ Auto-refresh' : '▶️ Auto-refresh'}
                    {isPolling && pollingEnabled && <span className="polling-indicator">●</span>}
                  </button>
                  <button onClick={handleRefresh} className="refresh-btn">
                    🔄 Refresh
                  </button>
                </div>
              </div>
              
              {traces.map((trace) => (
                <div
                  key={trace.id}
                  className={`trace-item ${selectedTrace?.id === trace.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTrace(trace)}
                >
                  <div className="trace-header">
                    <span className="trace-model">{trace.model}</span>
                    <span className="trace-duration">{formatDuration(trace.duration)}</span>
                  </div>
                  <div className="trace-preview">
                    {trace.input.substring(0, 100)}
                    {trace.input.length > 100 ? '...' : ''}
                  </div>
                  <div className="trace-stats">
                    <span>📥 {trace.prompt_tokens}</span>
                    <span>📤 {trace.output_tokens}</span>
                    <span>🕐 {formatTimestamp(trace.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>

            {selectedTrace && (
              <div className="trace-details">
                <div className="details-header">
                  <h2>Trace Details</h2>
                  <button onClick={() => setSelectedTrace(null)} className="close-btn">
                    ✕
                  </button>
                </div>
                
                <div className="detail-section">
                  <h3>Model</h3>
                  <p>{selectedTrace.model}</p>
                </div>

                <div className="detail-section">
                  <h3>Input</h3>
                  <pre className="detail-content">{selectedTrace.input}</pre>
                </div>

                <div className="detail-section">
                  <h3>Output</h3>
                  <pre className="detail-content">{selectedTrace.output}</pre>
                </div>

                <div className="detail-section">
                  <h3>Statistics</h3>
                  <div className="stats-grid">
                    <div className="stat">
                      <span className="stat-label">Prompt Tokens</span>
                      <span className="stat-value">{selectedTrace.prompt_tokens}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">Output Tokens</span>
                      <span className="stat-value">{selectedTrace.output_tokens}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">Duration</span>
                      <span className="stat-value">{formatDuration(selectedTrace.duration)}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">Timestamp</span>
                      <span className="stat-value">{formatTimestamp(selectedTrace.timestamp)}</span>
                    </div>
                  </div>
                </div>

                {selectedTrace.metadata && selectedTrace.metadata !== '{}' && (
                  <div className="detail-section">
                    <h3>Metadata</h3>
                    <pre className="detail-content">{selectedTrace.metadata}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
