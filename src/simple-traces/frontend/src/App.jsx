import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [traces, setTraces] = useState([])
  const [selectedTrace, setSelectedTrace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState('connecting') // 'connected', 'disconnected', 'connecting'
  const [newTracesCount, setNewTracesCount] = useState(0)
  const previousTraceCountRef = useRef(0)
  const isPollingRef = useRef(false)
  const abortControllerRef = useRef(null)

  useEffect(() => {
    startLongPolling()
    
    return () => {
      // Cleanup on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const startLongPolling = async () => {
    while (true) {
      try {
        // Cancel previous request if any
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
        }
        
        abortControllerRef.current = new AbortController()
        
        const response = await fetch('/api/traces', {
          signal: abortControllerRef.current.signal
        })
        
        if (!response.ok) {
          throw new Error('Failed to fetch traces')
        }
        
        const data = await response.json()
        const newData = data || []
        
        // Update connection status to connected
        setConnectionStatus('connected')
        setLoading(false)
        
        // Check if there are new traces
        if (newData.length > previousTraceCountRef.current) {
          const newCount = newData.length - previousTraceCountRef.current
          setNewTracesCount(newCount)
        } else if (newData.length < previousTraceCountRef.current) {
          // Handle trace deletion
          setNewTracesCount(0)
        }
        
        setTraces(newData)
        previousTraceCountRef.current = newData.length
        
        // Wait before next poll (long polling with 3 second delay)
        await new Promise(resolve => setTimeout(resolve, 3000))
        
      } catch (err) {
        if (err.name === 'AbortError') {
          // Request was aborted, this is expected on cleanup
          break
        }
        
        console.debug('Polling error:', err)
        setConnectionStatus('disconnected')
        setLoading(false)
        
        // Wait longer before retrying on error (5 seconds)
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
  }

  const formatDuration = (ms) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString()
  }

  const handleDismissNewBadge = () => {
    setNewTracesCount(0)
  }

  const getConnectionStatusDisplay = () => {
    switch (connectionStatus) {
      case 'connected':
        return { icon: '🟢', text: 'Connected', className: 'status-connected' }
      case 'disconnected':
        return { icon: '🔴', text: 'Disconnected', className: 'status-disconnected' }
      case 'connecting':
        return { icon: '🟡', text: 'Connecting...', className: 'status-connecting' }
      default:
        return { icon: '🟡', text: 'Connecting...', className: 'status-connecting' }
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🔍 Simple Traces</h1>
        <p>LLM Tracing Tool</p>
      </header>

      <div className="container">
        {loading && <div className="loading">Loading traces...</div>}
        
        {!loading && traces.length === 0 && (
          <div className="empty-state">
            <div className="connection-status-banner">
              <span className={`status-indicator ${getConnectionStatusDisplay().className}`}>
                {getConnectionStatusDisplay().icon} {getConnectionStatusDisplay().text}
              </span>
            </div>
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

        {!loading && traces.length > 0 && (
          <div className="content">
            <div className="traces-list">
              <div className="list-header">
                <h2>
                  Recent Traces ({traces.length})
                  {newTracesCount > 0 && (
                    <span className="new-badge" onClick={handleDismissNewBadge}>
                      +{newTracesCount} new
                    </span>
                  )}
                </h2>
                <div className="header-controls">
                  <span className={`connection-status ${getConnectionStatusDisplay().className}`}>
                    {getConnectionStatusDisplay().icon} {getConnectionStatusDisplay().text}
                  </span>
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
