import React, { useMemo, useState } from 'react'
import './WaterfallView.css'

function WaterfallView({
  spans,
  onSpanClick,
  selectedSpanId,
  linkedConversations = [],
  compact = false,
  showLegend = true,
  defaultCollapsed = false,
}) {
  const truncate = (s, n) => {
    if (!s) return s
    if (s.length <= n) return s
    return s.slice(0, Math.max(0, n - 1)) + '…'
  }
  
  // Helper function to check if a span has linked conversations
  const hasLinks = (spanId) => {
    return linkedConversations && linkedConversations.some(link => link.span_id === spanId)
  }
  
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

  // Group spans by trace_id to show clearer structure within a conversation
  const groups = useMemo(() => {
    const m = new Map()
    for (const sp of spans) {
      const id = sp.trace_id || 'unknown'
      if (!m.has(id)) m.set(id, [])
      m.get(id).push(sp)
    }
    const arr = Array.from(m.entries()).map(([traceId, list]) => {
      const sorted = [...list].sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      const gMin = Math.min(...sorted.map(s => new Date(s.start_time).getTime()))
      const gMax = Math.max(...sorted.map(s => new Date(s.end_time).getTime()))
      
      // Build hierarchical tree
      const spanMap = new Map()
      const rootSpans = []
      
      // Create map of all spans
      sorted.forEach(span => {
        spanMap.set(span.span_id, { ...span, children: [] })
      })
      
      // Build tree structure
      sorted.forEach(span => {
        const node = spanMap.get(span.span_id)
        if (!span.parent_span_id || span.parent_span_id === '' || span.parent_span_id === '0000000000000000') {
          rootSpans.push(node)
        } else {
          const parent = spanMap.get(span.parent_span_id)
          if (parent) {
            parent.children.push(node)
          } else {
            rootSpans.push(node)
          }
        }
      })
      
      return { traceId, spans: sorted, rootSpans, gMin, gMax }
    })
    // Order groups by first activity
    arr.sort((a, b) => a.gMin - b.gMin)
    return arr
  }, [spans])
  
  // Collapsible groups: keep a map of traceId -> collapsed
  const [collapsed, setCollapsed] = useState(() => {
    const init = {}
    for (const g of groups) {
      // Collapse all root spans by default
      g.rootSpans.forEach(root => {
        init[root.span_id] = defaultCollapsed
      })
    }
    return init
  })
  const toggleSpan = (spanId) => setCollapsed((c) => ({ ...c, [spanId]: !c[spanId] }))


  // Get color for span based on status or type
  const getSpanColor = (span) => {
    // Use same colors for all spans, including linked conversation spans

    // Special color for virtual link spans
    if (span.isVirtualLink) return '#06b6d4' // cyan for links
    
    let attrs = null
    try {
      attrs = span.attributes ? JSON.parse(span.attributes) : null
    } catch (e) {
      attrs = null
    }

    // Color by status
    if (span.status_code === 'ERROR') return '#ef4444'
    if (span.status_code === 'OK') return '#10b981'
    if (span.status_code === 'LINKED') return '#06b6d4'

    // Priority 1: Use simpleTraces.span.kind if available
    if (attrs) {
      const spanKind = attrs['simpleTraces.span.kind']
      if (spanKind === 'agent') return '#8b5cf6'
      if (spanKind === 'llm' || spanKind === 'model') return '#3b82f6'
      if (spanKind === 'tool') return '#f59e0b'
      if (spanKind === 'invocation') return '#64748b'
      
      // Check for SDK hints
      const sdk = attrs['simpleTraces.SDK']
      if (sdk === 'google-adk' || sdk === 'adk') return '#14b8a6'
    }

    // Priority 2: Color by name/category
    const name = (span.name || '').toLowerCase()
    if (name.includes('call_llm') || name.includes('llm')) return '#3b82f6'
    if (name.includes('invoke_agent')) return '#8b5cf6'
    if (name.includes('execute_tool sleep_tool') || name === 'sleep_tool') return '#6b7280'
    if (name.includes('execute_tool')) return '#f59e0b'
    if (name.includes('torrentagent') || name.includes('adk.agent')) return '#14b8a6'
    if (name.includes('invocation')) return '#64748b'

    // Priority 3: Attribute hints
    if (attrs) {
      if (attrs['llm.input'] || attrs['gen_ai.prompt']) return '#3b82f6'
      if (attrs['llm.output'] || attrs['gen_ai.response']) return '#8b5cf6'
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

  // Render span node hierarchically with indentation
  const renderSpanNode = (node, depth = 0) => {
    const span = node
    const start = new Date(span.start_time).getTime()
    const end = new Date(span.end_time).getTime()
    const duration = end - start
    const leftPct = ((start - minTime) / totalDuration) * 100
    const widthPctRaw = (duration / totalDuration) * 100
    const widthPct = Math.max(widthPctRaw, 0.5)
    const color = getSpanColor(span)
    const isSelected = selectedSpanId === span.span_id
    const isNarrow = widthPct < 8
    const indent = depth * 20 // 20px per level
    const hasChildren = node.children && node.children.length > 0
    const isCollapsed = collapsed[span.span_id]
    const showLinkIcon = hasLinks(span.span_id)

    return (
      <React.Fragment key={span.span_id}>
        <div
          className={`waterfall-row ${isSelected ? 'selected' : ''} ${span.isFromLinkedConversation ? 'from-linked-row' : ''}`}
          onClick={() => onSpanClick && onSpanClick(span)}
        >
          <div className="waterfall-label" style={{ paddingLeft: `${indent}px` }}>
            <span className="span-name" onClick={(e) => {
              if (hasChildren) {
                e.stopPropagation()
                toggleSpan(span.span_id)
              }
            }} style={{ cursor: hasChildren ? 'pointer' : 'default' }}>
              {hasChildren && (isCollapsed ? '▶ ' : '▼ ')}
              {depth > 0 && !hasChildren && '└─ '}
              {span.name}
              {showLinkIcon && (
                <span style={{ 
                  marginLeft: '0.5rem', 
                  fontSize: '0.9rem',
                  opacity: 0.7,
                  cursor: 'pointer'
                }} title="Has linked conversations">
                  🔗
                </span>
              )}
            </span>
            <span className="span-duration">{formatDuration(duration)}</span>
          </div>
          <div className="waterfall-track" role="presentation">
            <div
              className={`waterfall-bar ${isNarrow ? 'narrow' : ''} ${span.isVirtualLink ? 'virtual-link' : ''}`}
              style={{ 
                left: `${leftPct}%`, 
                width: `${widthPct}%`, 
                backgroundColor: color
              }}
              title={span.isFromLinkedConversation
                ? `${span.name} (from linked conversation)\nConversation: ${span.linkedConversationId}\nRelation: ${span.linkedRelation}\nStart: ${formatTime(span.start_time)}\nEnd: ${formatTime(span.end_time)}\nDuration: ${formatDuration(duration)}\nStatus: ${span.status_code || 'N/A'}`
                : `${span.name}\nStart: ${formatTime(span.start_time)}\nEnd: ${formatTime(span.end_time)}\nDuration: ${formatDuration(duration)}\nStatus: ${span.status_code || 'N/A'}`
              }
            >
              <div className="waterfall-bar-label">
                {span.isFromLinkedConversation && '🔗 '}
                {span.name}
              </div>
            </div>
          </div>
        </div>
        {hasChildren && !isCollapsed && node.children.map(child => renderSpanNode(child, depth + 1))}
      </React.Fragment>
    )
  }

  return (
    <div className={`waterfall-container ${compact ? 'compact' : ''}`}>
      <div className="waterfall-header">
        <div className="waterfall-title">Timeline</div>
        <div className="waterfall-duration">Total: {formatDuration(totalDuration)}</div>
      </div>

      {/* Legend for quick visual mapping */}
      {showLegend && (
        <div className="waterfall-legend" aria-label="timeline legend">
          <div className="legend-chip"><span className="dot" style={{ background: '#3b82f6' }} />model/llm</div>
          <div className="legend-chip"><span className="dot" style={{ background: '#8b5cf6' }} />agent</div>
          <div className="legend-chip"><span className="dot" style={{ background: '#f59e0b' }} />tool</div>
          <div className="legend-chip"><span className="dot" style={{ background: '#14b8a6' }} />google-adk</div>
          <div className="legend-chip"><span className="dot" style={{ background: '#64748b' }} />invocation</div>
          <div className="legend-chip"><span className="dot" style={{ background: '#10b981' }} />OK</div>
          <div className="legend-chip"><span className="dot" style={{ background: '#ef4444' }} />ERROR</div>
        </div>
      )}
      
      <div className="waterfall-groups">
        {groups.map((grp) => (
          <div key={grp.traceId} className="waterfall-group">
            <div className="waterfall-timeline">
              {grp.rootSpans.map((rootNode) => renderSpanNode(rootNode, 0))}
            </div>
          </div>
        ))}
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
