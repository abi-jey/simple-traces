import { useState, useEffect } from 'react'
import WaterfallView from './WaterfallView'
import './ConversationDetails.css'

function ConversationDetails({ conversationId, onClose }) {
  const [spans, setSpans] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSpan, setSelectedSpan] = useState(null)
  const [conversation, setConversation] = useState(null)
  const [linkedConversations, setLinkedConversations] = useState([])
  const [subConversations, setSubConversations] = useState([])
  const [showRawAttrs, setShowRawAttrs] = useState(false)
  const [showRawSpan, setShowRawSpan] = useState(false)

  useEffect(() => {
    if (conversationId) {
      fetchConversationData()
    }
  }, [conversationId])

  const fetchConversationData = async () => {
    setLoading(true)
    try {
      // Fetch spans for this conversation
      const res = await fetch(`/api/trace-groups/${encodeURIComponent(conversationId)}`)
      if (!res.ok) throw new Error('Failed to fetch conversation')
      const data = await res.json()
      setSpans(data)

      // Derive conversation metadata from spans (scan for model across spans)
      if (data.length > 0) {
        const first = data[0]
        const last = data[data.length - 1]

        // Try find a model across all spans to avoid 'unknown' when first span lacks it
        const findModel = () => {
          for (const sp of data) {
            try {
              const a = sp.attributes ? JSON.parse(sp.attributes) : null
              if (!a) continue
              if (a['st.model']) return String(a['st.model'])
              if (a['gen_ai.request.model']) return String(a['gen_ai.request.model'])
              if (a['llm.model']) return String(a['llm.model'])
              if (a['agent.model']) return String(a['agent.model'])
            } catch {
              // ignore parse issues
            }
          }
          return 'unknown'
        }

        setConversation({
          id: conversationId,
          first_start_time: first.start_time,
          last_end_time: last.end_time,
          span_count: data.length,
          model: findModel()
        })
      }
      
      // Fetch linked conversations
      try {
        const linkedRes = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/linked`)
        if (linkedRes.ok) {
          const linkedData = await linkedRes.json()
          setLinkedConversations(linkedData || [])
        }
      } catch (e) {
        console.warn('Failed to fetch linked conversations:', e)
      }
      
      // Fetch sub conversations
      try {
        const subRes = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/sub`)
        if (subRes.ok) {
          const subData = await subRes.json()
          setSubConversations(subData || [])
        }
      } catch (e) {
        console.warn('Failed to fetch sub conversations:', e)
      }
      
      setLoading(false)
    } catch (e) {
      console.error('Failed to fetch conversation:', e)
      setLoading(false)
    }
  }

  const formatTS = (ts) => new Date(ts).toLocaleString()

  const renderAttrTable = (attrJson) => {
    if (!attrJson) return null
    let attrs
    try {
      attrs = JSON.parse(attrJson)
    } catch (e) {
      return <pre className="detail-content">{attrJson}</pre>
    }
    const entries = Object.entries(attrs)
    if (entries.length === 0) return <div style={{ color: '#888' }}>no attributes</div>

    const typeOf = (v) => {
      if (v === null) return 'null'
      if (Array.isArray(v)) return 'array'
      const t = typeof v
      if (t === 'number') {
        return Number.isInteger(v) ? 'int' : 'float'
      }
      return t
    }
    const fmtVal = (v) => {
      if (v === null) return 'null'
      if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v
      if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      try {
        return JSON.stringify(v)
      } catch (e) {
        return String(v)
      }
    }

    return (
      <div className="detail-content" style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px' }}>key</th>
              <th style={{ textAlign: 'left', padding: '6px' }}>type</th>
              <th style={{ textAlign: 'left', padding: '6px' }}>value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '6px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{k}</td>
                <td style={{ padding: '6px', verticalAlign: 'top', color: '#666' }}>{typeOf(v)}</td>
                <td style={{ padding: '6px', verticalAlign: 'top' }}>{fmtVal(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const buildMessages = (sp) => {
    const msgs = []
    let attrs = null
    try { attrs = sp.attributes ? JSON.parse(sp.attributes) : null } catch (e) { attrs = null }
    if (attrs) {
      const sys = attrs['st.system_instruction'] || attrs['gen_ai.system'] || attrs['llm.system']
      const user = attrs['llm.input'] || attrs['gen_ai.prompt']
      const assistant = attrs['llm.output'] || attrs['gen_ai.response']
      if (sys) msgs.push({ role: 'system', text: String(sys) })
      if (user) msgs.push({ role: 'user', text: String(user) })
      if (assistant) msgs.push({ role: 'assistant', text: String(assistant) })

      // Fallbacks: parse Vertex Agent request/response JSON strings when prompt/response missing
      if (!user && typeof attrs['gcp.vertex.agent.llm_request'] === 'string') {
        try {
          const req = JSON.parse(attrs['gcp.vertex.agent.llm_request'])
          const contents = Array.isArray(req?.contents) ? req.contents : []
          let lastUser = ''
          for (const m of contents) {
            if ((m?.role || '').toLowerCase() === 'user' && Array.isArray(m.parts)) {
              const text = m.parts.map(p => p?.text).filter(Boolean).join('\n\n')
              if (text) lastUser = text
            }
          }
          if (lastUser) msgs.push({ role: 'user', text: lastUser })
        } catch {}
      }
      if (!assistant && typeof attrs['gcp.vertex.agent.llm_response'] === 'string') {
        try {
          const resp = JSON.parse(attrs['gcp.vertex.agent.llm_response'])
          const parts = Array.isArray(resp?.content?.parts) ? resp.content.parts : []
          const text = parts.map(p => p?.text).filter(Boolean).join('\n\n')
          if (text) msgs.push({ role: 'assistant', text })
        } catch {}
      }
    }
    if (msgs.length === 0) {
      msgs.push({ role: 'system', text: sp.name })
    }
    return msgs
  }

  if (loading) {
    return (
      <div className="conversation-details-page">
        <div className="loading">Loading conversation...</div>
      </div>
    )
  }

  return (
    <div className="conversation-details-page">
      <div className="details-page-header">
        <div>
          <h1>{conversation?.model || 'Conversation'}</h1>
          <div className="conversation-meta">
            <span>🧵 {conversationId.slice(0, 12)}...</span>
            <span>📊 {spans.length} spans</span>
            {conversation && (
              <>
                <span>🕒 {formatTS(conversation.first_start_time)}</span>
                <span>→ {formatTS(conversation.last_end_time)}</span>
              </>
            )}
          </div>
          {/* Linked conversations */}
          {linkedConversations && linkedConversations.length > 0 && (
            <div className="linked-conversations">
              <span className="linked-label">Links to:</span>
              {linkedConversations.map(id => (
                <span key={id} className="linked-conv-chip">{id.slice(0, 8)}...</span>
              ))}
            </div>
          )}
          {/* Sub conversations */}
          {subConversations && subConversations.length > 0 && (
            <div className="sub-conversations-info">
              <span className="linked-label">Sub-conversations:</span>
              {subConversations.map(id => (
                <span key={id} className="linked-conv-chip sub">{id.slice(0, 8)}...</span>
              ))}
            </div>
          )}
        </div>
        {onClose && (
          <button onClick={onClose} className="close-btn-large">
            ← Back
          </button>
        )}
      </div>

      <div className="details-page-content">
        {/* Waterfall View */}
        <div className="waterfall-section">
          <WaterfallView 
            spans={spans} 
            onSpanClick={setSelectedSpan}
            selectedSpanId={selectedSpan?.span_id}
            compact={true}
            showLegend={true}
            defaultCollapsed={true}
          />
        </div>

        {/* Span Details Panel (persistent with placeholder) */}
        <div className="span-details-panel">
          {selectedSpan ? (
            <>
              <div className="panel-header">
                <h2>{selectedSpan.name}</h2>
                <button onClick={() => setSelectedSpan(null)} className="close-btn">×</button>
              </div>

              <div className="panel-content">
                {/* Span Info */}
                <div className="detail-section">
                  <h3>Span Information</h3>
                  <div className="stats-grid">
                    <div className="stat">
                      <div className="stat-label">Span ID</div>
                      <div className="stat-value">{selectedSpan.span_id.slice(0, 16)}...</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Status</div>
                      <div className="stat-value">{selectedSpan.status_code || 'N/A'}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Start Time</div>
                      <div className="stat-value">{formatTS(selectedSpan.start_time)}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Duration</div>
                      <div className="stat-value">{selectedSpan.duration_ms}ms</div>
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div className="detail-section">
                  <h3>Messages</h3>
                  <div className="chat">
                    {buildMessages(selectedSpan).map((m, idx) => (
                      <div key={idx} className={`msg ${m.role}`}>
                        <div className="meta">{m.role}</div>
                        <div className="text">{m.text}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Attributes */}
                {selectedSpan.attributes && (
                  <div className="detail-section">
                    <h3>Attributes</h3>
                    {renderAttrTable(selectedSpan.attributes)}
                  </div>
                )}

                {/* Raw Attributes - Expandable */}
                <div className="detail-section">
                  <div 
                    className="expandable-header" 
                    onClick={() => setShowRawAttrs(!showRawAttrs)}
                    style={{ 
                      cursor: 'pointer', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.5rem',
                      margin: '-0.5rem',
                      borderRadius: '6px',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel-alt)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ 
                      fontSize: '0.875rem', 
                      transition: 'transform 0.2s',
                      transform: showRawAttrs ? 'rotate(90deg)' : 'rotate(0deg)',
                      display: 'inline-block'
                    }}>▶</span>
                    <h3 style={{ margin: 0 }}>Raw Attributes JSON</h3>
                  </div>
                  {showRawAttrs && selectedSpan.attributes && (
                    <pre className="detail-content" style={{ 
                      marginTop: '0.75rem',
                      background: 'var(--bg)',
                      padding: '1rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      lineHeight: '1.5',
                      overflow: 'auto',
                      maxHeight: '400px'
                    }}>
                      {JSON.stringify(JSON.parse(selectedSpan.attributes), null, 2)}
                    </pre>
                  )}
                </div>

                {/* Raw Span Object - Expandable */}
                <div className="detail-section">
                  <div 
                    className="expandable-header" 
                    onClick={() => setShowRawSpan(!showRawSpan)}
                    style={{ 
                      cursor: 'pointer', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.5rem',
                      margin: '-0.5rem',
                      borderRadius: '6px',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel-alt)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ 
                      fontSize: '0.875rem', 
                      transition: 'transform 0.2s',
                      transform: showRawSpan ? 'rotate(90deg)' : 'rotate(0deg)',
                      display: 'inline-block'
                    }}>▶</span>
                    <h3 style={{ margin: 0 }}>Raw Span Object</h3>
                  </div>
                  {showRawSpan && (
                    <pre className="detail-content" style={{ 
                      marginTop: '0.75rem',
                      background: 'var(--bg)',
                      padding: '1rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      lineHeight: '1.5',
                      overflow: 'auto',
                      maxHeight: '400px'
                    }}>
                      {JSON.stringify(selectedSpan, null, 2)}
                    </pre>
                  )}
                </div>

                {/* Events */}
                {selectedSpan.events && selectedSpan.events !== '[]' && (
                  <div className="detail-section">
                    <h3>Events</h3>
                    <pre className="detail-content">{selectedSpan.events}</pre>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="panel-content">
              <h3>Span Details</h3>
              <div className="detail-content">Select a span in the timeline to view messages, attributes, and events.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ConversationDetails
