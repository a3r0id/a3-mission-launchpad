import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSort, faSortUp, faSortDown } from '@fortawesome/free-solid-svg-icons'
import type { ManagedScenario } from '../../api/launchpad'
import { hasSymlinkPaths, fullMissionName } from './missionUtils'
import type { MissionTableColumnId } from './missionListPreferences'
import { DEFAULT_COLUMN_ORDER, DEFAULT_COLUMN_WIDTHS } from './missionListPreferences'
import { MissionContextMenu } from './MissionContextMenu'

export type MissionListSortField = MissionTableColumnId
export type MissionListSortDir = 'asc' | 'desc'

type ContextMenuState = {
  mission: ManagedScenario
  position: { x: number; y: number }
} | null

type MissionListTableProps = {
  scenarios: ManagedScenario[]
  scenarioGameTypes: Record<string, string>
  favoriteIds: Set<string>
  onToggleFavorite: (missionId: string) => void
  columnWidths: Record<MissionTableColumnId, number>
  onResizeColumn: (id: MissionTableColumnId, widthPx: number) => void
  sortField: MissionListSortField
  sortDir: MissionListSortDir
  onSort: (field: MissionListSortField) => void
  loading: boolean
  onRunMission: (s: ManagedScenario) => void
  onEdit: (s: ManagedScenario) => void
  onDelete: (s: ManagedScenario) => void
  onMods: (s: ManagedScenario) => void
  onPbo: (s: ManagedScenario) => void
  onGithub: (s: ManagedScenario) => void
  onScriptEditor: (root: string, title: string) => void
}

const COL_LABEL: Record<MissionTableColumnId, string> = {
  name: 'Name',
  author: 'Author',
  map: 'Map',
  type: 'Type',
  gameType: 'Game',
  status: 'Status',
}

const tdBase =
  'px-3 py-2.5 text-left align-middle text-[13px] text-foreground'

const thClass =
  'relative sticky top-0 z-10 border-b border-border bg-surface px-3 py-2.5 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted'

const trBase =
  'cursor-context-menu border-b border-border transition-[background-color] duration-100 last:border-b-0 hover:bg-subtle'

const trPinned =
  'bg-accent/6 hover:bg-accent/10 dark:bg-accent/10 dark:hover:bg-accent/16'

const sortBtnClass =
  'group inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[11px] font-semibold uppercase tracking-wide text-muted transition-[color] duration-100 hover:text-heading'

const resizeHandleClass =
  'absolute bottom-0 right-0 top-0 z-20 m-0 w-1.5 cursor-col-resize border-0 bg-transparent p-0 hover:bg-accent/25'

const nameTitleClass = `font-semibold text-heading ${tdBase}`

const nameTextClass = 'inline-block max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap'

const pillClass =
  'inline-block rounded-full border border-border bg-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted'

const pillAccentClass =
  'inline-block rounded-full border border-accent/8 bg-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent dark:border-accent/12'

const badgeOk =
  'inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-success/15 text-success'

const badgeWarn =
  'inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-800 dark:text-amber-400'

export function MissionListTable({
  scenarios,
  scenarioGameTypes,
  favoriteIds,
  onToggleFavorite,
  columnWidths,
  onResizeColumn,
  sortField,
  sortDir,
  onSort,
  loading,
  onRunMission,
  onEdit,
  onDelete,
  onMods,
  onPbo,
  onGithub,
  onScriptEditor,
}: MissionListTableProps) {
  const resizeState = useRef<{ id: MissionTableColumnId; startX: number; startW: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  function handleRowContextMenu(e: React.MouseEvent, scenario: ManagedScenario) {
    e.preventDefault()
    setContextMenu({ mission: scenario, position: { x: e.clientX, y: e.clientY } })
  }

  function handleRowDoubleClick(scenario: ManagedScenario) {
    onEdit(scenario)
  }

  const getSortIcon = useCallback(
    (field: MissionListSortField) => {
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

  function startResize(e: React.MouseEvent, id: MissionTableColumnId) {
    e.preventDefault()
    e.stopPropagation()
    const w = columnWidths[id] ?? DEFAULT_COLUMN_WIDTHS[id]
    resizeState.current = { id, startX: e.clientX, startW: w }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function renderCell(col: MissionTableColumnId, scenario: ManagedScenario) {
    const w = columnWidths[col] ?? DEFAULT_COLUMN_WIDTHS[col]
    switch (col) {
      case 'name':
        return (
          <td className={nameTitleClass} style={{ width: w }}>
            <span className={nameTextClass}>{scenario.name || '—'}</span>
          </td>
        )
      case 'author':
        return (
          <td className={tdBase} style={{ width: w }}>
            {scenario.author || '—'}
          </td>
        )
      case 'map':
        return (
          <td className={tdBase} style={{ width: w }}>
            {scenario.map_suffix || '—'}
          </td>
        )
      case 'type':
        return (
          <td className={tdBase} style={{ width: w }}>
            <span className={pillClass}>{scenario.mission_type?.toUpperCase() || '—'}</span>
          </td>
        )
      case 'gameType':
        return (
          <td className={tdBase} style={{ width: w }}>
            <span className={pillAccentClass}>
              {(scenarioGameTypes[scenario.id] ?? '').toUpperCase() || '—'}
            </span>
          </td>
        )
      case 'status':
        return (
          <td className={tdBase} style={{ width: w }}>
            <div className="flex flex-wrap gap-1.5">
              {hasSymlinkPaths(scenario) ? (
                <span className={badgeOk}>Ready</span>
              ) : (
                <span className={badgeWarn}>No symlink</span>
              )}
              {scenario.github_integration && <span className={badgeOk}>Git</span>}
            </div>
          </td>
        )
    }
  }

  return (
    <>
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <colgroup>
            {DEFAULT_COLUMN_ORDER.map((id) => (
              <col key={id} style={{ width: columnWidths[id] ?? DEFAULT_COLUMN_WIDTHS[id] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {DEFAULT_COLUMN_ORDER.map((id) => (
                <th
                  key={id}
                  scope="col"
                  className={thClass}
                  style={{ width: columnWidths[id] ?? DEFAULT_COLUMN_WIDTHS[id] }}
                >
                  <button type="button" className={sortBtnClass} onClick={() => onSort(id)}>
                    {COL_LABEL[id]}{' '}
                    <FontAwesomeIcon
                      icon={getSortIcon(id)}
                      className="text-[10px] opacity-60 group-hover:opacity-100"
                    />
                  </button>
                  <button
                    type="button"
                    className={resizeHandleClass}
                    aria-label={`Resize ${COL_LABEL[id]} column`}
                    onMouseDown={(e) => startResize(e, id)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarios.map((scenario) => (
              <tr
                key={scenario.id}
                className={`${trBase} ${favoriteIds.has(scenario.id) ? trPinned : ''}`}
                onContextMenu={(e) => handleRowContextMenu(e, scenario)}
                onDoubleClick={() => handleRowDoubleClick(scenario)}
              >
                {DEFAULT_COLUMN_ORDER.map((col) => (
                  <Fragment key={col}>{renderCell(col, scenario)}</Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <MissionContextMenu
          mission={contextMenu.mission}
          position={contextMenu.position}
          isPinned={favoriteIds.has(contextMenu.mission.id)}
          loading={loading}
          onClose={() => setContextMenu(null)}
          onToggleFavorite={() => onToggleFavorite(contextMenu.mission.id)}
          onRun={() => onRunMission(contextMenu.mission)}
          onEdit={() => onEdit(contextMenu.mission)}
          onDelete={() => onDelete(contextMenu.mission)}
          onMods={() => onMods(contextMenu.mission)}
          onPbo={() => onPbo(contextMenu.mission)}
          onGithub={() => onGithub(contextMenu.mission)}
          onScriptEditor={() => {
            const root = contextMenu.mission.project_path?.trim()
            if (root) onScriptEditor(root, fullMissionName(contextMenu.mission))
          }}
        />
      )}
    </>
  )
}
