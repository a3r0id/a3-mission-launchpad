import type { ReactNode } from 'react'

type Props = {
  label?: string
  children?: ReactNode
}

export function LoadingState({ label = 'Loading…', children }: Props) {
  return (
    <div className="flex flex-col gap-3 py-1" role="status" aria-live="polite">
      {children ? (
        children
      ) : (
        <>
          <div className="h-2.5 w-28 animate-pulse rounded-md bg-border" />
          <div className="h-2.5 w-40 max-w-full animate-pulse rounded-md bg-border" />
        </>
      )}
      <p className="m-0 text-sm text-muted">{label}</p>
    </div>
  )
}

export function BusyBar() {
  return (
    <div className="h-0.5 w-full overflow-hidden rounded-full bg-border" aria-hidden>
      <div className="h-full w-[35%] max-w-md rounded-full bg-accent motion-reduce:animate-none motion-safe:animate-pulse" />
    </div>
  )
}
