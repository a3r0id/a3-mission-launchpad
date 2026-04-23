import { useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEdit, faTrash, faFolderOpen, faWrench, faStar } from '@fortawesome/free-solid-svg-icons'
import type { ManagedModProject } from '../../api/launchpad'
import Util from '../../Util'
import { VSCodeIcon } from '../CustomIcons/VSCodeIcon'
import './MissionContextMenu.less'

type ModProjectContextMenuProps = {
  project: ManagedModProject
  position: { x: number; y: number }
  isPinned: boolean
  loading: boolean
  onClose: () => void
  onToggleFavorite: () => void
  onEdit: () => void
  onOpenFolder: () => void
  onScriptEditor: () => void
  onAddStarter: () => void
  onRemove: () => void
}

export function ModProjectContextMenu({
  project,
  position,
  isPinned,
  loading,
  onClose,
  onToggleFavorite,
  onEdit,
  onOpenFolder,
  onScriptEditor,
  onAddStarter,
  onRemove,
}: ModProjectContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const title = (project.name ?? '').trim() || 'Mod project'

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  useEffect(() => {
    if (!menuRef.current) return
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    let x = position.x
    let y = position.y

    if (x + rect.width > viewportW - 8) {
      x = viewportW - rect.width - 8
    }
    if (y + rect.height > viewportH - 8) {
      y = viewportH - rect.height - 8
    }
    if (x < 8) x = 8
    if (y < 8) y = 8

    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
  }, [position])

  const hasProjectPath = Boolean(project.project_path?.trim())

  return (
    <div className="mission-context-menu-backdrop">
      <div
        ref={menuRef}
        className="mission-context-menu"
        role="menu"
        style={{ left: position.x, top: position.y }}
      >
        <div className="mission-context-menu-header">{title}</div>

        <button
          type="button"
          className="mission-context-menu-item"
          role="menuitem"
          disabled={loading}
          onClick={() => {
            onEdit()
            onClose()
          }}
        >
          <FontAwesomeIcon icon={faEdit} className="mission-context-menu-icon" />
          Edit
        </button>

        <button
          type="button"
          className={`mission-context-menu-item ${isPinned ? 'mission-context-menu-item-active' : ''}`}
          role="menuitem"
          onClick={() => {
            onToggleFavorite()
            onClose()
          }}
        >
          <FontAwesomeIcon icon={faStar} className="mission-context-menu-icon" />
          {isPinned ? 'Unpin from top' : 'Pin to top'}
        </button>

        <div className="mission-context-menu-sep" role="separator" />

        <button
          type="button"
          className="mission-context-menu-item"
          role="menuitem"
          disabled={!hasProjectPath}
          onClick={() => {
            onScriptEditor()
            onClose()
          }}
        >
          Open in Script Editor
        </button>

        <button
          type="button"
          className="mission-context-menu-item"
          role="menuitem"
          disabled={!hasProjectPath || loading}
          onClick={() => {
            void Util.runCommand(`code ${JSON.stringify(project.project_path ?? '')}`)
            onClose()
          }}
        >
          <span className="mission-context-menu-icon mission-context-menu-icon-custom">
            <VSCodeIcon />
          </span>
          Open in VS Code
        </button>

        <button
          type="button"
          className="mission-context-menu-item"
          role="menuitem"
          disabled={!hasProjectPath || loading}
          onClick={() => {
            onOpenFolder()
            onClose()
          }}
        >
          <FontAwesomeIcon icon={faFolderOpen} className="mission-context-menu-icon" />
          Show in folder
        </button>

        <button
          type="button"
          className="mission-context-menu-item"
          role="menuitem"
          disabled={!hasProjectPath || loading}
          onClick={() => {
            onAddStarter()
            onClose()
          }}
        >
          <FontAwesomeIcon icon={faWrench} className="mission-context-menu-icon" />
          Add starter build files
        </button>

        <div className="mission-context-menu-sep" role="separator" />

        <button
          type="button"
          className="mission-context-menu-item mission-context-menu-item-danger"
          role="menuitem"
          disabled={loading}
          onClick={() => {
            onRemove()
            onClose()
          }}
        >
          <FontAwesomeIcon icon={faTrash} className="mission-context-menu-icon" />
          Remove
        </button>
      </div>
    </div>
  )
}
