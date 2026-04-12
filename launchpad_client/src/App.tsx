import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './pages/HomePage'
import { MissionBuildPage } from './pages/MissionBuildPage'
import { MissionListPage } from './pages/MissionList'
import { SettingsPage } from './pages/SettingsPage'
import './App.css'

type NavId = 'home' | 'mission' | 'managed-missions' | 'settings'
export default function App() {
  const [page, setPage] = useState<NavId>('home')

  return (
    <div className="app-shell">
      <Sidebar
        active={page}
        onSelect={(id) => {
          setPage(id)
        }}
      />
      <div className="shell-main">
        <main className="shell-content" id="main">
          {page === 'home' && <HomePage onGoMission={() => setPage('mission')} onGoSettings={() => setPage('settings')} />}
          {page === 'settings' && <SettingsPage />}
          {page === 'mission' && (
            <MissionBuildPage onGoSettings={() => setPage('settings')} />
          )}
          {page === 'managed-missions' && <MissionListPage />}
        </main>
      </div>
    </div>
  )
}
