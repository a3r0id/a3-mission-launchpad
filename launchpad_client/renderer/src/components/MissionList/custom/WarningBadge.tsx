import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
}

export function WarningBadge({ children }: Props) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/8 px-2 py-0.5 text-[11px] font-medium text-heading dark:border-amber-400/25 dark:bg-amber-400/8">
      <span className="shrink-0 font-bold text-amber-700 dark:text-amber-300" aria-hidden>
        !
      </span>
      <span className="min-w-0 leading-snug">{children}</span>
    </span>
  )
}
