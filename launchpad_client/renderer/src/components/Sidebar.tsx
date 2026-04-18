import { useEffect, useState } from 'react'
import { getElectronIpc } from '../electronIpc'

type NavId = 'home' | 'managed-missions' | 'managed-mod-projects' | 'testing' | 'debugging' | 'logging' | 'settings'

type Props = {
  active: NavId
  onSelect: (id: NavId) => void
}

const items: { id: NavId; label: string; hint: string }[] = [
  { id: 'home', label: 'Overview', hint: 'Status and quick links' },
  { id: 'settings', label: 'Settings', hint: 'Configure the application' },
  { id: 'managed-missions', label: 'Mission Projects', hint: 'View and create missions' },
  { id: 'managed-mod-projects', label: 'Mod Projects', hint: 'Addon source folders you track here' },
  { id: 'testing', label: 'Testing', hint: 'Mods and Arma 3 test launch' },
  { id: 'debugging', label: 'Debugging', hint: 'Companion socket and live commands' },
  { id: 'logging', label: 'Logs', hint: 'Live RPT stream and browse' },
]

export function Sidebar({ active, onSelect }: Props) {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    const ipc = getElectronIpc()
    if (!ipc) return
    void ipc
      .invoke('getAppVersion')
      .then((payload) => {
        if (cancelled) return
        const v = (payload as { version?: unknown })?.version
        if (typeof v === 'string' && v.trim()) {
          setVersion(v.trim())
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <aside className="shell-sidebar" aria-label="Primary">
      <div className="shell-brand">
        <img src="/hero.png" alt="Mission Launchpad" className="shell-brand-logo" width={36} height={32} />
        <div>
          <div className="shell-brand-title">Mission Launchpad</div>
          <div className="shell-brand-sub">Arma 3 Development Toolkit</div>
        </div>
      </div>

      <nav className="shell-nav" aria-label="Sections">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`shell-nav-item${active === item.id ? ' is-active' : ''}`}
            onClick={() => onSelect(item.id)}
            aria-current={active === item.id ? 'page' : undefined}
          >
            <span className="shell-nav-label">{item.label}</span>
            <span className="shell-nav-hint">{item.hint}</span>
          </button>
        ))}
      </nav>

      <div className="shell-sidebar-footer">
        <p className="shell-footnote">
          {version ? `Launchpad v${version}` : 'Launchpad desktop'}
        </p>
      </div>
    </aside>
  )
}
