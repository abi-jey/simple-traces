import { useCallback, useEffect, useRef, useState } from 'react'
import type { GroupListItem, SpanRecord, Theme } from '../types'
import WaterfallView from '../components/WaterfallView'
import { deleteConversation, fetchConversations, fetchGroupSpans } from '../shared/api'
import { useInfiniteScroll } from '../shared/useInfiniteScroll'

function formatTS(ts: string) {
  return new Date(ts).toLocaleString()
}

export default function MainPage({
  theme,
  onNavigateConversation,
  connectionStatus,
  onConnectionProbe,
}: {
  theme: Theme
  onNavigateConversation: (id: string) => void
  connectionStatus: 'connecting' | 'connected' | 'disconnected'
  onConnectionProbe: (ok: boolean) => void
}) {
  const [groups, setGroups] = useState<GroupListItem[]>([])
  const [groupsLoading, setGroupsLoading] = useState<boolean>(true)
  const [groupsBefore, setGroupsBefore] = useState<string | null>(null)
  const [hasMoreGroups, setHasMoreGroups] = useState<boolean>(true)

  const [selectedGroup, setSelectedGroup] = useState<GroupListItem | null>(null)
  const [groupSpans, setGroupSpans] = useState<SpanRecord[]>([])
  const [spansLoading, setSpansLoading] = useState<boolean>(false)

  const listRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const debounceRef = useRef<number | null>(null)

  // Keep a stable reference to the probe callback to avoid effect/deps loops
  const probeRef = useRef(onConnectionProbe)
  useEffect(() => { probeRef.current = onConnectionProbe }, [onConnectionProbe])

  const loadGroups = useCallback(async (refresh: boolean) => {
    try {
      const data = await fetchConversations({ limit: 100, before: refresh ? null : groupsBefore })
      // Report success to connection status probe
      probeRef.current?.(true)
      setGroupsLoading(false)
      if (refresh) setGroups(data)
      else setGroups((prev) => [...prev, ...data])
      if (data.length > 0) {
        const last = data[data.length - 1]
        setGroupsBefore(last.last_end_time)
        setHasMoreGroups(true)
      } else {
        setHasMoreGroups(false)
      }
    } catch (e) {
      // Report failure to connection status probe
      probeRef.current?.(false)
      setGroupsLoading(false)
    }
  }, [groupsBefore])

  const loadSpans = useCallback(async (g: GroupListItem) => {
    setSelectedGroup(g)
    setSpansLoading(true)
    try {
      const spans = await fetchGroupSpans(g.trace_id)
      setGroupSpans(spans)
    } finally {
      setSpansLoading(false)
    }
  }, [])

  // Initial load and light polling each 5s (only set up once)
  useEffect(() => {
    setGroupsLoading(true)
    loadGroups(true)
    const id = setInterval(() => loadGroups(true), 5000)
    return () => clearInterval(id)
    // Intentionally not depending on loadGroups to avoid re-running on state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Infinite scroll observer (shared hook)
  useInfiniteScroll({
    root: listRef,
    sentinel: sentinelRef,
    canLoad: hasMoreGroups && !groupsLoading,
    onLoad: () => loadGroups(false),
    rootMargin: '0px',
    threshold: 0.1,
  })

  // Search moved to Header and is currently non-functional. Kept debounceRef for potential future use.

  return (
    <div className="content">
      {/* Search moved to Header */}

      {groupsLoading && <div className="loading">Loading trace groups...</div>}

      {!groupsLoading && groups.length === 0 && (
        <div className="empty-state">
          <h2>No trace groups yet</h2>
          <p>You can import sample spans from the provided JSONL file to get started.</p>
          <pre className="code-block">{`curl -X POST http://localhost:8080/api/spans/import \\
  -H "Content-Type: application/json" \\
  -d '{"path": "data/telegram_agent_traces.jsonl"}'`}</pre>
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
              <div key={g.trace_id} className={`trace-item ${selectedGroup?.trace_id === g.trace_id ? 'selected' : ''}`}>
                <div className="trace-header" onClick={() => loadSpans(g)}>
                  <span className="trace-duration">{g.span_count} spans</span>
                </div>
                <div className="trace-stats">
                  <span>🕒 {formatTS(g.first_start_time)}</span>
                  <span>→ {formatTS(g.last_end_time)}</span>
                  <span className="conversation-id-link" onClick={(e) => { e.stopPropagation(); onNavigateConversation(g.trace_id) }} title="Open conversation details">
                    🧵 {g.trace_id.slice(0, 8)}…
                  </span>
                </div>
                {selectedGroup?.trace_id === g.trace_id && (
                  <div className="trace-body">
                    {spansLoading && <div className="loading">Loading spans…</div>}
                    {!spansLoading && (
                      <div className="span-waterfall">
                        <WaterfallView spans={groupSpans} onSpanClick={() => {}} selectedSpanId={null} />
                      </div>
                    )}
                    <div className="trace-actions">
                      <button className="danger" onClick={(e) => { e.stopPropagation(); deleteConversation(g.trace_id).then(() => setGroups((prev) => prev.filter((x) => x.trace_id !== g.trace_id))) }}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div ref={sentinelRef} style={{ height: 1 }} />
            {!hasMoreGroups && <div style={{ color: 'var(--muted)', padding: '0.5rem' }}>End of list</div>}
          </div>
        </div>
      )}
    </div>
  )}

// Generated by Copilot