import { useEffect, useRef, useState, useCallback } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faEdit,
  faTrash,
  faFolderOpen,
  faWrench,
  faStar,
  faChevronRight,
  faCode,
} from '@fortawesome/free-solid-svg-icons'
import type { ManagedModProject } from '../../api/launchpad'
import Util from '../../utils'
import { VSCodeIcon } from '../CustomIcons/VSCodeIcon'

const contextMenuBackdrop = 'fixed inset-0 z-[100]'

const contextMenuPanel =
  'fixed z-[101] min-w-[200px] max-w-[280px] overflow-hidden rounded-md border border-border-strong bg-surface p-0 shadow-[0_8px_24px_rgba(0,0,0,0.25)] animate-[mission-context-menu-in_0.12s_ease_both]'

const contextMenuHeader =
  'border-b border-border px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase leading-none tracking-wide text-muted truncate'

const contextMenuItemBase =
  'm-0 flex w-full items-center border-0 px-3 py-2 text-left text-[13px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-[0.45]'

const contextMenuItem =
  `${contextMenuItemBase} bg-transparent text-foreground hover:bg-subtle`

const contextMenuItemFocused =
  `${contextMenuItemBase} bg-subtle text-foreground`

const contextMenuItemActive =
  `${contextMenuItemBase} bg-transparent text-amber-500 hover:bg-subtle`

const contextMenuItemActiveFocused =
  `${contextMenuItemBase} bg-subtle text-amber-500`

const contextMenuItemDanger =
  `${contextMenuItemBase} bg-transparent text-danger hover:bg-[var(--danger-soft)]`

const contextMenuItemDangerFocused =
  `${contextMenuItemBase} bg-[var(--danger-soft)] text-danger`

const contextMenuIcon = 'mr-2.5 w-3.5 shrink-0 text-center text-muted'
const contextMenuIconInActive = 'mr-2.5 w-3.5 shrink-0 text-center text-amber-500'
const contextMenuIconInDanger = 'mr-2.5 w-3.5 shrink-0 text-center text-danger'
const contextMenuIconCustom =
  'mr-2.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted'
const contextMenuSep = 'my-0 mx-0 h-px bg-border'
const contextMenuChevron = 'ml-auto pl-2 text-muted text-[10px]'

const submenuPanel =
  'fixed z-[102] min-w-[180px] overflow-hidden rounded-md border border-border-strong bg-surface p-0 shadow-[0_8px_24px_rgba(0,0,0,0.25)] animate-[mission-context-menu-in_0.08s_ease_both]'

const deleteConfirmContainer =
  'flex items-center gap-2 animate-[mission-context-menu-in_0.1s_ease_both]'

const deleteConfirmBtn =
  'px-2 py-0.5 text-[11px] font-medium rounded transition-colors'

const deleteConfirmYes =
  `${deleteConfirmBtn} bg-danger text-white hover:bg-danger/80`

const deleteConfirmNo =
  `${deleteConfirmBtn} bg-subtle text-foreground hover:bg-border`

type MenuItemDef = {
  id: string
  type: 'item' | 'submenu' | 'separator'
  label?: string
  icon?: React.ReactNode
  disabled?: boolean
  danger?: boolean
  active?: boolean
  onClick?: () => void
  submenuItems?: Omit<MenuItemDef, 'submenuItems' | 'type'>[]
}

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
  const submenuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const [submenuFocusedIndex, setSubmenuFocusedIndex] = useState(0)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const submenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const title = (project.name ?? '').trim() || 'Mod project'
  const hasProjectPath = Boolean(project.project_path?.trim())

  const menuItems: MenuItemDef[] = [
    {
      id: 'edit',
      type: 'item',
      label: 'Edit',
      icon: <FontAwesomeIcon icon={faEdit} className={contextMenuIcon} />,
      disabled: loading,
      onClick: () => { onEdit(); onClose() },
    },
    {
      id: 'pin',
      type: 'item',
      label: isPinned ? 'Unpin from top' : 'Pin to top',
      icon: <FontAwesomeIcon icon={faStar} className={isPinned ? contextMenuIconInActive : contextMenuIcon} />,
      active: isPinned,
      onClick: () => { onToggleFavorite(); onClose() },
    },
    { id: 'sep1', type: 'separator' },
    {
      id: 'open-in',
      type: 'submenu',
      label: 'Open in...',
      icon: <FontAwesomeIcon icon={faFolderOpen} className={contextMenuIcon} />,
      disabled: !hasProjectPath,
      submenuItems: [
        {
          id: 'script-editor',
          label: 'Script Editor',
          icon: <FontAwesomeIcon icon={faCode} className={contextMenuIcon} />,
          onClick: () => { onScriptEditor(); onClose() },
        },
        {
          id: 'vscode',
          label: 'VS Code',
          icon: <span className={contextMenuIconCustom}><VSCodeIcon /></span>,
          disabled: loading,
          onClick: () => {
            void Util.runCommand(`code ${JSON.stringify(project.project_path ?? '')}`)
            onClose()
          },
        },
        {
          id: 'cursor',
          label: 'Cursor',
          icon: <FontAwesomeIcon icon={faCode} className={contextMenuIcon} />,
          disabled: loading,
          onClick: () => {
            void Util.runCommand(`cursor ${JSON.stringify(project.project_path ?? '')}`)
            onClose()
          },
        },
        {
          id: 'explorer',
          label: 'File Explorer',
          icon: <FontAwesomeIcon icon={faFolderOpen} className={contextMenuIcon} />,
          onClick: () => { onOpenFolder(); onClose() },
        },
      ],
    },
    {
      id: 'starter',
      type: 'item',
      label: 'Add starter build files',
      icon: <FontAwesomeIcon icon={faWrench} className={contextMenuIcon} />,
      disabled: !hasProjectPath || loading,
      onClick: () => { onAddStarter(); onClose() },
    },
    { id: 'sep2', type: 'separator' },
    {
      id: 'remove',
      type: 'item',
      label: 'Remove',
      icon: <FontAwesomeIcon icon={faTrash} className={contextMenuIconInDanger} />,
      disabled: loading,
      danger: true,
      onClick: () => setDeleteConfirming(true),
    },
  ]

  const navigableItems = menuItems.filter(item => item.type !== 'separator')

  const clearSubmenuTimeout = useCallback(() => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current)
      submenuTimeoutRef.current = null
    }
  }, [])

  const handleSubmenuEnter = useCallback((itemId: string) => {
    clearSubmenuTimeout()
    setOpenSubmenu(itemId)
    setSubmenuFocusedIndex(0)
  }, [clearSubmenuTimeout])

  const handleSubmenuLeave = useCallback((e: React.MouseEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null
    if (relatedTarget && menuRef.current?.contains(relatedTarget)) {
      return
    }
    clearSubmenuTimeout()
    submenuTimeoutRef.current = setTimeout(() => {
      setOpenSubmenu(null)
    }, 100)
  }, [clearSubmenuTimeout])

  useEffect(() => {
    return () => clearSubmenuTimeout()
  }, [clearSubmenuTimeout])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      const inMenu = menuRef.current?.contains(target)
      const inSubmenu = submenuRef.current?.contains(target)
      if (!inMenu && !inSubmenu) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (deleteConfirming) {
          setDeleteConfirming(false)
        } else if (openSubmenu) {
          setOpenSubmenu(null)
        } else {
          onClose()
        }
        return
      }

      if (openSubmenu) {
        const submenuItem = menuItems.find(item => item.id === openSubmenu)
        const submenuItems = submenuItem?.submenuItems ?? []
        const enabledSubmenuItems = submenuItems.filter(item => !item.disabled)

        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSubmenuFocusedIndex(prev => (prev + 1) % enabledSubmenuItems.length)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSubmenuFocusedIndex(prev => (prev - 1 + enabledSubmenuItems.length) % enabledSubmenuItems.length)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setOpenSubmenu(null)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const item = enabledSubmenuItems[submenuFocusedIndex]
          if (item?.onClick) item.onClick()
        }
        return
      }

      const enabledItems = navigableItems.filter(item => !item.disabled)
      const currentItem = enabledItems[focusedIndex]

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex(prev => (prev + 1) % enabledItems.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex(prev => (prev - 1 + enabledItems.length) % enabledItems.length)
      } else if (e.key === 'ArrowRight' && currentItem?.type === 'submenu') {
        e.preventDefault()
        setOpenSubmenu(currentItem.id)
        setSubmenuFocusedIndex(0)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (deleteConfirming) {
          return
        }
        if (currentItem?.type === 'submenu') {
          setOpenSubmenu(currentItem.id)
          setSubmenuFocusedIndex(0)
        } else if (currentItem?.onClick) {
          currentItem.onClick()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, focusedIndex, openSubmenu, submenuFocusedIndex, deleteConfirming, navigableItems, menuItems])

  useEffect(() => {
    itemRefs.current[0]?.focus()
  }, [])

  useEffect(() => {
    if (!menuRef.current) return
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    let x = position.x
    let y = position.y

    if (x + rect.width > viewportW - 8) x = viewportW - rect.width - 8
    if (y + rect.height > viewportH - 8) y = viewportH - rect.height - 8
    if (x < 8) x = 8
    if (y < 8) y = 8

    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
  }, [position])

  const getItemClass = (item: MenuItemDef, isFocused: boolean) => {
    if (item.danger) {
      return isFocused ? contextMenuItemDangerFocused : contextMenuItemDanger
    }
    if (item.active) {
      return isFocused ? contextMenuItemActiveFocused : contextMenuItemActive
    }
    return isFocused ? contextMenuItemFocused : contextMenuItem
  }

  const renderSubmenu = (parentItem: MenuItemDef, parentIndex: number) => {
    if (!parentItem.submenuItems || openSubmenu !== parentItem.id) return null

    const parentButton = itemRefs.current[parentIndex]
    if (!parentButton) return null

    const buttonRect = parentButton.getBoundingClientRect()
    const menuRect = menuRef.current?.getBoundingClientRect()
    if (!menuRect) return null

    const submenuWidth = 180
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    let left = menuRect.right - 4
    let top = buttonRect.top - 6

    if (left + submenuWidth > viewportW - 8) {
      left = menuRect.left - submenuWidth + 4
    }

    const estimatedHeight = (parentItem.submenuItems.length * 30) + 8
    if (top + estimatedHeight > viewportH - 8) {
      top = viewportH - estimatedHeight - 8
    }
    if (top < 8) top = 8

    const enabledItems = parentItem.submenuItems.filter(item => !item.disabled)

    return (
      <div
        ref={submenuRef}
        className={submenuPanel}
        style={{ left, top }}
        onMouseEnter={clearSubmenuTimeout}
        onMouseLeave={handleSubmenuLeave}
      >
        {parentItem.submenuItems.map((subItem, idx) => {
          const enabledIndex = enabledItems.findIndex(i => i.id === subItem.id)
          const isFocused = enabledIndex === submenuFocusedIndex && !subItem.disabled
          const isFirst = idx === 0
          const isLast = idx === parentItem.submenuItems!.length - 1
          const roundingClass = isFirst && isLast
            ? 'rounded-md'
            : isFirst
              ? 'rounded-t-md'
              : isLast
                ? 'rounded-b-md'
                : ''
          const baseClass = isFocused ? contextMenuItemFocused : contextMenuItem
          return (
            <button
              key={subItem.id}
              type="button"
              className={`${baseClass} ${roundingClass}`}
              role="menuitem"
              disabled={subItem.disabled}
              onClick={subItem.onClick}
              onMouseEnter={() => {
                if (!subItem.disabled && enabledIndex !== -1) {
                  setSubmenuFocusedIndex(enabledIndex)
                }
              }}
            >
              {subItem.icon}
              {subItem.label}
            </button>
          )
        })}
      </div>
    )
  }

  let itemIndex = 0

  const openSubmenuItem = menuItems.find(item => item.type === 'submenu' && item.id === openSubmenu)
  const openSubmenuIndex = menuItems.filter(i => i.type !== 'separator').findIndex(item => item.id === openSubmenu)

  return (
    <div className={contextMenuBackdrop}>
      <div
        ref={menuRef}
        className={contextMenuPanel}
        role="menu"
        style={{ left: position.x, top: position.y }}
      >
        <div className={contextMenuHeader}>{title}</div>

        {menuItems.map((item) => {
          if (item.type === 'separator') {
            return <div key={item.id} className={contextMenuSep} role="separator" />
          }

          const currentIndex = itemIndex
          const enabledItems = navigableItems.filter(i => !i.disabled)
          const enabledIndex = enabledItems.findIndex(i => i.id === item.id)
          const isFocused = enabledIndex === focusedIndex && !item.disabled
          itemIndex++

          if (item.id === 'remove' && deleteConfirming) {
            return (
              <div key={item.id} className="px-3 py-2">
                <div className={deleteConfirmContainer}>
                  <FontAwesomeIcon icon={faTrash} className={contextMenuIconInDanger} />
                  <span className="text-[13px] text-danger">Remove?</span>
                  <div className="ml-auto flex gap-1.5">
                    <button
                      type="button"
                      className={deleteConfirmYes}
                      onClick={() => {
                        onRemove()
                        onClose()
                      }}
                      autoFocus
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className={deleteConfirmNo}
                      onClick={() => setDeleteConfirming(false)}
                    >
                      No
                    </button>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <button
              key={item.id}
              ref={el => { itemRefs.current[currentIndex] = el }}
              type="button"
              className={getItemClass(item, isFocused)}
              role="menuitem"
              disabled={item.disabled}
              tabIndex={isFocused ? 0 : -1}
              onMouseEnter={() => {
                if (item.type === 'submenu' && !item.disabled) {
                  handleSubmenuEnter(item.id)
                } else {
                  setOpenSubmenu(null)
                }
                if (!item.disabled && enabledIndex !== -1) {
                  setFocusedIndex(enabledIndex)
                }
              }}
              onClick={() => {
                if (item.type === 'submenu') {
                  setOpenSubmenu(openSubmenu === item.id ? null : item.id)
                } else {
                  item.onClick?.()
                }
              }}
            >
              {item.icon}
              {item.label}
              {item.type === 'submenu' && (
                <FontAwesomeIcon icon={faChevronRight} className={contextMenuChevron} />
              )}
            </button>
          )
        })}
      </div>

      {openSubmenuItem && renderSubmenu(openSubmenuItem, openSubmenuIndex)}
    </div>
  )
}
