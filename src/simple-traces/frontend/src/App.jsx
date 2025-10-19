import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [traces, setTraces] = useState([])
  const [spans, setSpans] = useState([])
  const [selectedTrace, setSelectedTrace] = useState(null)
  const [selectedSpan, setSelectedSpan] = useState(null)
  const [viewMode, setViewMode] = useState('traces') // 'traces' or 'spans'
  const [loading, setLoading] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState('connecting') // 'connected', 'disconnected', 'connecting'
  const [newTracesCount, setNewTracesCount] = useState(0)
  const [newSpansCount, setNewSpansCount] = useState(0)
  const previousTraceCountRef = useRef(0)
  const previousSpanCountRef = useRef(0)
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
        
        // Fetch both traces and spans
        const [tracesResponse, spansResponse] = await Promise.all([
          fetch('/api/traces', {
            signal: abortControllerRef.current.signal
          }),
          fetch('/api/spans', {
            signal: abortControllerRef.current.signal
          })
        ])
        
        if (!tracesResponse.ok) {
          throw new Error(`Failed to fetch traces: ${tracesResponse.status}`)
        }
        if (!spansResponse.ok) {
          throw new Error(`Failed to fetch spans: ${spansResponse.status}`)
        }
        
        const tracesData = await tracesResponse.json()
        const spansData = await spansResponse.json()
        const newTracesData = tracesData || []
        const newSpansData = spansData || []
        
        // Update connection status to connected
        setConnectionStatus('connected')
        setLoading(false)
        
        // Check if there are new traces
        if (newTracesData.length > previousTraceCountRef.current) {
          const newCount = newTracesData.length - previousTraceCountRef.current
          setNewTracesCount(newCount)
        } else if (newTracesData.length < previousTraceCountRef.current) {
          // Handle trace deletion
          setNewTracesCount(0)
        }
        
        // Check if there are new spans
        if (newSpansData.length > previousSpanCountRef.current) {
          const newCount = newSpansData.length - previousSpanCountRef.current
          setNewSpansCount(newCount)
        } else if (newSpansData.length < previousSpanCountRef.current) {
          // Handle span deletion
          setNewSpansCount(0)
        }
        
        setTraces(newTracesData)
        setSpans(newSpansData)
        previousTraceCountRef.current = newTracesData.length
        previousSpanCountRef.current = newSpansData.length
        
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
    if (viewMode === 'traces') {
      setNewTracesCount(0)
    } else {
      setNewSpansCount(0)
    }
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
        
        {!loading && traces.length === 0 && spans.length === 0 && (
          <div className="empty-state">
            <div className="connection-status-banner">
              <span className={`status-indicator ${getConnectionStatusDisplay().className}`}>
                {getConnectionStatusDisplay().icon} {getConnectionStatusDisplay().text}
              </span>
            </div>
            <h2>No traces or spans yet</h2>
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
            <p>Or send OpenTelemetry spans to /v1/traces</p>
          </div>
        )}

        {!loading && (traces.length > 0 || spans.length > 0) && (
          <div className="content">
            <div className="traces-list">
              <div className="list-header">
                <div className="view-mode-switcher">
                  <button 
                    className={`view-mode-btn ${viewMode === 'traces' ? 'active' : ''}`}
                    onClick={() => {
                      setViewMode('traces')
                      setSelectedSpan(null)
                    }}
                  >
                    Traces ({traces.length})
                    {newTracesCount > 0 && viewMode === 'traces' && (
                      <span className="new-badge-inline">+{newTracesCount}</span>
                    )}
                  </button>
                  <button 
                    className={`view-mode-btn ${viewMode === 'spans' ? 'active' : ''}`}
                    onClick={() => {
                      setViewMode('spans')
                      setSelectedTrace(null)
                    }}
                  >
                    Spans ({spans.length})
                    {newSpansCount > 0 && viewMode === 'spans' && (
                      <span className="new-badge-inline">+{newSpansCount}</span>
                    )}
                  </button>
                </div>
                <div className="header-controls">
                  <span className={`connection-status ${getConnectionStatusDisplay().className}`}>
                    {getConnectionStatusDisplay().icon} {getConnectionStatusDisplay().text}
                  </span>
                </div>
              </div>
              
              {viewMode === 'traces' && traces.map((trace) => (
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

              {viewMode === 'spans' && spans.map((span) => (
                <div
                  key={span.span_id}
                  className={`trace-item ${selectedSpan?.span_id === span.span_id ? 'selected' : ''}`}
                  onClick={() => setSelectedSpan(span)}
                >
                  <div className="trace-header">
                    <span className="trace-model">{span.name}</span>
                    <span className="trace-duration">{formatDuration(span.duration_ms)}</span>
                  </div>
                  <div className="trace-preview">
                    Trace ID: {span.trace_id ? span.trace_id.substring(0, 16) : 'N/A'}...
                  </div>
                  <div className="trace-stats">
                    <span>🔖 {span.status_code || 'N/A'}</span>
                    <span>🕐 {formatTimestamp(span.start_time)}</span>
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

            {selectedSpan && (
              <div className="trace-details">
                <div className="details-header">
                  <h2>Span Details</h2>
                  <button onClick={() => setSelectedSpan(null)} className="close-btn">
                    ✕
                  </button>
                </div>
                
                <div className="detail-section">
                  <h3>Name</h3>
                  <p>{selectedSpan.name}</p>
                </div>

                <div className="detail-section">
                  <h3>Trace ID</h3>
                  <pre className="detail-content">{selectedSpan.trace_id}</pre>
                </div>

                <div className="detail-section">
                  <h3>Span ID</h3>
                  <pre className="detail-content">{selectedSpan.span_id}</pre>
                </div>

                <div className="detail-section">
                  <h3>Timing</h3>
                  <div className="stats-grid">
                    <div className="stat">
                      <span className="stat-label">Start Time</span>
                      <span className="stat-value">{formatTimestamp(selectedSpan.start_time)}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">End Time</span>
                      <span className="stat-value">{formatTimestamp(selectedSpan.end_time)}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">Duration</span>
                      <span className="stat-value">{formatDuration(selectedSpan.duration_ms)}</span>
                    </div>
                  </div>
                </div>

                <div className="detail-section">
                  <h3>Status</h3>
                  <div className="stats-grid">
                    <div className="stat">
                      <span className="stat-label">Status Code</span>
                      <span className="stat-value">{selectedSpan.status_code || 'N/A'}</span>
                    </div>
                    {selectedSpan.status_description && (
                      <div className="stat">
                        <span className="stat-label">Description</span>
                        <span className="stat-value">{selectedSpan.status_description}</span>
                      </div>
                    )}
                  </div>
                </div>

                {selectedSpan.attributes && selectedSpan.attributes !== '{}' && (
                  <div className="detail-section">
                    <h3>Attributes</h3>
                    <pre className="detail-content">{selectedSpan.attributes}</pre>
                  </div>
                )}

                {selectedSpan.events && selectedSpan.events !== '[]' && (
                  <div className="detail-section">
                    <h3>Events</h3>
                    <pre className="detail-content">{selectedSpan.events}</pre>
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
