import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSort, faSortUp, faSortDown } from '@fortawesome/free-solid-svg-icons'
import type { ManagedModProject } from '../../api/launchpad'
import type { ModProjectTableColumnId } from './modProjectListPreferences'
import {
  MOD_PROJECT_DEFAULT_COLUMN_ORDER,
  MOD_PROJECT_DEFAULT_COLUMN_WIDTHS,
} from './modProjectListPreferences'
import { ModProjectContextMenu } from './ModProjectContextMenu'

export type ModProjectListSortField = ModProjectTableColumnId
export type ModProjectListSortDir = 'asc' | 'desc'

type ContextMenuState = {
  project: ManagedModProject
  position: { x: number; y: number }
} | null

type ModProjectListTableProps = {
  projects: ManagedModProject[]
  favoriteIds: Set<string>
  onToggleFavorite: (projectId: string) => void
  columnWidths: Record<ModProjectTableColumnId, number>
  onResizeColumn: (id: ModProjectTableColumnId, widthPx: number) => void
  sortField: ModProjectListSortField
  sortDir: ModProjectListSortDir
  onSort: (field: ModProjectListSortField) => void
  loading: boolean
  onEdit: (p: ManagedModProject) => void
  onOpenFolder: (p: ManagedModProject) => void
  onScriptEditor: (root: string, title: string) => void
  onAddStarter: (p: ManagedModProject) => void
  onRemove: (p: ManagedModProject) => void
}

const COL_LABEL: Record<ModProjectTableColumnId, string> = {
  name: 'Name',
  description: 'Description',
  folder: 'Folder',
}

function hasFolder(p: ManagedModProject) {
  return Boolean(p.project_path?.trim())
}

export function ModProjectListTable({
  projects,
  favoriteIds,
  onToggleFavorite,
  columnWidths,
  onResizeColumn,
  sortField,
  sortDir,
  onSort,
  loading,
  onEdit,
  onOpenFolder,
  onScriptEditor,
  onAddStarter,
  onRemove,
}: ModProjectListTableProps) {
  const resizeState = useRef<{ id: ModProjectTableColumnId; startX: number; startW: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  function handleRowContextMenu(e: React.MouseEvent, project: ManagedModProject) {
    e.preventDefault()
    setContextMenu({ project, position: { x: e.clientX, y: e.clientY } })
  }

  function handleRowDoubleClick(project: ManagedModProject) {
    onEdit(project)
  }

  const getSortIcon = useCallback(
    (field: ModProjectListSortField) => {
      if (sortField !== field) return faSort
      return sortDir === 'asc' ? faSortUp : faSortDown
    },
    [sortField, sortDir],
  )

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const st = resizeState.current
      if (!st) return
      const dx = e.clientX - st.startX
      onResizeColumn(st.id, st.startW + dx)
    }
    function onUp() {
      resizeState.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [onResizeColumn])

  function startResize(e: React.MouseEvent, id: ModProjectTableColumnId) {
    e.preventDefault()
    e.stopPropagation()
    const w = columnWidths[id] ?? MOD_PROJECT_DEFAULT_COLUMN_WIDTHS[id]
    resizeState.current = { id, startX: e.clientX, startW: w }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function renderCell(col: ModProjectTableColumnId, project: ManagedModProject) {
    const w = columnWidths[col] ?? MOD_PROJECT_DEFAULT_COLUMN_WIDTHS[col]
    switch (col) {
      case 'name':
        return (
          <td className="mission-table-name" style={{ width: w }}>
            <span className="mission-table-name-text" title={(project.name ?? '').trim() || undefined}>
              {(project.name ?? '').trim() || '—'}
            </span>
          </td>
        )
      case 'description':
        return (
          <td style={{ width: w }} title={(project.description ?? '').trim() || undefined}>
            <span className="mission-table-name-text mission-table-cell-ellipsis">
              {(project.description ?? '').trim() || '—'}
            </span>
          </td>
        )
      case 'folder':
        return (
          <td style={{ width: w }}>
            {hasFolder(project) ? (
              <span className="mission-table-badge mission-table-badge-ok">Ready</span>
            ) : (
              <span className="mission-table-badge mission-table-badge-warn">Not set</span>
            )}
          </td>
        )
    }
  }

  return (
    <>
      <div className="mission-table-wrap">
        <table className="mission-table mission-table-layout">
          <colgroup>
            {MOD_PROJECT_DEFAULT_COLUMN_ORDER.map((id) => (
              <col key={id} style={{ width: columnWidths[id] ?? MOD_PROJECT_DEFAULT_COLUMN_WIDTHS[id] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {MOD_PROJECT_DEFAULT_COLUMN_ORDER.map((id) => (
                <th
                  key={id}
                  scope="col"
                  className="mission-table-th-resizable"
                  style={{ width: columnWidths[id] ?? MOD_PROJECT_DEFAULT_COLUMN_WIDTHS[id] }}
                >
                  <button type="button" className="mission-table-sort" onClick={() => onSort(id)}>
                    {COL_LABEL[id]}{' '}
                    <FontAwesomeIcon icon={getSortIcon(id)} className="mission-table-sort-icon" />
                  </button>
                  <button
                    type="button"
                    className="mission-table-resize-handle"
                    aria-label={`Resize ${COL_LABEL[id]} column`}
                    onMouseDown={(e) => startResize(e, id)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr
                key={project.id}
                className={`mission-table-row ${favoriteIds.has(project.id) ? 'mission-table-row-pinned' : ''}`}
                onContextMenu={(e) => handleRowContextMenu(e, project)}
                onDoubleClick={() => handleRowDoubleClick(project)}
              >
                {MOD_PROJECT_DEFAULT_COLUMN_ORDER.map((col) => (
                  <Fragment key={col}>{renderCell(col, project)}</Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <ModProjectContextMenu
          project={contextMenu.project}
          position={contextMenu.position}
          isPinned={favoriteIds.has(contextMenu.project.id)}
          loading={loading}
          onClose={() => setContextMenu(null)}
          onToggleFavorite={() => onToggleFavorite(contextMenu.project.id)}
          onEdit={() => onEdit(contextMenu.project)}
          onOpenFolder={() => onOpenFolder(contextMenu.project)}
          onScriptEditor={() => {
            const root = contextMenu.project.project_path?.trim()
            if (root) onScriptEditor(root, (contextMenu.project.name ?? '').trim() || 'Mod project')
          }}
          onAddStarter={() => onAddStarter(contextMenu.project)}
          onRemove={() => onRemove(contextMenu.project)}
        />
      )}
    </>
  )
}
