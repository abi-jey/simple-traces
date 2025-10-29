import React, { useMemo, useState } from 'react'
import '../WaterfallView.css'
import type { SpanRecord } from '../types'

export interface LinkedConversation {
	span_id: string
	conversation_id: string
	relation?: string
}

export interface SpanNode extends SpanRecord {
	children?: SpanNode[]
	isVirtualLink?: boolean
	isFromLinkedConversation?: boolean
	linkedConversationId?: string
	linkedRelation?: string
}

export default function WaterfallView({
	spans,
	onSpanClick,
	selectedSpanId,
	linkedConversations = [],
	compact = false,
	showLegend = true,
	defaultCollapsed = false,
}: {
	spans: SpanRecord[]
	onSpanClick?: (span: SpanRecord) => void
	selectedSpanId?: string | null
	linkedConversations?: LinkedConversation[]
	compact?: boolean
	showLegend?: boolean
	defaultCollapsed?: boolean
}) {
	const truncate = (s: string | undefined, n: number) => {
		if (!s) return s
		if (s.length <= n) return s
		return s.slice(0, Math.max(0, n - 1)) + '…'
	}

	const hasLinks = (spanId: string) => linkedConversations && linkedConversations.some((l) => l.span_id === spanId)

	if (!spans || spans.length === 0) {
		return <div className="waterfall-empty">No spans to display</div>
	}

	const { minTime, maxTime, totalDuration } = useMemo(() => {
		const times = spans.map((s) => ({ start: new Date(s.start_time!).getTime(), end: new Date(s.end_time!).getTime() }))
		const min = Math.min(...times.map((t) => t.start))
		const max = Math.max(...times.map((t) => t.end))
		return { minTime: min, maxTime: max, totalDuration: Math.max(max - min, 1) }
	}, [spans])

	const groups = useMemo(() => {
		const m = new Map<string, SpanRecord[]>()
		for (const sp of spans) {
			const id = (sp as any).trace_id || 'unknown'
			if (!m.has(id)) m.set(id, [])
			m.get(id)!.push(sp)
		}
		const arr = Array.from(m.entries()).map(([traceId, list]) => {
			const sorted = [...list].sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
			const gMin = Math.min(...sorted.map((s) => new Date(s.start_time!).getTime()))
			const gMax = Math.max(...sorted.map((s) => new Date(s.end_time!).getTime()))

			const spanMap = new Map<string, SpanNode>()
			const rootSpans: SpanNode[] = []

			sorted.forEach((span) => {
				spanMap.set(span.span_id, { ...(span as SpanNode), children: [] })
			})

			sorted.forEach((span) => {
				const node = spanMap.get(span.span_id)!
				if (!span.parent_span_id || span.parent_span_id === '' || span.parent_span_id === '0000000000000000') {
					rootSpans.push(node)
				} else {
					const parent = spanMap.get(span.parent_span_id)
					if (parent) parent.children!.push(node)
					else rootSpans.push(node)
				}
			})

			return { traceId, spans: sorted, rootSpans, gMin, gMax }
		})
		arr.sort((a, b) => a.gMin - b.gMin)
		return arr
	}, [spans])

	const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
		const init: Record<string, boolean> = {}
		for (const g of groups) g.rootSpans.forEach((root) => (init[root.span_id] = defaultCollapsed))
		return init
	})
	const toggleSpan = (spanId: string) => setCollapsed((c) => ({ ...c, [spanId]: !c[spanId] }))

	const getSpanColor = (span: SpanRecord) => {
		let attrs: any = null
		try {
			attrs = span.attributes ? JSON.parse(span.attributes) : null
		} catch {
			attrs = null
		}
		if (span.status_code === 'ERROR') return '#ef4444'
		if (span.status_code === 'OK') return '#10b981'
		if ((span as any).status_code === 'LINKED') return '#06b6d4'

		if (attrs) {
			const spanKind = attrs['simpleTraces.span.kind']
			if (spanKind === 'agent') return '#8b5cf6'
			if (spanKind === 'llm' || spanKind === 'model') return '#3b82f6'
			if (spanKind === 'tool') return '#f59e0b'
			if (spanKind === 'invocation') return '#64748b'
			const sdk = attrs['simpleTraces.SDK']
			if (sdk === 'google-adk' || sdk === 'adk') return '#14b8a6'
		}
		const name = (span.name || '').toLowerCase()
		if (name.includes('call_llm') || name.includes('llm')) return '#3b82f6'
		if (name.includes('invoke_agent')) return '#8b5cf6'
		if (name.includes('execute_tool sleep_tool') || name === 'sleep_tool') return '#6b7280'
		if (name.includes('execute_tool')) return '#f59e0b'
		if (name.includes('torrentagent') || name.includes('adk.agent')) return '#14b8a6'
		if (name.includes('invocation')) return '#64748b'
		if (attrs) {
			if (attrs['llm.input'] || attrs['gen_ai.prompt']) return '#3b82f6'
			if (attrs['llm.output'] || attrs['gen_ai.response']) return '#8b5cf6'
		}
		return '#6b7280'
	}

	const formatDuration = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`)
	const formatTime = (ts: string | number | Date) => new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })

	const renderSpanNode = (node: SpanNode, depth = 0): React.ReactNode => {
		const span = node as SpanRecord
		const start = new Date(span.start_time!).getTime()
		const end = new Date(span.end_time!).getTime()
		const duration = Math.max(end - start, 0)
		const leftPct = ((start - minTime) / totalDuration) * 100
		const widthPctRaw = (duration / totalDuration) * 100
		const widthPct = Math.max(widthPctRaw, 0.5)
		const color = getSpanColor(span)
		const isSelected = selectedSpanId === span.span_id
		const isNarrow = widthPct < 8
		const indent = depth * 20
		const hasChildren = !!node.children && node.children.length > 0
		const isCollapsed = collapsed[span.span_id]
		const showLinkIcon = hasLinks(span.span_id)

		return (
			<React.Fragment key={span.span_id}>
				<div
					className={`waterfall-row ${isSelected ? 'selected' : ''} ${(node as any).isFromLinkedConversation ? 'from-linked-row' : ''}`}
					onClick={() => onSpanClick && onSpanClick(span)}
				>
					<div className="waterfall-label" style={{ paddingLeft: `${indent}px` }}>
						<span
							className="span-name"
							onClick={(e) => {
								if (hasChildren) {
									e.stopPropagation()
									toggleSpan(span.span_id)
								}
							}}
							style={{ cursor: hasChildren ? 'pointer' : 'default' }}
						>
							{hasChildren && (isCollapsed ? '▶ ' : '▼ ')}
							{depth > 0 && !hasChildren && '└─ '}
							{span.name}
							{showLinkIcon && (
								<span style={{ marginLeft: '0.5rem', fontSize: '0.9rem', opacity: 0.7, cursor: 'pointer' }} title="Has linked conversations">
									🔗
								</span>
							)}
						</span>
						<span className="span-duration">{formatDuration(duration)}</span>
					</div>
					<div className="waterfall-track" role="presentation">
						<div
							className={`waterfall-bar ${isNarrow ? 'narrow' : ''} ${(node as any).isVirtualLink ? 'virtual-link' : ''}`}
							style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: color }}
							title={(node as any).isFromLinkedConversation
								? `${span.name} (from linked conversation)\nConversation: ${(node as any).linkedConversationId}\nRelation: ${(node as any).linkedRelation}\nStart: ${formatTime(span.start_time!)}\nEnd: ${formatTime(span.end_time!)}\nDuration: ${formatDuration(duration)}\nStatus: ${span.status_code || 'N/A'}`
								: `${span.name}\nStart: ${formatTime(span.start_time!)}\nEnd: ${formatTime(span.end_time!)}\nDuration: ${formatDuration(duration)}\nStatus: ${span.status_code || 'N/A'}`}
						>
							<div className="waterfall-bar-label">{(node as any).isFromLinkedConversation && '🔗 '}{span.name}</div>
						</div>
					</div>
				</div>
				{hasChildren && !isCollapsed && node.children!.map((child) => renderSpanNode(child, depth + 1))}
			</React.Fragment>
		)
	}

	return (
		<div className={`waterfall-container ${compact ? 'compact' : ''}`}>
			<div className="waterfall-header">
				<div className="waterfall-title">Timeline</div>
				<div className="waterfall-duration">Total: {formatDuration(totalDuration)}</div>
			</div>

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

// Generated by Copilot
