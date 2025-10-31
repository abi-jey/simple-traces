import { useEffect, useState } from 'react'
import './App.css'
import ProjectsPage from './pages/ProjectsPage'
import MainPage from './pages/MainPage'
import ConversationDetails from './ConversationDetails'
import { type ConnectionStatus } from './components/ConnectionIndicator'
import Header from './components/Header'
import type { Project, Theme } from './types'

export default function App() {
  const [theme, setTheme] = useState<Theme>('dark')
  const [view, setView] = useState<'main' | 'projects' | 'conversation' | '404'>('main')
  const [project, setProject] = useState<string>('')
  const [projectId, setProjectId] = useState<string>('')
  const [projects, setProjects] = useState<Project[]>([])
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  // Search UI moved to Header and is currently non-functional.
  const [probes, setProbes] = useState<boolean[]>([])

  useEffect(() => {
    const saved = localStorage.getItem('st-theme') as Theme | null
    const initial = saved === 'dark' || saved === 'light' ? saved : 'dark'
    setTheme(initial)
    document.documentElement.setAttribute('data-theme', initial)
  }, [])

  const toggleTheme = (next: Theme) => {
    setTheme(next)
    localStorage.setItem('st-theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  // Record result of conversation API probe and compute connection status
  const onConnectionProbe = (ok: boolean) => {
    setProbes((prev) => {
      const next = [...prev, ok].slice(-3)
      // Determine status from last 3 results
      let status: ConnectionStatus = 'connecting'
      if (next.length === 3) {
        const successes = next.filter(Boolean).length
        const failures = 3 - successes
        if (successes === 3) status = 'connected'
        else if (failures === 3) status = 'disconnected'
        else status = 'connecting'
      } else {
        status = 'connecting'
      }
      if (status !== connectionStatus) setConnectionStatus(status)
      return next
    })
  }

  // Basic route parse
  useEffect(() => {
    const parseRoute = (path: string) => {
      if (path === '/' || path === '') return { route: 'root' as const }
      if (path === '/projects') return { route: 'projects' as const }
      const projectMatch = path.match(/^\/projects\/([^/]+)\/?$/)
      if (projectMatch) return { route: 'project' as const, id: decodeURIComponent(projectMatch[1]) }
      const conversationMatch = path.match(/^\/conversations\/([^/]+)\/?$/)
      if (conversationMatch) return { route: 'conversation' as const, id: decodeURIComponent(conversationMatch[1]) }
      return { route: '404' as const }
    }
    const route = parseRoute(window.location.pathname)
    if (route.route === 'projects') {
      setView('projects')
    } else if (route.route === 'project') {
      setProjectId(route.id)
      setProject(route.id)
      setView('main')
    } else if (route.route === 'conversation') {
      setView('conversation')
    } else if (route.route === '404') {
      setView('404')
    } else if (route.route === 'root') {
      setView('projects')
      if (window.location.pathname !== '/projects') window.history.pushState({}, '', '/projects')
    }
    const onPop = () => {
      const r = parseRoute(window.location.pathname)
      if (r.route === 'projects') setView('projects')
      else if (r.route === 'project') { setProjectId(r.id); setProject(r.id); setView('main') }
      else if (r.route === 'conversation') setView('conversation')
      else if (r.route === '404') setView('404')
      else setView('projects')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const onChooseProject = (p: Project) => {
    setProject(p.name)
    setProjectId(p.id)
    if (window.location.pathname !== `/projects/${encodeURIComponent(p.id)}`) {
      window.history.pushState({}, '', `/projects/${encodeURIComponent(p.id)}`)
    }
    setView('main')
  }

  const navigateToConversation = (id: string) => {
    const path = `/conversations/${encodeURIComponent(id)}`
    window.history.pushState({}, '', path)
    setCurrentConversationId(id)
    setView('conversation')
  }

  return (
    <div className="app">
      <Header
        theme={theme}
        connectionStatus={connectionStatus}
        onToggleTheme={toggleTheme}
        onGoToProjects={() => {
          if (window.location.pathname !== '/projects') window.history.pushState({}, '', '/projects')
          setView('projects')
        }}
      />

      <div className="container">
        {view === 'projects' && (
          <ProjectsPage projects={projects} setProjects={setProjects} onSelect={onChooseProject} />
        )}

        {view === 'main' && (
          <MainPage
            theme={theme}
            onNavigateConversation={navigateToConversation}
            connectionStatus={connectionStatus}
            onConnectionProbe={onConnectionProbe}
          />
        )}

        {view === 'conversation' && currentConversationId && (
          <ConversationDetails conversationId={currentConversationId} onClose={() => window.history.back()} />
        )}

        {view === '404' && <div style={{ padding: '2rem' }}>Not Found</div>}
      </div>
    </div>
  )
}

// Generated by Copilot