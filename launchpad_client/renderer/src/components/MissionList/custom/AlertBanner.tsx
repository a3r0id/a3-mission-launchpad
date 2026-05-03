import type { ReactNode } from 'react'

type Variant = 'error' | 'warning' | 'info'

const styles: Record<Variant, string> = {
  error: 'border border-danger/25 bg-danger/10 text-heading',
  warning:
    'border border-amber-500/25 bg-amber-500/8 text-heading dark:border-amber-400/20 dark:bg-amber-400/8',
  info: 'border border-border bg-subtle text-heading',
}

type Props = {
  variant: Variant
  title?: string
  children: ReactNode
  action?: ReactNode
  role?: 'alert' | 'status'
}

export function AlertBanner({ variant, title, children, action, role = 'alert' }: Props) {
  return (
    <div
      role={role}
      className={`flex flex-col gap-2 rounded-md border px-3 py-2.5 text-sm leading-snug ${styles[variant]}`}
    >
      {title ? <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p> : null}
      <div className="m-0 min-w-0 flex-1 text-[13px] leading-relaxed [&_button]:ml-0 [&_button]:align-middle">{children}</div>
      {action ? <div className="shrink-0 pt-0.5 [&_.btn]:w-full sm:[&_.btn]:w-auto">{action}</div> : null}
    </div>
  )
}
