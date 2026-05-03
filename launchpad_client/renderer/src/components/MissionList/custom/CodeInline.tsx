import type { ReactNode } from 'react'

type Props = { children: ReactNode }

export function CodeInline({ children }: Props) {
  return (
    <code className="rounded bg-app px-1.5 py-0.5 font-mono text-[12px] text-heading ring-1 ring-inset ring-border">
      {children}
    </code>
  )
}
