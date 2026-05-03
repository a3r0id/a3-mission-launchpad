import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faFolderMinus,
  faFolderPlus,
  faFileCirclePlus,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons'

export type FileTreeToolbarProps = {
  onCollapseAll: () => void
  onExpandAll: () => void
  onNewFile: () => void
  onRefresh: () => void
  disabled?: boolean
}

export function FileTreeToolbar({
  onCollapseAll,
  onExpandAll,
  onNewFile,
  onRefresh,
  disabled,
}: FileTreeToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
      <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Files</span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-xs text-muted transition-[background,color] duration-100 hover:enabled:bg-app hover:enabled:text-heading disabled:cursor-default disabled:opacity-40"
          onClick={onNewFile}
          disabled={disabled}
          title="New File"
          aria-label="New File"
        >
          <FontAwesomeIcon icon={faFileCirclePlus} />
        </button>
        <button
          type="button"
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-xs text-muted transition-[background,color] duration-100 hover:enabled:bg-app hover:enabled:text-heading disabled:cursor-default disabled:opacity-40"
          onClick={onExpandAll}
          disabled={disabled}
          title="Expand All"
          aria-label="Expand All Folders"
        >
          <FontAwesomeIcon icon={faFolderPlus} />
        </button>
        <button
          type="button"
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-xs text-muted transition-[background,color] duration-100 hover:enabled:bg-app hover:enabled:text-heading disabled:cursor-default disabled:opacity-40"
          onClick={onCollapseAll}
          disabled={disabled}
          title="Collapse All"
          aria-label="Collapse All Folders"
        >
          <FontAwesomeIcon icon={faFolderMinus} />
        </button>
        <button
          type="button"
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-0 bg-transparent text-xs text-muted transition-[background,color] duration-100 hover:enabled:bg-app hover:enabled:text-heading disabled:cursor-default disabled:opacity-40"
          onClick={onRefresh}
          disabled={disabled}
          title="Refresh"
          aria-label="Refresh File Tree"
        >
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
      </div>
    </div>
  )
}
