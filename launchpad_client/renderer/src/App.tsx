import { useEffect, useState } from 'react'
import { AppPreferencesDialog } from './components/AppPreferencesDialog'
import { AppSidebar, useSidebarCollapse, type NavId } from './components/AppSidebar'
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
type MenuEventPayload = { event?: string }

export default function App() {
  const [page, setPage] = useState<NavId>('home')
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [settingsKeepAlive, setSettingsKeepAlive] = useState(false)
  const { collapsed, toggle: toggleSidebar } = useSidebarCollapse()

  const openSettings = () => {
    setSettingsKeepAlive(true)
    setPage('settings')
  }

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
        <AppSidebar
          active={page}
          onSelect={(id) => {
            if (id === 'settings') setSettingsKeepAlive(true)
            setPage(id)
          }}
          collapsed={collapsed}
          onToggleCollapse={toggleSidebar}
        />
        <div className="shell-main">
          <main className="shell-content scrollbar-subtle" id="main">
            {settingsKeepAlive ? (
              <div
                className="h-full min-h-0 w-full min-w-0 overflow-hidden"
                hidden={page !== 'settings'}
              >
                <SettingsPage />
              </div>
            ) : null}
            {page === 'home' && (
              <HomePage onGoMission={() => setPage('managed-missions')} onGoSettings={openSettings} />
            )}
            {page === 'managed-missions' && (
              <MissionListPage onOpenSettings={openSettings} />
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
