import iconPng from '../../assets/icon.png'

type Props = {
  collapsed?: boolean
}

export function SidebarBrand({ collapsed = false }: Props) {
  return (
    <div className={`flex items-center border-b border-border max-[840px]:flex-[0_0_auto] max-[840px]:border-b-0 max-[840px]:px-4 max-[840px]:py-3 ${
      collapsed ? 'justify-center px-3 py-3' : 'gap-2.5 px-4 pb-3 pt-4'
    }`}>
      <img
        src={iconPng}
        alt="Launchpad"
        className="shrink-0 rounded-md transition-transform duration-200 hover:scale-105"
        width={32}
        height={32}
      />
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className="truncate whitespace-nowrap text-[13px] font-semibold tracking-tight text-heading">
            Launchpad
          </div>
          <div className="mt-px text-[10px] uppercase tracking-wide text-muted">
            Arma 3 Toolkit
          </div>
        </div>
      )}
    </div>
  )
}
