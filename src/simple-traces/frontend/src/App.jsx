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
  const listRef = useRef(null)
  const sentinelRef = useRef(null)

  // Theme state (light/dark) persisted in localStorage
  const [theme, setTheme] = useState('light')

  // Simple SPA routing & projects
  const [view, setView] = useState('main') // 'main' | 'projects'
  const [project, setProject] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState([])

  useEffect(() => {
    const saved = localStorage.getItem('st-theme')
    const initial = saved === 'dark' || saved === 'light' ? saved : 'light'
    setTheme(initial)
    document.documentElement.setAttribute('data-theme', initial)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('st-theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  useEffect(() => {
    // initial load
    // Projects: load from storage
    const storedProjects = JSON.parse(localStorage.getItem('st-projects') || '[]')
    setProjects(storedProjects)
    const slugify = (s) => s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '')
    const parseRoute = (path) => {
      if (path === '/projects') return { route: 'projects' }
      const m = path.match(/^\/projects\/([^/]+)\/?$/)
      if (m) return { route: 'project', id: decodeURIComponent(m[1]) }
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
      const m = path.match(/^\/projects\/([^/]+)\/?$/)
      if (m) return { route: 'project', id: decodeURIComponent(m[1]) }
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

  return (
    <div className="app">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h1>🧵 Simple Traces {project ? <span className="project-badge">({project})</span> : null}</h1>
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
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
              {theme === 'dark' ? '🌙' : '🌞'}
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

              <div ref={sentinelRef} style={{ height: 1 }} />
            </div>

            {selectedGroup && (
              <div className="trace-details">
                <div className="details-header">
                  <div>
                    <h2>{(groupSpans[0]?.name) || `Thread: ${selectedGroup.trace_id.slice(0, 12)}…`}</h2>
                    <div className="subtitle">{buildSubtitleText(selectedGroup, groupSpans)}</div>
                  </div>
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
          </>
        )}
      </div>
    </div>
  )
}

export default App
