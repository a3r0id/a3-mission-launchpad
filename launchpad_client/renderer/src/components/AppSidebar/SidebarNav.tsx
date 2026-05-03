import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { SidebarTooltip } from './SidebarTooltip'
import type { NavId, NavGroup } from './types'

type Props = {
  groups: NavGroup[]
  active: NavId
  onSelect: (id: NavId) => void
  collapsed?: boolean
}

export function SidebarNav({ groups, active, onSelect, collapsed = false }: Props) {
  return (
    <nav
      className="scrollbar-subtle flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-2 max-[840px]:min-h-0 max-[840px]:flex-1 max-[840px]:flex max-[840px]:flex-row max-[840px]:flex-wrap max-[840px]:items-center max-[840px]:gap-1 max-[840px]:overflow-visible max-[840px]:p-2"
      aria-label="Sections"
    >
      {groups.map((group, groupIndex) => (
        <div key={group.label} className="px-2 max-[840px]:contents">
          <div className={`overflow-hidden transition-all duration-200 ease-out max-[840px]:hidden ${
            collapsed ? 'h-0 opacity-0' : 'h-auto pb-1 pt-2 opacity-100'
          }`}>
            <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              {group.label}
            </div>
          </div>
          {collapsed && groupIndex > 0 && (
            <div className="mx-auto my-2 h-px w-6 bg-border" />
          )}
          {group.items.map((item) => {
            const isActive = active === item.id
            const button = (
              <button
                key={item.id}
                type="button"
                className={`group flex w-full items-center rounded-md [margin-block:1px] ${
                  collapsed 
                    ? 'justify-center p-2.5' 
                    : 'gap-2.5 px-2.5 py-2 text-left max-[840px]:px-2.5 max-[840px]:py-1.5'
                } ${
                  isActive
                    ? 'bg-accent hover:brightness-110'
                    : 'bg-transparent hover:bg-subtle'
                }`}
                onClick={() => onSelect(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <FontAwesomeIcon
                  icon={item.icon}
                  className={`h-4 w-4 shrink-0 ${
                    isActive
                      ? 'text-white'
                      : 'text-muted group-hover:text-foreground'
                  }`}
                />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <span
                      className={`block truncate whitespace-nowrap text-sm ${
                        isActive
                          ? 'font-semibold text-white'
                          : 'font-medium text-foreground'
                      }`}
                    >
                      {item.label}
                    </span>
                    <span
                      className={`mt-px block truncate whitespace-nowrap text-[10px] max-[840px]:hidden ${
                        isActive
                          ? 'text-white/75'
                          : 'text-muted'
                      }`}
                    >
                      {item.hint}
                    </span>
                  </div>
                )}
              </button>
            )

            if (collapsed) {
              return (
                <SidebarTooltip key={item.id} label={item.label} hint={item.hint}>
                  {button}
                </SidebarTooltip>
              )
            }

            return button
          })}
        </div>
      ))}
    </nav>
  )
}
