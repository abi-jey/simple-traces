import { useState, useEffect } from 'react'
import WaterfallView from './WaterfallView'
import './ConversationDetails.css'

function ConversationDetails({ conversationId, onClose }) {
  const [spans, setSpans] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSpan, setSelectedSpan] = useState(null)
  const [conversation, setConversation] = useState(null)

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
      
      // Derive conversation metadata from spans
      if (data.length > 0) {
        const first = data[0]
        const last = data[data.length - 1]
        let attrs = null
        try {
          attrs = first.attributes ? JSON.parse(first.attributes) : null
        } catch (e) {
          attrs = null
        }
        
        setConversation({
          id: conversationId,
          first_start_time: first.start_time,
          last_end_time: last.end_time,
          span_count: data.length,
          model: attrs?.['llm.model'] || attrs?.['gen_ai.request.model'] || 'unknown'
        })
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
      const sys = attrs['gen_ai.system'] || attrs['llm.system']
      const user = attrs['llm.input'] || attrs['gen_ai.prompt']
      const assistant = attrs['llm.output'] || attrs['gen_ai.response']
      if (sys) msgs.push({ role: 'system', text: String(sys) })
      if (user) msgs.push({ role: 'user', text: String(user) })
      if (assistant) msgs.push({ role: 'assistant', text: String(assistant) })
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
          />
        </div>

        {/* Span Details Panel */}
        {selectedSpan && (
          <div className="span-details-panel">
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

              {/* Events */}
              {selectedSpan.events && selectedSpan.events !== '[]' && (
                <div className="detail-section">
                  <h3>Events</h3>
                  <pre className="detail-content">{selectedSpan.events}</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ConversationDetails
