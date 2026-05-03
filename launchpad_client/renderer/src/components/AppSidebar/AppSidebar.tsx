import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import { navGroups } from './navItems'
import { SidebarBrand } from './SidebarBrand'
import { SidebarFooter } from './SidebarFooter'
import { SidebarNav } from './SidebarNav'
import type { NavId } from './types'

type Props = {
  active: NavId
  onSelect: (id: NavId) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function AppSidebar({ active, onSelect, collapsed = false, onToggleCollapse }: Props) {
  return (
    <div className="group/sidebar relative flex shrink-0 self-stretch max-[840px]:w-full max-[840px]:shrink">
      <aside
        className={`flex shrink-0 flex-col self-stretch overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200 max-[840px]:w-full max-[840px]:flex-row max-[840px]:flex-wrap max-[840px]:border-b max-[840px]:border-r-0 ${
          collapsed ? 'w-14 min-w-14' : 'w-60 min-w-60'
        }`}
        aria-label="Primary"
      >
        <SidebarBrand collapsed={collapsed} />
        <SidebarNav groups={navGroups} active={active} onSelect={onSelect} collapsed={collapsed} />
        <SidebarFooter active={active} onSelect={onSelect} collapsed={collapsed} />
      </aside>
      {onToggleCollapse && (
        <div className="group/edge absolute right-0 top-0 z-20 h-full w-8 max-[840px]:hidden">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="absolute left-[calc(100%+6px)] top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-border-strong opacity-0 transition-[opacity,color,transform] duration-300 ease-out hover:scale-110 hover:text-accent group-hover/edge:opacity-100"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand (⌘B)' : 'Collapse (⌘B)'}
          >
            <FontAwesomeIcon 
              icon={collapsed ? faChevronRight : faChevronLeft} 
              className="h-3 w-3 transition-transform duration-200" 
            />
          </button>
        </div>
      )}
    </div>
  )
}
