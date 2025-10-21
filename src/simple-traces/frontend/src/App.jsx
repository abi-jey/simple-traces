import { useState, useEffect, useRef } from 'react'
import './App.css'
import WaterfallView from './WaterfallView'
import ConversationDetails from './ConversationDetails'

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
  const [selectedSpan, setSelectedSpan] = useState(null)

  // Polling
  const abortRef = useRef(null)
  const pollRef = useRef(true)
  // Search state
  const [search, setSearch] = useState('')
  const debounceRef = useRef(null)
  const listRef = useRef(null)
  const sentinelRef = useRef(null)

  // Theme state (light/dark) persisted in localStorage
  const [theme, setTheme] = useState('light')

  // Simple SPA routing & projects
  const [view, setView] = useState('main') // 'main' | 'projects' | 'conversation'
  const [project, setProject] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState([])
  const [currentConversationId, setCurrentConversationId] = useState(null)

  useEffect(() => {
    const saved = localStorage.getItem('st-theme')
    const initial = saved === 'dark' || saved === 'light' ? saved : 'light'
    setTheme(initial)
    document.documentElement.setAttribute('data-theme', initial)
  }, [])

  const toggleTheme = (e) => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('st-theme', next)
    document.documentElement.setAttribute('data-theme', next)
    
    // Add bounce animation
    const btn = e?.currentTarget || e?.target
    if (btn) {
      btn.classList.add('toggling')
      setTimeout(() => {
        btn.classList.remove('toggling')
      }, 500)
    }
  }

  useEffect(() => {
    // initial load
    // Projects: load from storage
    const storedProjects = JSON.parse(localStorage.getItem('st-projects') || '[]')
    setProjects(storedProjects)
    const slugify = (s) => s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '')
    const parseRoute = (path) => {
      if (path === '/projects') return { route: 'projects' }
      const projectMatch = path.match(/^\/projects\/([^/]+)\/?$/)
      if (projectMatch) return { route: 'project', id: decodeURIComponent(projectMatch[1]) }
      const conversationMatch = path.match(/^\/conversations\/([^/]+)\/?$/)
      if (conversationMatch) return { route: 'conversation', id: decodeURIComponent(conversationMatch[1]) }
      return { route: 'root' }
    }
    const navigate = (path) => {
      if (window.location.pathname !== path) {
        window.history.pushState({}, '', path)
      }
    }
    const applyProject = (pid) => {
      const list = JSON.parse(localStorage.getItem('st-projects') || '[]')
      const found = list.find((p) => p.id === pid)
      const name = found ? found.name : pid
      setProjectId(pid)
      setProject(name)
      localStorage.setItem('st-project-id', pid)
      localStorage.setItem('st-project', name)
      // ensure it appears in recent projects
      if (!found) {
        const next = [...list, { id: pid, name }]
        localStorage.setItem('st-projects', JSON.stringify(next))
        setProjects(next)
      }
    }
    const route = parseRoute(window.location.pathname)
    const savedName = localStorage.getItem('st-project')
    const savedIdRaw = localStorage.getItem('st-project-id')
    const savedId = savedIdRaw || (savedName ? slugify(savedName) : '')
    if (route.route === 'projects') {
      setView('projects')
    } else if (route.route === 'project') {
      applyProject(route.id)
      setView('main')
      fetchGroups(true)
    } else if (route.route === 'conversation') {
      setCurrentConversationId(route.id)
      setView('conversation')
    } else {
      // root: if saved project exists, navigate to it; otherwise go to projects
      if (savedId) {
        applyProject(savedId)
        setView('main')
        navigate(`/projects/${encodeURIComponent(savedId)}`)
        fetchGroups(true)
      } else {
        setView('projects')
        navigate('/projects')
      }
    }
    // start light polling for new groups every 5s
    const id = setInterval(() => {
      if (!pollRef.current) return
      if (view === 'main') fetchGroups(true)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  // Handle browser back/forward
  useEffect(() => {
    const slugify = (s) => s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '')
    const parseRoute = (path) => {
      if (path === '/projects') return { route: 'projects' }
      const projectMatch = path.match(/^\/projects\/([^/]+)\/?$/)
      if (projectMatch) return { route: 'project', id: decodeURIComponent(projectMatch[1]) }
      const conversationMatch = path.match(/^\/conversations\/([^/]+)\/?$/)
      if (conversationMatch) return { route: 'conversation', id: decodeURIComponent(conversationMatch[1]) }
      return { route: 'root' }
    }
    const onPop = () => {
      const r = parseRoute(window.location.pathname)
      if (r.route === 'projects') {
        setView('projects')
      } else if (r.route === 'project') {
        // apply and refresh
        const list = JSON.parse(localStorage.getItem('st-projects') || '[]')
        const found = list.find((p) => p.id === r.id)
        const name = found ? found.name : r.id
        setProjectId(r.id)
        setProject(name)
        localStorage.setItem('st-project-id', r.id)
        localStorage.setItem('st-project', name)
        if (!found) {
          const next = [...list, { id: r.id, name }]
          localStorage.setItem('st-projects', JSON.stringify(next))
          setProjects(next)
        }
        setView('main')
        // refresh data for the new route project
        setGroups([]); setGroupsBefore(null); setHasMoreGroups(true); setGroupsLoading(true)
        fetchGroups(true)
      } else if (r.route === 'conversation') {
        setCurrentConversationId(r.id)
        setView('conversation')
      } else {
        // root
        const savedName = localStorage.getItem('st-project') || ''
        const pid = localStorage.getItem('st-project-id') || (savedName ? slugify(savedName) : '')
        if (pid) {
          setView('main')
        } else {
          setView('projects')
        }
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const fetchGroups = async (refresh = false) => {
    try {
      let url = '/api/conversations?limit=100'
      if (!refresh && groupsBefore) {
        url += `&before=${encodeURIComponent(groupsBefore)}`
      }
      if (search.trim()) {
        url += `&q=${encodeURIComponent(search.trim())}`
      }
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch conversations')
      const convs = await res.json()
      // Map conversations to existing UI shape (trace_id -> conversation id)
      const data = Array.isArray(convs)
        ? convs.map((c) => ({
            trace_id: c.id,
            first_start_time: c.first_start_time,
            last_end_time: c.last_end_time,
            span_count: c.span_count,
            model: c.model,
          }))
        : []
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
      const res = await fetch(`/api/conversations/${encodeURIComponent(group.trace_id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete conversation')
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

  const navigateToConversation = (conversationId) => {
    const path = `/conversations/${encodeURIComponent(conversationId)}`
    window.history.pushState({}, '', path)
    setCurrentConversationId(conversationId)
    setView('conversation')
  }

  const navigateBack = () => {
    window.history.back()
  }

  // Infinite scroll: observe sentinel at bottom of list
  useEffect(() => {
    if (view !== 'main') return
    if (!sentinelRef.current) return
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry.isIntersecting && hasMoreGroups && !groupsLoading) {
        fetchGroups(false)
      }
    }, { root: listRef.current, rootMargin: '0px', threshold: 0.1 })
    io.observe(sentinelRef.current)
    return () => io.disconnect()
  }, [view, hasMoreGroups, groupsLoading, groupsBefore, search])

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
        <span className="status-text">{s.text}</span>
      </div>
    )
  }

  const ProjectsPage = () => {
    const choose = (p) => {
      setProject(p.name)
      setProjectId(p.id)
      localStorage.setItem('st-project', p.name)
      localStorage.setItem('st-project-id', p.id)
      // navigate to /projects/:id
      if (window.location.pathname !== `/projects/${encodeURIComponent(p.id)}`) {
        window.history.pushState({}, '', `/projects/${encodeURIComponent(p.id)}`)
      }
      setView('main')
      setGroups([]); setGroupsBefore(null); setHasMoreGroups(true); setGroupsLoading(true)
      fetchGroups(true)
    }
    return (
      <div className="projects-page">
        <h2>Recent Projects</h2>
        <div className="projects-grid">
          {projects.map((p) => (
            <div key={p.id} className="project-card" onClick={() => choose(p)}>
              <div className="project-icon">📁</div>
              <div className="project-name">{p.name}</div>
            </div>
          ))}
          {projects.length === 0 && (
            <div style={{ color: 'var(--muted)' }}>
              No recent projects. Open a URL like <code>/projects/project-1</code> to view a project.
            </div>
          )}
        </div>
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

  const buildSubtitleText = (group, spans) => {
    // Try to extract first user or system message from the earliest span
    if (spans && spans.length > 0) {
      const first = spans[0]
      let attrs = null
      try { attrs = first.attributes ? JSON.parse(first.attributes) : null } catch { attrs = null }
      if (attrs) {
        const user = attrs['llm.input'] || attrs['gen_ai.prompt']
        const sys = attrs['gen_ai.system'] || attrs['llm.system']
        const pick = user || sys
        if (pick && typeof pick === 'string') {
          const t = pick.trim().replace(/\s+/g, ' ')
          return t.length > 120 ? t.slice(0, 120) + '…' : t
        }
      }
    }
    // Fallback: show concise time range and model
    const left = group?.first_start_time ? new Date(group.first_start_time).toLocaleString() : ''
    const right = group?.last_end_time ? new Date(group.last_end_time).toLocaleString() : ''
    return `${left && right ? `${left} → ${right}` : left || right}${group?.model ? ` • ${group.model}` : ''}`
  }

  const GitHubIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  )

  return (
    <div className="app">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h1>Simple Traces</h1>
            <div style={{ marginTop: '0.25rem' }}><ConnectionIndicator /></div>
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
                  if (view === 'main') fetchGroups(true)
                  // Refresh spans if a group is open
                  if (selectedGroup) fetchGroupSpans(selectedGroup)
                }, 220)
              }}
              className="search-input"
            />
            <button className="theme-toggle-switch" onClick={toggleTheme} title="Toggle theme">
              <span className="toggle-icon sun-icon">☀️</span>
              <span className="toggle-icon moon-icon">🌙</span>
            </button>
            <button
              className="theme-toggle"
              onClick={() => {
                if (window.location.pathname !== '/projects') {
                  window.history.pushState({}, '', '/projects')
                }
                setView('projects')
              }}
              title="Change project"
            >
              Projects
            </button>
            <a
              href="https://github.com/abi-jey/simple-traces"
              target="_blank"
              rel="noopener noreferrer"
              className="github-link"
              title="View on GitHub"
            >
              <GitHubIcon />
            </a>
          </div>
        </div>
      </header>

      <div className="container">
        {view === 'projects' && (
          <ProjectsPage />
        )}

        {view === 'main' && (
          <>
        {groupsLoading && <div className="loading">Loading trace groups...</div>}

        {!groupsLoading && groups.length === 0 && (
          <div className="empty-state">
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
            <div className="traces-list" ref={listRef}>
              <div className="list-header">
                <h2>Conversations ({groups.length})</h2>
                <div className="header-controls" />
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
                    <span 
                      className="conversation-id-link"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigateToConversation(g.trace_id)
                      }}
                      title="Open conversation details"
                    >
                      🧵 {g.trace_id.slice(0, 8)}…
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button 
                      className="close-btn" 
                      title="Delete thread" 
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteGroup(g)
                      }}
                    >
                      🗑️
                    </button>
                    <button 
                      className="close-btn" 
                      title="Preview thread" 
                      onClick={(e) => {
                        e.stopPropagation()
                        fetchGroupSpans(g)
                      }}
                    >
                      👁️
                    </button>
                    <button 
                      className="close-btn" 
                      title="Open full details" 
                      onClick={(e) => {
                        e.stopPropagation()
                        navigateToConversation(g.trace_id)
                      }}
                    >
                      📊
                    </button>
                  </div>
                </div>
              ))}

              <div ref={sentinelRef} style={{ height: 1 }} />
            </div>

            {selectedGroup && (
              <div className="trace-details">
                <div className="details-header">
                  <div>
                    <h2>{(groupSpans[0]?.name) || `Thread: ${selectedGroup.trace_id.slice(0, 12)}…`}</h2>
                    <div className="subtitle">{buildSubtitleText(selectedGroup, groupSpans)}</div>
                  </div>
                  <button onClick={() => { setSelectedGroup(null); setGroupSpans([]); setSelectedSpan(null) }} className="close-btn">
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

                {/* View Details Button */}
                <button 
                  className="view-details-btn"
                  onClick={() => navigateToConversation(selectedGroup.trace_id)}
                >
                  📊 View Full Details
                </button>

                {spansLoading && <div className="loading">Loading spans…</div>}

                {!spansLoading && groupSpans.length === 0 && (
                  <div className="empty-state">
                    <h2>No spans in this thread</h2>
                  </div>
                )}

                {!spansLoading && groupSpans.length > 0 && (
                  <>
                    {/* Waterfall Preview */}
                    <div className="detail-section">
                      <h3>Timeline Preview</h3>
                      <WaterfallView 
                        spans={groupSpans} 
                        onSpanClick={setSelectedSpan}
                        selectedSpanId={selectedSpan?.span_id}
                      />
                    </div>

                    {/* Selected Span Details */}
                    {selectedSpan && (
                      <div className="detail-section">
                        <h3>Span: {selectedSpan.name}</h3>
                        <div className="detail-content">
                          <div style={{ marginBottom: '0.5rem' }}>
                            <strong>Duration:</strong> {selectedSpan.duration_ms}ms
                          </div>
                          <div style={{ marginBottom: '0.5rem' }}>
                            <strong>Status:</strong> {selectedSpan.status_code || 'N/A'}
                          </div>
                          {selectedSpan.attributes && (
                            <details open style={{ marginTop: '0.5rem' }}>
                              <summary>Attributes</summary>
                              {renderAttrTable(selectedSpan.attributes)}
                            </details>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Conversation Messages */}
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
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
          </>
        )}

        {view === 'conversation' && currentConversationId && (
          <ConversationDetails 
            conversationId={currentConversationId}
            onClose={navigateBack}
          />
        )}
      </div>
    </div>
  )
}

export default App
