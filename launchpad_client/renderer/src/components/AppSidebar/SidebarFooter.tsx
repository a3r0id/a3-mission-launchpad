import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { getElectronIpc } from '../../electronIpc'
import { settingsItem } from './navItems'
import { SidebarTooltip } from './SidebarTooltip'
import type { NavId } from './types'

type Props = {
  active: NavId
  onSelect: (id: NavId) => void
  collapsed?: boolean
}

export function SidebarFooter({ active, onSelect, collapsed = false }: Props) {
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

  const settingsActive = active === 'settings'

  const settingsButton = (
    <button
      type="button"
      className={`group flex w-full items-center rounded-md [margin-block:1px] ${
        collapsed 
          ? 'justify-center p-2.5' 
          : 'gap-2.5 px-2.5 py-2 text-left max-[840px]:px-2.5 max-[840px]:py-1.5'
      } ${
        settingsActive
          ? 'bg-accent hover:brightness-110'
          : 'bg-transparent hover:bg-subtle'
      }`}
      onClick={() => onSelect('settings')}
      aria-current={settingsActive ? 'page' : undefined}
    >
      <FontAwesomeIcon
        icon={settingsItem.icon}
        className={`h-4 w-4 shrink-0 ${
          settingsActive
            ? 'text-white'
            : 'text-muted group-hover:text-foreground'
        }`}
      />
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <span
            className={`block truncate whitespace-nowrap text-sm ${
              settingsActive
                ? 'font-semibold text-white'
                : 'font-medium text-foreground'
            }`}
          >
            {settingsItem.label}
          </span>
          <span
            className={`mt-px block truncate whitespace-nowrap text-[10px] max-[840px]:hidden ${
              settingsActive
                ? 'text-white/75'
                : 'text-muted'
            }`}
          >
            {settingsItem.hint}
          </span>
        </div>
      )}
    </button>
  )

  return (
    <div className={`border-t border-border max-[840px]:flex max-[840px]:shrink-0 max-[840px]:items-center max-[840px]:gap-2 max-[840px]:border-t-0 max-[840px]:p-0 max-[840px]:px-3 max-[840px]:py-2 ${
      collapsed ? 'px-2 py-2' : 'p-2'
    }`}>
      {collapsed ? (
        <SidebarTooltip label={settingsItem.label} hint={settingsItem.hint}>
          {settingsButton}
        </SidebarTooltip>
      ) : (
        settingsButton
      )}
      {!collapsed && version && (
        <div className="px-2.5 py-1 text-center max-[840px]:p-0">
          <code className="inline-block rounded bg-app px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted">
            v{version}
          </code>
        </div>
      )}
    </div>
  )
}
