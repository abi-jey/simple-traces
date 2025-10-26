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
  const [showInstruction, setShowInstruction] = useState(false)
  const [showSpanInfo, setShowSpanInfo] = useState(false)

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
              // Priority 1: simpleTraces attributes
              if (a['simpleTraces.agent.model']) return String(a['simpleTraces.agent.model'])
              // Priority 2: standard attributes
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

    // Separate simpleTraces attributes from others for better display
    const simpleTracesAttrs = entries.filter(([k]) => k.startsWith('simpleTraces.'))
    const otherAttrs = entries.filter(([k]) => !k.startsWith('simpleTraces.'))

    // Extract sub_agents information from simpleTraces attributes
    const subAgentsData = []
    const agentNameRegex = /^simpleTraces\.agent\.sub_agents\.(\d+)\.simpleTraces\.agent\.(.+)$/
    const subAgentsAttrs = new Set()
    
    for (const [k, v] of simpleTracesAttrs) {
      const match = k.match(agentNameRegex)
      if (match) {
        const idx = parseInt(match[1])
        const field = match[2]
        if (!subAgentsData[idx]) {
          subAgentsData[idx] = {}
        }
        subAgentsData[idx][field] = v
        subAgentsAttrs.add(k)
      }
    }
    
    // Filter out sub_agents attributes from the main list
    const simpleTracesNonSubAgents = simpleTracesAttrs.filter(([k]) => !subAgentsAttrs.has(k))

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

    const renderTable = (attrList, title, highlight = false) => {
      if (attrList.length === 0) return null
      return (
        <>
          {title && <h4 style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: highlight ? '#8b5cf6' : '#888' }}>{title}</h4>}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px', background: highlight ? 'rgba(139, 92, 246, 0.1)' : 'transparent' }}>key</th>
                <th style={{ textAlign: 'left', padding: '6px', background: highlight ? 'rgba(139, 92, 246, 0.1)' : 'transparent' }}>type</th>
                <th style={{ textAlign: 'left', padding: '6px', background: highlight ? 'rgba(139, 92, 246, 0.1)' : 'transparent' }}>value</th>
              </tr>
            </thead>
            <tbody>
              {attrList.map(([k, v]) => (
                <tr key={k} style={{ background: highlight ? 'rgba(139, 92, 246, 0.05)' : 'transparent' }}>
                  <td style={{ padding: '6px', verticalAlign: 'top', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>{k}</td>
                  <td style={{ padding: '6px', verticalAlign: 'top', color: '#666' }}>{typeOf(v)}</td>
                  <td style={{ padding: '6px', verticalAlign: 'top' }}>{fmtVal(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )
    }

    const renderSubAgents = () => {
      if (subAgentsData.length === 0) return null
      return (
        <>
          <h4 style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#14b8a6' }}>🤖 Sub-Agents</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            {subAgentsData.map((agent, idx) => (
              <div key={idx} style={{ 
                background: 'rgba(20, 184, 166, 0.05)', 
                border: '1px solid rgba(20, 184, 166, 0.2)',
                borderRadius: '6px',
                padding: '0.75rem'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#14b8a6' }}>
                  {agent.name || `Agent ${idx}`}
                </div>
                <div style={{ fontSize: '0.85rem', display: 'grid', gap: '0.25rem' }}>
                  {agent.description && (
                    <div><span style={{ color: '#888' }}>Description:</span> {agent.description}</div>
                  )}
                  {agent.model && (
                    <div><span style={{ color: '#888' }}>Model:</span> {agent.model}</div>
                  )}
                  {agent.instruction && (
                    <div><span style={{ color: '#888' }}>Instruction:</span> <span style={{ fontStyle: 'italic', color: '#666' }}>{agent.instruction.length > 100 ? agent.instruction.slice(0, 100) + '...' : agent.instruction}</span></div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )
    }

    return (
      <div className="detail-content" style={{ padding: 0 }}>
        {renderSubAgents()}
        {renderTable(simpleTracesNonSubAgents, '🔧 simpleTraces Attributes', true)}
        {renderTable(otherAttrs, (simpleTracesNonSubAgents.length > 0 || subAgentsData.length > 0) ? '📋 Other Attributes' : null, false)}
      </div>
    )
  }

  const getSpanMetadata = (sp) => {
    let attrs = null
    try { attrs = sp.attributes ? JSON.parse(sp.attributes) : null } catch (e) { attrs = null }
    
    const metadata = {
      description: null,
      instruction: null,
      agentName: null,
      model: null,
      spanKind: null,
      userId: null,
      sessionAppName: null,
      invocationId: null,
      sdk: null,
      // Model-specific attributes
      modelName: null,
      modelSystemInstruction: null,
      modelInputContentCount: null,
      modelInputRoles: null,
      // Model output attributes
      modelOutputFinishReason: null,
      modelOutputHasText: null,
      modelOutputHasFunctionCalls: null,
      modelOutputTextLength: null,
      modelOutputFunctionCallCount: null,
      // Model usage attributes
      modelUsagePromptTokens: null,
      modelUsageCompletionTokens: null,
      modelUsageTotalTokens: null,
      // Model cost attributes
      modelCostInput: null,
      modelCostOutput: null,
      modelCostTotal: null,
      modelCostCurrency: null,
      // Model logprobs
      modelLogprobsAvg: null,
      // Tool attributes
      toolName: null,
      toolDescription: null,
      toolArgsCount: null,
      toolArgsKeys: null,
      toolFunctionCallId: null,
      toolResponseSuccess: null,
      toolResponseHasData: null,
      toolResponseKeys: null,
      toolResponseError: null,
      // Error tracking
      errorOccurred: null
    }
    
    if (attrs) {
      // Extract simpleTraces attributes first
      metadata.description = attrs['simpleTraces.agent.description'] || attrs['gen_ai.agent.description']
      metadata.instruction = attrs['simpleTraces.agent.instruction'] || attrs['st.system_instruction'] || attrs['gen_ai.system'] || attrs['llm.system']
      metadata.agentName = attrs['simpleTraces.agent.name'] || attrs['gen_ai.agent.name']
      metadata.model = attrs['simpleTraces.agent.model'] || attrs['st.model'] || attrs['gen_ai.request.model']
      metadata.spanKind = attrs['simpleTraces.span.kind']
      metadata.userId = attrs['simpleTraces.user.id']
      metadata.sessionAppName = attrs['simpleTraces.session.app_name']
      metadata.invocationId = attrs['simpleTraces.invocation_id']
      metadata.sdk = attrs['simpleTraces.SDK']
      
      // Model-specific attributes
      metadata.modelName = attrs['simpleTraces.model.name']
      metadata.modelSystemInstruction = attrs['simpleTraces.model.system_instruction']
      metadata.modelInputContentCount = attrs['simpleTraces.model.input.content_count']
      metadata.modelInputRoles = attrs['simpleTraces.model.input.roles']
      
      // Model output attributes
      metadata.modelOutputFinishReason = attrs['simpleTraces.model.output.finish_reason']
      metadata.modelOutputHasText = attrs['simpleTraces.model.output.has_text']
      metadata.modelOutputHasFunctionCalls = attrs['simpleTraces.model.output.has_function_calls']
      metadata.modelOutputTextLength = attrs['simpleTraces.model.output.text_length']
      metadata.modelOutputFunctionCallCount = attrs['simpleTraces.model.output.function_call_count']
      
      // Model usage attributes
      metadata.modelUsagePromptTokens = attrs['simpleTraces.model.usage.prompt_tokens']
      metadata.modelUsageCompletionTokens = attrs['simpleTraces.model.usage.completion_tokens']
      metadata.modelUsageTotalTokens = attrs['simpleTraces.model.usage.total_tokens']
      
      // Model cost attributes
      metadata.modelCostInput = attrs['simpleTraces.model.cost.input']
      metadata.modelCostOutput = attrs['simpleTraces.model.cost.output']
      metadata.modelCostTotal = attrs['simpleTraces.model.cost.total']
      metadata.modelCostCurrency = attrs['simpleTraces.model.cost.currency']
      
      // Model logprobs
      metadata.modelLogprobsAvg = attrs['simpleTraces.model.logprobs.avg']
      
      // Tool attributes
      metadata.toolName = attrs['simpleTraces.tool.name']
      metadata.toolDescription = attrs['simpleTraces.tool.description']
      metadata.toolArgsCount = attrs['simpleTraces.tool.args.count']
      metadata.toolArgsKeys = attrs['simpleTraces.tool.args.keys']
      metadata.toolFunctionCallId = attrs['simpleTraces.tool.function_call_id']
      metadata.toolResponseSuccess = attrs['simpleTraces.tool.response.success']
      metadata.toolResponseHasData = attrs['simpleTraces.tool.response.has_data']
      metadata.toolResponseKeys = attrs['simpleTraces.tool.response.keys']
      metadata.toolResponseError = attrs['simpleTraces.tool.response.error']
      
      // Error tracking
      metadata.errorOccurred = attrs['simpleTraces.error.occurred']
    }
    
    return metadata
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
                {/* Agent/Span Description & Instruction */}
                {(() => {
                  const meta = getSpanMetadata(selectedSpan)
                  return (
                    <>
                      {(meta.description || meta.spanKind) && (
                        <div className="detail-section">
                          <div style={{ 
                            background: meta.spanKind === 'model' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(139, 92, 246, 0.1)', 
                            border: `1px solid ${meta.spanKind === 'model' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`,
                            borderRadius: '6px',
                            padding: '0.75rem',
                            marginBottom: '1rem'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                              <div style={{ fontWeight: 'bold', color: meta.spanKind === 'model' ? '#3b82f6' : '#8b5cf6' }}>
                                {meta.spanKind === 'model' ? '🤖 Model' : '🎯 Agent'}: {meta.agentName || meta.modelName || selectedSpan.name}
                              </div>
                              {meta.spanKind && (
                                <span style={{ 
                                  fontSize: '0.7rem', 
                                  padding: '2px 6px', 
                                  background: meta.spanKind === 'model' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(139, 92, 246, 0.2)',
                                  borderRadius: '4px',
                                  textTransform: 'uppercase',
                                  fontWeight: '600'
                                }}>
                                  {meta.spanKind}
                                </span>
                              )}
                            </div>
                            {meta.description && (
                              <div style={{ fontSize: '0.9rem', color: '#ddd', marginBottom: '0.5rem' }}>
                                {meta.description}
                              </div>
                            )}
                            <div style={{ fontSize: '0.85rem', color: '#888', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                              {(meta.model || meta.modelName) && (
                                <div><span style={{ color: '#666' }}>Model:</span> {meta.model || meta.modelName}</div>
                              )}
                              {meta.sdk && (
                                <div><span style={{ color: '#666' }}>SDK:</span> {meta.sdk}</div>
                              )}
                              {meta.userId && (
                                <div><span style={{ color: '#666' }}>User:</span> {meta.userId}</div>
                              )}
                              {meta.sessionAppName && (
                                <div><span style={{ color: '#666' }}>App:</span> {meta.sessionAppName}</div>
                              )}
                            </div>
                            {meta.modelInputContentCount && (
                              <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '0.5rem' }}>
                                <span style={{ color: '#666' }}>Conversation turns:</span> {meta.modelInputContentCount}
                                {meta.modelInputRoles && Array.isArray(meta.modelInputRoles) && (
                                  <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                                    ({meta.modelInputRoles.filter(r => r === 'user').length} user, {meta.modelInputRoles.filter(r => r === 'model').length} model)
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {(meta.instruction || meta.modelSystemInstruction) && (
                        <div className="detail-section" style={{ marginBottom: '1rem' }}>
                          <div 
                            className="expandable-header" 
                            onClick={() => setShowInstruction(!showInstruction)}
                            style={{ 
                              cursor: 'pointer', 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: '0.5rem',
                              padding: '0.5rem',
                              margin: '0 0 0.5rem 0',
                              borderRadius: '6px',
                              transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel-alt)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <span style={{ 
                              fontSize: '0.875rem', 
                              transition: 'transform 0.2s',
                              transform: showInstruction ? 'rotate(90deg)' : 'rotate(0deg)',
                              display: 'inline-block'
                            }}>▶</span>
                            <h3 style={{ margin: 0 }}>{meta.spanKind === 'model' ? 'System Instruction' : 'Agent Instruction'}</h3>
                          </div>
                          {showInstruction && (
                            <div style={{ 
                              background: 'var(--bg)',
                              padding: '1rem',
                              borderRadius: '6px',
                              fontSize: '0.85rem',
                              lineHeight: '1.6',
                              whiteSpace: 'pre-wrap',
                              color: '#bbb',
                              fontStyle: 'italic'
                            }}>
                              {meta.instruction || meta.modelSystemInstruction}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )
                })()}

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

                {/* Tool Information */}
                {(() => {
                  const meta = getSpanMetadata(selectedSpan)
                  return meta.toolName && (
                    <div className="detail-section" style={{ marginBottom: '1rem' }}>
                      <div style={{ 
                        background: 'rgba(251, 146, 60, 0.1)',
                        border: '1px solid rgba(251, 146, 60, 0.3)',
                        padding: '1rem',
                        borderRadius: '8px'
                      }}>
                        <h3 style={{ 
                          margin: '0 0 0.75rem 0', 
                          color: '#fb923c',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          🔧 Tool Call
                        </h3>
                        <div style={{ fontSize: '0.9rem', lineHeight: '1.6' }}>
                          <div style={{ marginBottom: '0.5rem' }}>
                            <span style={{ color: '#666', fontWeight: 'bold' }}>Name:</span>{' '}
                            <span style={{ color: '#fb923c', fontFamily: 'monospace' }}>{meta.toolName}</span>
                          </div>
                          {meta.toolDescription && (
                            <div style={{ marginBottom: '0.5rem', color: '#aaa', fontStyle: 'italic' }}>
                              {meta.toolDescription}
                            </div>
                          )}
                          {meta.toolFunctionCallId && (
                            <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>
                              <span style={{ color: '#666' }}>Call ID:</span> <span style={{ fontFamily: 'monospace' }}>{meta.toolFunctionCallId}</span>
                            </div>
                          )}
                          {meta.toolArgsCount != null && (
                            <div style={{ marginTop: '0.75rem' }}>
                              <span style={{ color: '#666', fontWeight: 'bold' }}>Arguments:</span>{' '}
                              <span>{meta.toolArgsCount} arg{meta.toolArgsCount !== 1 ? 's' : ''}</span>
                              {meta.toolArgsKeys && Array.isArray(meta.toolArgsKeys) && meta.toolArgsKeys.length > 0 && (
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: '#999' }}>
                                  ({meta.toolArgsKeys.join(', ')})
                                </span>
                              )}
                            </div>
                          )}
                          {(meta.toolResponseSuccess != null || meta.toolResponseHasData != null) && (
                            <div style={{ 
                              marginTop: '0.75rem',
                              paddingTop: '0.75rem',
                              borderTop: '1px solid rgba(251, 146, 60, 0.2)'
                            }}>
                              <span style={{ color: '#666', fontWeight: 'bold' }}>Response:</span>
                              {meta.toolResponseSuccess != null && (
                                <div style={{ marginTop: '0.25rem' }}>
                                  <span style={{ 
                                    color: meta.toolResponseSuccess ? '#4ade80' : '#ef4444',
                                    fontWeight: 'bold'
                                  }}>
                                    {meta.toolResponseSuccess ? '✓ Success' : '✗ Failed'}
                                  </span>
                                </div>
                              )}
                              {meta.toolResponseHasData != null && (
                                <div style={{ fontSize: '0.85rem', color: '#aaa', marginTop: '0.25rem' }}>
                                  {meta.toolResponseHasData ? 'Contains data' : 'No data returned'}
                                </div>
                              )}
                              {meta.toolResponseKeys && Array.isArray(meta.toolResponseKeys) && meta.toolResponseKeys.length > 0 && (
                                <div style={{ fontSize: '0.85rem', color: '#999', marginTop: '0.25rem' }}>
                                  Keys: {meta.toolResponseKeys.join(', ')}
                                </div>
                              )}
                              {meta.toolResponseError && (
                                <div style={{ 
                                  marginTop: '0.5rem',
                                  padding: '0.5rem',
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  borderRadius: '4px',
                                  fontSize: '0.85rem',
                                  color: '#ef4444',
                                  fontFamily: 'monospace'
                                }}>
                                  {meta.toolResponseError}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Model Output Information */}
                {(() => {
                  const meta = getSpanMetadata(selectedSpan)
                  const hasModelOutput = meta.modelOutputFinishReason || meta.modelOutputHasText != null || 
                                        meta.modelOutputHasFunctionCalls != null || meta.modelOutputTextLength != null ||
                                        meta.modelOutputFunctionCallCount != null
                  return hasModelOutput && (
                    <div className="detail-section" style={{ marginBottom: '1rem' }}>
                      <div style={{ 
                        background: 'rgba(59, 130, 246, 0.05)',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                        padding: '1rem',
                        borderRadius: '8px'
                      }}>
                        <h3 style={{ 
                          margin: '0 0 0.75rem 0', 
                          color: '#3b82f6',
                          fontSize: '0.95rem'
                        }}>
                          Model Output
                        </h3>
                        <div style={{ 
                          display: 'grid',
                          gridTemplateColumns: 'auto 1fr',
                          gap: '0.5rem 1rem',
                          fontSize: '0.85rem',
                          alignItems: 'center'
                        }}>
                          {meta.modelOutputFinishReason && (
                            <>
                              <span style={{ color: '#666' }}>Finish Reason:</span>
                              <span style={{ 
                                color: meta.modelOutputFinishReason.includes('STOP') ? '#4ade80' : '#fbbf24',
                                fontFamily: 'monospace',
                                fontSize: '0.8rem'
                              }}>
                                {meta.modelOutputFinishReason}
                              </span>
                            </>
                          )}
                          {meta.modelOutputHasText != null && (
                            <>
                              <span style={{ color: '#666' }}>Has Text:</span>
                              <span style={{ color: meta.modelOutputHasText ? '#4ade80' : '#888' }}>
                                {meta.modelOutputHasText ? '✓ Yes' : '✗ No'}
                              </span>
                            </>
                          )}
                          {meta.modelOutputTextLength != null && (
                            <>
                              <span style={{ color: '#666' }}>Text Length:</span>
                              <span>{meta.modelOutputTextLength} chars</span>
                            </>
                          )}
                          {meta.modelOutputHasFunctionCalls != null && (
                            <>
                              <span style={{ color: '#666' }}>Has Function Calls:</span>
                              <span style={{ color: meta.modelOutputHasFunctionCalls ? '#fb923c' : '#888' }}>
                                {meta.modelOutputHasFunctionCalls ? '✓ Yes' : '✗ No'}
                              </span>
                            </>
                          )}
                          {meta.modelOutputFunctionCallCount != null && (
                            <>
                              <span style={{ color: '#666' }}>Function Calls:</span>
                              <span style={{ color: '#fb923c' }}>{meta.modelOutputFunctionCallCount}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Model Usage & Cost */}
                {(() => {
                  const meta = getSpanMetadata(selectedSpan)
                  const hasUsageOrCost = meta.modelUsagePromptTokens != null || meta.modelUsageCompletionTokens != null ||
                                        meta.modelUsageTotalTokens != null || meta.modelCostTotal != null
                  return hasUsageOrCost && (
                    <div className="detail-section" style={{ marginBottom: '1rem' }}>
                      <div style={{ 
                        background: 'rgba(139, 92, 246, 0.05)',
                        border: '1px solid rgba(139, 92, 246, 0.2)',
                        padding: '1rem',
                        borderRadius: '8px'
                      }}>
                        <h3 style={{ 
                          margin: '0 0 0.75rem 0', 
                          color: '#8b5cf6',
                          fontSize: '0.95rem'
                        }}>
                          Usage & Cost
                        </h3>
                        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                          {/* Token Usage */}
                          {(meta.modelUsagePromptTokens != null || meta.modelUsageCompletionTokens != null) && (
                            <div style={{ flex: '1 1 200px' }}>
                              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Token Usage
                              </div>
                              <div style={{ fontSize: '0.85rem', lineHeight: '1.8' }}>
                                {meta.modelUsagePromptTokens != null && (
                                  <div>
                                    <span style={{ color: '#888' }}>Input:</span>{' '}
                                    <span style={{ fontFamily: 'monospace', color: '#3b82f6' }}>{meta.modelUsagePromptTokens.toLocaleString()}</span>
                                  </div>
                                )}
                                {meta.modelUsageCompletionTokens != null && (
                                  <div>
                                    <span style={{ color: '#888' }}>Output:</span>{' '}
                                    <span style={{ fontFamily: 'monospace', color: '#8b5cf6' }}>{meta.modelUsageCompletionTokens.toLocaleString()}</span>
                                  </div>
                                )}
                                {meta.modelUsageTotalTokens != null && (
                                  <div style={{ 
                                    marginTop: '0.25rem',
                                    paddingTop: '0.25rem',
                                    borderTop: '1px solid rgba(139, 92, 246, 0.2)'
                                  }}>
                                    <span style={{ color: '#888', fontWeight: 'bold' }}>Total:</span>{' '}
                                    <span style={{ fontFamily: 'monospace', color: '#fff', fontWeight: 'bold' }}>{meta.modelUsageTotalTokens.toLocaleString()}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {/* Cost Breakdown */}
                          {meta.modelCostTotal != null && (
                            <div style={{ flex: '1 1 200px' }}>
                              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.5rem', textTransspace: 'uppercase', letterSpacing: '0.5px' }}>
                                Cost {meta.modelCostCurrency && `(${meta.modelCostCurrency})`}
                              </div>
                              <div style={{ fontSize: '0.85rem', lineHeight: '1.8' }}>
                                {meta.modelCostInput != null && (
                                  <div>
                                    <span style={{ color: '#888' }}>Input:</span>{' '}
                                    <span style={{ fontFamily: 'monospace', color: '#4ade80' }}>${meta.modelCostInput.toFixed(6)}</span>
                                  </div>
                                )}
                                {meta.modelCostOutput != null && (
                                  <div>
                                    <span style={{ color: '#888' }}>Output:</span>{' '}
                                    <span style={{ fontFamily: 'monospace', color: '#fbbf24' }}>${meta.modelCostOutput.toFixed(6)}</span>
                                  </div>
                                )}
                                <div style={{ 
                                  marginTop: '0.25rem',
                                  paddingTop: '0.25rem',
                                  borderTop: '1px solid rgba(139, 92, 246, 0.2)'
                                }}>
                                  <span style={{ color: '#888', fontWeight: 'bold' }}>Total:</span>{' '}
                                  <span style={{ fontFamily: 'monospace', color: '#fff', fontWeight: 'bold', fontSize: '1rem' }}>${meta.modelCostTotal.toFixed(6)}</span>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* Log Probs */}
                          {meta.modelLogprobsAvg != null && (
                            <div style={{ flex: '1 1 200px' }}>
                              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Log Probability
                              </div>
                              <div style={{ fontSize: '0.85rem' }}>
                                <div>
                                  <span style={{ color: '#888' }}>Avg:</span>{' '}
                                  <span style={{ fontFamily: 'monospace', color: '#14b8a6' }}>{meta.modelLogprobsAvg.toFixed(4)}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Error Information */}
                {(() => {
                  const meta = getSpanMetadata(selectedSpan)
                  return meta.errorOccurred && (
                    <div className="detail-section" style={{ marginBottom: '1rem' }}>
                      <div style={{ 
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        padding: '1rem',
                        borderRadius: '8px'
                      }}>
                        <h3 style={{ 
                          margin: '0 0 0.5rem 0', 
                          color: '#ef4444',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          ⚠️ Error Occurred
                        </h3>
                        <div style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
                          An error was detected during span execution.
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Compact Span Information - Expandable */}
                <div className="detail-section" style={{ marginBottom: '1rem' }}>
                  <div 
                    className="expandable-header" 
                    onClick={() => setShowSpanInfo(!showSpanInfo)}
                    style={{ 
                      cursor: 'pointer', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.5rem',
                      margin: '0 0 0.75rem 0',
                      borderRadius: '6px',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel-alt)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ 
                      fontSize: '0.875rem', 
                      transition: 'transform 0.2s',
                      transform: showSpanInfo ? 'rotate(90deg)' : 'rotate(0deg)',
                      display: 'inline-block'
                    }}>▶</span>
                    <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#888' }}>Span Information</h3>
                  </div>
                  {showSpanInfo && (
                    <div style={{ 
                      marginTop: '0.75rem',
                      fontSize: '0.85rem',
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      gap: '0.5rem',
                      color: '#aaa'
                    }}>
                      <span style={{ color: '#666' }}>Span ID:</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{selectedSpan.span_id}</span>
                      <span style={{ color: '#666' }}>Start Time:</span>
                      <span>{formatTS(selectedSpan.start_time)}</span>
                      <span style={{ color: '#666' }}>Duration:</span>
                      <span>{selectedSpan.duration_ms}ms</span>
                      {selectedSpan.status_code && (
                        <>
                          <span style={{ color: '#666' }}>Status:</span>
                          <span>{selectedSpan.status_code}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Attributes */}
                {selectedSpan.attributes && (
                  <div className="detail-section">
                    <h3>Attributes</h3>
                    {renderAttrTable(selectedSpan.attributes)}
                  </div>
                )}

                {/* Raw Attributes - Expandable */}
                <div className="detail-section" style={{ marginBottom: '1rem' }}>
                  <div 
                    className="expandable-header" 
                    onClick={() => setShowRawAttrs(!showRawAttrs)}
                    style={{ 
                      cursor: 'pointer', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.5rem',
                      margin: '0 0 0.75rem 0',
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
                <div className="detail-section" style={{ marginBottom: '1rem' }}>
                  <div 
                    className="expandable-header" 
                    onClick={() => setShowRawSpan(!showRawSpan)}
                    style={{ 
                      cursor: 'pointer', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.5rem',
                      margin: '0 0 0.75rem 0',
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
