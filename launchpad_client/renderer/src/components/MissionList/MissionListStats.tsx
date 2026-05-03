type MissionListStatsProps = {
  total: number
  visible: number
  hasFilter: boolean
  /** Defaults to mission / missions */
  itemSingular?: string
  itemPlural?: string
}

export function MissionListStats({
  total,
  visible,
  hasFilter,
  itemSingular = 'mission',
  itemPlural = 'missions',
}: MissionListStatsProps) {
  if (total === 0) return null
  const itemWord = total === 1 ? itemSingular : itemPlural
  if (!hasFilter) {
    return (
      <p
        className="m-0 whitespace-nowrap text-[13px] text-muted"
        aria-live="polite"
      >
        {total} {itemWord}
      </p>
    )
  }
  return (
    <p
      className="m-0 whitespace-nowrap text-[13px] text-muted"
      aria-live="polite"
    >
      Showing {visible} of {total} {itemWord}
    </p>
  )
}
