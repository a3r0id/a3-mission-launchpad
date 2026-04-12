type NavId = 'home' | 'mission' | 'managed-missions' | 'settings'

type Props = {
  active: NavId
  onSelect: (id: NavId) => void
}

const items: { id: NavId; label: string; hint: string }[] = [
  { id: 'home', label: 'Overview', hint: 'Status and quick links' },
  { id: 'settings', label: 'Settings', hint: 'Configure the application' },
  { id: 'mission', label: 'New mission', hint: 'Create from template' },
  { id: 'managed-missions', label: 'Managed scenarios', hint: 'View all managed scenarios' },
]

export function Sidebar({ active, onSelect }: Props) {
  return (
    <aside className="shell-sidebar" aria-label="Primary">
      <div className="shell-brand">
        <img src="/38f9fcd3-0102-4999-b3c7-351783e7e0e4.png" alt="Mission Launchpad" className="shell-brand-logo" width={36} height={32} />
        <div>
          <div className="shell-brand-title">Mission Launchpad</div>
          <div className="shell-brand-sub">Arma 3 Scenario Toolkit</div>
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
          Backend:{' '}
          <code className="shell-inline-code">127.0.0.1:8111</code>
        </p>
      </div>
    </aside>
  )
}
