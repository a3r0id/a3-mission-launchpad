import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faFileCirclePlus,
  faFolderPlus,
  faPen,
  faTrash,
  faCopy,
  faFolderOpen,
  faClone,
  faCode,
  faRotate,
} from '@fortawesome/free-solid-svg-icons'

export type ContextMenuAction = 
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'delete'
  | 'copy-path'
  | 'reveal'
  | 'duplicate'
  | 'open-vscode'
  | 'open-cursor'
  | 'refresh'

export type ContextMenuTarget = {
  rel: string
  kind: 'file' | 'dir' | 'root'
  x: number
  y: number
}

export type FileTreeContextMenuProps = {
  target: ContextMenuTarget | null
  onAction: (action: ContextMenuAction, rel: string, kind: 'file' | 'dir' | 'root') => void
  onClose: () => void
  disabled?: boolean
}

type MenuItem = {
  action: ContextMenuAction
  label: string
  icon: typeof faFileCirclePlus
  showFor: ('file' | 'dir' | 'root')[]
  danger?: boolean
  dividerAfter?: boolean
}

const MENU_ITEMS: MenuItem[] = [
  { action: 'new-file', label: 'New File', icon: faFileCirclePlus, showFor: ['file', 'dir', 'root'] },
  { action: 'new-folder', label: 'New Folder', icon: faFolderPlus, showFor: ['file', 'dir', 'root'], dividerAfter: true },
  { action: 'rename', label: 'Rename', icon: faPen, showFor: ['file', 'dir'] },
  { action: 'duplicate', label: 'Duplicate', icon: faClone, showFor: ['file'], dividerAfter: true },
  { action: 'delete', label: 'Delete', icon: faTrash, showFor: ['file', 'dir'], danger: true, dividerAfter: true },
  { action: 'copy-path', label: 'Copy Path', icon: faCopy, showFor: ['file', 'dir'] },
  { action: 'reveal', label: 'Reveal in Explorer', icon: faFolderOpen, showFor: ['file', 'dir', 'root'] },
  { action: 'open-vscode', label: 'Open in VS Code', icon: faCode, showFor: ['file', 'dir', 'root'] },
  { action: 'open-cursor', label: 'Open in Cursor', icon: faCode, showFor: ['file', 'dir', 'root'], dividerAfter: true },
  { action: 'refresh', label: 'Refresh', icon: faRotate, showFor: ['file', 'dir', 'root'] },
]

export function FileTreeContextMenu({
  target,
  onAction,
  onClose,
  disabled,
}: FileTreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [deleteConfirming, setDeleteConfirming] = useState(false)

  useEffect(() => {
    if (!target) {
      setDeleteConfirming(false)
      return
    }

    const menu = menuRef.current
    if (!menu) {
      setPosition({ x: target.x, y: target.y })
      return
    }

    const rect = menu.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    let x = target.x
    let y = target.y

    if (x + rect.width > viewportW - 8) {
      x = viewportW - rect.width - 8
    }
    if (y + rect.height > viewportH - 8) {
      y = viewportH - rect.height - 8
    }

    setPosition({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [target])

  useEffect(() => {
    if (!target) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteConfirming) {
          setDeleteConfirming(false)
        } else {
          onClose()
        }
      }
    }

    const handleScroll = () => {
      onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [target, onClose, deleteConfirming])

  const handleAction = useCallback(
    (action: ContextMenuAction) => {
      if (!target || disabled) return
      if (action === 'delete') {
        setDeleteConfirming(true)
        return
      }
      onAction(action, target.rel, target.kind)
      onClose()
    },
    [target, disabled, onAction, onClose],
  )

  const confirmDelete = useCallback(() => {
    if (!target || disabled) return
    onAction('delete', target.rel, target.kind)
    onClose()
  }, [target, disabled, onAction, onClose])

  if (!target) return null

  const visibleItems = MENU_ITEMS.filter((item) => item.showFor.includes(target.kind))
  const fileName = target.rel ? target.rel.split('/').pop() || target.rel : 'this item'

  return (
    <div
      ref={menuRef}
      className="fixed z-[1000] min-w-[180px] rounded-[var(--radius)] border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.22)]"
      style={{ left: position.x, top: position.y }}
      role="menu"
    >
      {visibleItems.map((item, idx) => {
        if (item.action === 'delete' && deleteConfirming) {
          return (
            <div key={item.action} className="px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faTrash} className="w-3.5 text-center text-error" />
                <span className="text-xs text-error">Delete {fileName}?</span>
              </div>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  className="flex-1 rounded-[var(--radius-sm)] bg-error px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-error/80"
                  onClick={confirmDelete}
                  autoFocus
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-[var(--radius-sm)] bg-subtle px-2 py-1 text-[11px] font-medium text-body transition-colors hover:bg-border"
                  onClick={() => setDeleteConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )
        }

        return (
          <div key={item.action}>
            <button
              type="button"
              className={[
                "flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] border-0 bg-transparent px-2.5 py-1.5 text-left text-xs text-body transition-[background] duration-100 hover:enabled:bg-app disabled:cursor-default disabled:opacity-50",
                item.danger
                  ? "text-error hover:enabled:bg-[color-mix(in_srgb,var(--error)_12%,transparent)]"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="menuitem"
              disabled={disabled}
              onClick={() => handleAction(item.action)}
            >
              <FontAwesomeIcon
                icon={item.icon}
                className={["w-3.5 text-center text-muted", item.danger && "text-error"]
                  .filter(Boolean)
                  .join(" ")}
              />
              <span className="flex-1">{item.label}</span>
            </button>
            {item.dividerAfter && idx < visibleItems.length - 1 && (
              <div className="my-1 mx-2 h-px bg-border" role="separator" />
            )}
          </div>
        )
      })}
    </div>
  )
}
