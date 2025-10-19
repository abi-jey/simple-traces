import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  // Groups state
  const [groups, setGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupsBefore, setGroupsBefore] = useState(null)
  const [hasMoreGroups, setHasMoreGroups] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState('connecting')

  // Selected group & spans
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [groupSpans, setGroupSpans] = useState([])
  const [spansLoading, setSpansLoading] = useState(false)

  // Polling
  const abortRef = useRef(null)
  const pollRef = useRef(true)
  // Search state
  const [search, setSearch] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    // initial load
    fetchGroups(true)
    // start light polling for new groups every 5s
    const id = setInterval(() => {
      if (!pollRef.current) return
      fetchGroups(true)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const fetchGroups = async (refresh = false) => {
    try {
      let url = '/api/trace-groups?limit=100'
      if (!refresh && groupsBefore) {
        url += `&before=${encodeURIComponent(groupsBefore)}`
      }
      if (search.trim()) {
        url += `&q=${encodeURIComponent(search.trim())}`
      }
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch trace groups')
      const data = await res.json()
      setConnectionStatus('connected')
      setGroupsLoading(false)
      if (refresh) {
        setGroups(data)
      } else {
        setGroups((prev) => [...prev, ...data])
      }
      if (data.length > 0) {
        // next cursor is last group's last_end_time
        const last = data[data.length - 1]
        setGroupsBefore(last.last_end_time)
        setHasMoreGroups(true)
      } else {
        setHasMoreGroups(false)
      }
    } catch (e) {
      console.debug('fetchGroups error', e)
      setConnectionStatus('disconnected')
      setGroupsLoading(false)
    }
  }

  const fetchGroupSpans = async (group) => {
    setSelectedGroup(group)
    setSpansLoading(true)
    try {
      let url = `/api/trace-groups/${encodeURIComponent(group.trace_id)}`
      if (search.trim()) url += `?q=${encodeURIComponent(search.trim())}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch group spans')
      const spans = await res.json()
      setGroupSpans(spans)
      setSpansLoading(false)
    } catch (e) {
      console.debug('fetchGroupSpans error', e)
      setSpansLoading(false)
    }
  }

  const deleteGroup = async (group) => {
    try {
      const res = await fetch(`/api/trace-groups/${encodeURIComponent(group.trace_id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete group')
      // remove from list
      setGroups((prev) => prev.filter((g) => g.trace_id !== group.trace_id))
      if (selectedGroup?.trace_id === group.trace_id) {
        setSelectedGroup(null)
        setGroupSpans([])
      }
    } catch (e) {
      alert('Delete failed: ' + e.message)
    }
  }

  const getConnectionStatusDisplay = () => {
    switch (connectionStatus) {
      case 'connected':
        return { icon: '🟢', text: 'Connected', className: 'status-connected', dot: 'connected' }
      case 'disconnected':
        return { icon: '🔴', text: 'Disconnected', className: 'status-disconnected', dot: 'disconnected' }
      default:
        return { icon: '🟡', text: 'Connecting...', className: 'status-connecting', dot: 'connecting' }
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

  const ConnectionIndicator = () => {
    const s = getConnectionStatusDisplay()
    return (
      <div className="connection-wrap" title={s.text}>
        <span className={`status-dot ${s.dot}`} />
        <span style={{ fontSize: '0.85rem', color: '#444' }}>{s.text}</span>
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
      // Fallback to span name
      msgs.push({ role: 'system', text: sp.name })
    }
    return msgs
  }

  return (
    <div className="app">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h1>🧵 Simple Traces</h1>
            <p>Grouped by related spans (trace_id)</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <input
              type="text"
              value={search}
              placeholder="Search threads and spans…"
              onChange={(e) => {
                const val = e.target.value
                setSearch(val)
                if (debounceRef.current) clearTimeout(debounceRef.current)
                debounceRef.current = setTimeout(() => {
                  // Refresh groups with search
                  setGroupsBefore(null)
                  fetchGroups(true)
                  // Refresh spans if a group is open
                  if (selectedGroup) fetchGroupSpans(selectedGroup)
                }, 220)
              }}
              style={{ padding: '0.5rem 0.65rem', borderRadius: 8, border: '1px solid #e5e7eb', minWidth: 320 }}
            />
            <ConnectionIndicator />
          </div>
        </div>
      </header>

      <div className="container">
        {groupsLoading && <div className="loading">Loading trace groups...</div>}

        {!groupsLoading && groups.length === 0 && (
          <div className="empty-state">
            <ConnectionIndicator />
            <h2>No trace groups yet</h2>
            <p>You can import sample spans from the provided JSONL file to get started.</p>
            <pre className="code-block">
{`curl -X POST http://localhost:8080/api/spans/import \\
  -H "Content-Type: application/json" \\
  -d '{"path": "data/telegram_agent_traces.jsonl"}'`}
            </pre>
          </div>
        )}

        {!groupsLoading && groups.length > 0 && (
          <div className="content">
            <div className="traces-list">
              <div className="list-header">
                <h2>Recent Threads ({groups.length})</h2>
                <div className="header-controls"><ConnectionIndicator /></div>
              </div>

              {groups.map((g) => (
                <div
                  key={g.trace_id}
                  className={`trace-item ${selectedGroup?.trace_id === g.trace_id ? 'selected' : ''}`}
                >
                  <div className="trace-header" onClick={() => fetchGroupSpans(g)}>
                    <span className="trace-model">{g.model || 'unknown model'}</span>
                    <span className="trace-duration">{g.span_count} spans</span>
                  </div>
                  <div className="trace-stats">
                    <span>🕒 {formatTS(g.first_start_time)}</span>
                    <span>→ {formatTS(g.last_end_time)}</span>
                    <span>🧵 {g.trace_id.slice(0, 8)}…</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button className="close-btn" title="Delete thread" onClick={() => deleteGroup(g)}>
                      🗑️
                    </button>
                    <button className="close-btn" title="Open thread" onClick={() => fetchGroupSpans(g)}>
                      🔍
                    </button>
                  </div>
                </div>
              ))}

              {hasMoreGroups && (
                <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
                  <button className="error" onClick={() => fetchGroups(false)}>
                    Load more
                  </button>
                </div>
              )}
            </div>

            {selectedGroup && (
              <div className="trace-details">
                <div className="details-header">
                  <h2>Thread: {selectedGroup.trace_id.slice(0, 12)}…</h2>
                  <button onClick={() => { setSelectedGroup(null); setGroupSpans([]) }} className="close-btn">
                    ×
                  </button>
                </div>

                {/* Top stats */}
                <div className="stats-grid" style={{ marginBottom: '0.75rem' }}>
                  <div className="stat"><div className="stat-label">Model</div><div className="stat-value">{selectedGroup.model || 'unknown'}</div></div>
                  <div className="stat"><div className="stat-label">Spans</div><div className="stat-value">{selectedGroup.span_count}</div></div>
                  <div className="stat"><div className="stat-label">Start</div><div className="stat-value">{formatTS(selectedGroup.first_start_time)}</div></div>
                  <div className="stat"><div className="stat-label">End</div><div className="stat-value">{formatTS(selectedGroup.last_end_time)}</div></div>
                </div>

                {spansLoading && <div className="loading">Loading spans…</div>}

                {!spansLoading && groupSpans.length === 0 && (
                  <div className="empty-state">
                    <h2>No spans in this thread</h2>
                  </div>
                )}

                {!spansLoading && groupSpans.length > 0 && (
                  <div className="detail-section">
                    <h3>Conversation</h3>
                    <div className="detail-content" style={{ maxHeight: 'unset' }}>
                      <div className="chat">
                        {groupSpans.map((sp) => (
                          <div key={sp.span_id}>
                            <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.75rem', margin: '0.25rem 0' }}>
                              {formatTS(sp.start_time)} {sp.status_code ? `• ${sp.status_code}` : ''}
                            </div>
                            {buildMessages(sp).map((m, idx) => (
                              <div key={idx} className={`msg ${m.role}`}>
                                <div className="meta">{m.role}</div>
                                <div className="text">{m.text}</div>
                              </div>
                            ))}
                            {sp.attributes && (
                              <details style={{ marginTop: '0.25rem' }}>
                                <summary>attributes</summary>
                                {renderAttrTable(sp.attributes)}
                              </details>
                            )}
                            {sp.events && sp.events !== '[]' && (
                              <details style={{ marginTop: '0.25rem' }}>
                                <summary>events</summary>
                                <pre className="detail-content">{sp.events}</pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
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
