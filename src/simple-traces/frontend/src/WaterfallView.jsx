import { useState, useMemo } from 'react'
import './WaterfallView.css'

function WaterfallView({ spans, onSpanClick, selectedSpanId }) {
  if (!spans || spans.length === 0) {
    return <div className="waterfall-empty">No spans to display</div>
  }

  // Calculate timeline bounds
  const { minTime, maxTime, totalDuration } = useMemo(() => {
    const times = spans.map(s => ({
      start: new Date(s.start_time).getTime(),
      end: new Date(s.end_time).getTime()
    }))
    const min = Math.min(...times.map(t => t.start))
    const max = Math.max(...times.map(t => t.end))
    return {
      minTime: min,
      maxTime: max,
      totalDuration: max - min
    }
  }, [spans])

  // Get position and width for each span
  const getSpanStyle = (span) => {
    const start = new Date(span.start_time).getTime()
    const end = new Date(span.end_time).getTime()
    const duration = end - start
    
    const left = ((start - minTime) / totalDuration) * 100
    const width = (duration / totalDuration) * 100
    
    return {
      left: `${left}%`,
      width: `${Math.max(width, 0.5)}%` // Minimum 0.5% width for visibility
    }
  }

  // Get color for span based on status or type
  const getSpanColor = (span) => {
    let attrs = null
    try {
      attrs = span.attributes ? JSON.parse(span.attributes) : null
    } catch (e) {
      attrs = null
    }

    // Color by status
    if (span.status_code === 'ERROR') return '#ef4444'
    if (span.status_code === 'OK') return '#10b981'
    
    // Color by type/phase
    if (attrs) {
      if (attrs['llm.input'] || attrs['gen_ai.prompt']) return '#6366f1'
      if (attrs['llm.output'] || attrs['gen_ai.response']) return '#8b5cf6'
      if (attrs.phase === 'research') return '#f59e0b'
    }
    
    // Default color
    return '#6b7280'
  }

  // Format duration
  const formatDuration = (ms) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  // Format timestamp
  const formatTime = (ts) => {
    const date = new Date(ts)
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })
  }

  return (
    <div className="waterfall-container">
      <div className="waterfall-header">
        <div className="waterfall-title">Timeline</div>
        <div className="waterfall-duration">Total: {formatDuration(totalDuration)}</div>
      </div>
      
      <div className="waterfall-timeline">
        {spans.map((span, idx) => {
          const style = getSpanStyle(span)
          const color = getSpanColor(span)
          const duration = new Date(span.end_time).getTime() - new Date(span.start_time).getTime()
          const isSelected = selectedSpanId === span.span_id
          
          return (
            <div 
              key={span.span_id} 
              className={`waterfall-row ${isSelected ? 'selected' : ''}`}
              onClick={() => onSpanClick && onSpanClick(span)}
            >
              <div className="waterfall-label">
                <span className="span-name">{span.name}</span>
                <span className="span-duration">{formatDuration(duration)}</span>
              </div>
              <div className="waterfall-track">
                <div 
                  className="waterfall-bar"
                  style={{ 
                    ...style, 
                    backgroundColor: color,
                  }}
                  title={`${span.name}\nStart: ${formatTime(span.start_time)}\nEnd: ${formatTime(span.end_time)}\nDuration: ${formatDuration(duration)}\nStatus: ${span.status_code || 'N/A'}`}
                >
                  <div className="waterfall-bar-label">{span.name}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      
      {/* Timeline markers */}
      <div className="waterfall-axis">
        <div className="axis-marker" style={{ left: '0%' }}>{formatTime(new Date(minTime))}</div>
        <div className="axis-marker" style={{ left: '25%' }}>+{formatDuration(totalDuration * 0.25)}</div>
        <div className="axis-marker" style={{ left: '50%' }}>+{formatDuration(totalDuration * 0.5)}</div>
        <div className="axis-marker" style={{ left: '75%' }}>+{formatDuration(totalDuration * 0.75)}</div>
        <div className="axis-marker" style={{ left: '100%' }}>{formatTime(new Date(maxTime))}</div>
      </div>
    </div>
  )
}

export default WaterfallView
