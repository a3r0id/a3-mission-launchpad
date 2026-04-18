import { useEffect, useState } from 'react'
import { AppPreferencesDialog } from './components/AppPreferencesDialog'
import { Sidebar } from './components/Sidebar'
import { SplashScreen } from './components/SplashScreen'
import { AppPreferencesProvider } from './context/AppPreferencesContext'
import { getElectronIpc } from './electronIpc'
import { HomePage } from './pages/HomePage'
import { MissionListPage } from './pages/MissionList'
import { ModProjectsPage } from './pages/ModProjects'
import { SettingsPage } from './pages/SettingsPage'
import { TestingPage } from './pages/Testing'
import { LoggingPage } from './pages/Logging'
import { DebuggingPage } from './pages/Debugging'
import './App.less'

type NavId = 'home' | 'managed-missions' | 'managed-mod-projects' | 'testing' | 'debugging' | 'logging' | 'settings'

type MenuEventPayload = { event?: string }

export default function App() {
  const [page, setPage] = useState<NavId>('home')
  const [preferencesOpen, setPreferencesOpen] = useState(false)

  useEffect(() => {
    const ipc = getElectronIpc()
    if (!ipc) return
    const handler = (_evt: unknown, ...args: unknown[]) => {
      const payload = args[0] as MenuEventPayload | undefined
      if (payload?.event === 'preferences') {
        setPreferencesOpen(true)
      }
    }
    ipc.on('menu-event', handler)
    return () => {
      ipc.removeListener('menu-event', handler)
    }
  }, [])

  return (
    <AppPreferencesProvider>
      <SplashScreen />
      <div className="app-shell">
        <Sidebar
          active={page}
          onSelect={(id) => {
            setPage(id)
          }}
        />
        <div className="shell-main">
          <main className="shell-content" id="main">
            {page === 'home' && (
              <HomePage onGoMission={() => setPage('managed-missions')} onGoSettings={() => setPage('settings')} />
            )}
            {page === 'settings' && <SettingsPage />}
            {page === 'managed-missions' && (
              <MissionListPage onOpenSettings={() => setPage('settings')} />
            )}
            {page === 'managed-mod-projects' && <ModProjectsPage />}
            {page === 'testing' && <TestingPage />}
            {page === 'debugging' && <DebuggingPage />}
            {page === 'logging' && <LoggingPage />}
          </main>
        </div>
      </div>
      {preferencesOpen ? <AppPreferencesDialog onClose={() => setPreferencesOpen(false)} /> : null}
    </AppPreferencesProvider>
  )
}
