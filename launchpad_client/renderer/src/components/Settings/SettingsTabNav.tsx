import { SETTINGS_TABS, type SettingsTabId } from './settingsTabs'

type Props = {
  active: SettingsTabId
  onChange: (id: SettingsTabId) => void
}

const btnBase =
  'relative -mb-px min-h-[2.5rem] shrink-0 cursor-pointer border-b-2 border-transparent py-2 pl-0 pr-4 text-left text-sm font-medium text-muted transition-[color,background-color,border-color] last:pr-0 hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:pr-6'

const btnActive = 'border-b-accent text-heading'

export function SettingsTabNav({ active, onChange }: Props) {
  return (
    <div
      className="shrink-0 border-b border-border dark:border-white/10"
      role="tablist"
      aria-label="Settings sections"
    >
      <div className="flex min-h-0 flex-wrap gap-x-1 gap-y-0 sm:gap-x-2">
        {SETTINGS_TABS.map((t) => {
          const isActive = active === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`settings-tab-${t.id}`}
              aria-selected={isActive}
              aria-controls="settings-active-panel"
              className={`${btnBase} ${isActive ? btnActive : ''} `}
              onClick={() => onChange(t.id)}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
