import type { InputHTMLAttributes, ReactNode } from 'react'

const inputClass =
  'w-full rounded-md border border-border bg-subtle px-3 py-2 text-sm text-foreground transition-[border-color,box-shadow] placeholder:text-muted hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-accent/25'

type Props = {
  id: string
  label: string
  hint?: ReactNode
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'>

export function InputField({ id, label, hint, ...rest }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-heading">
        {label}
      </label>
      <input id={id} className={inputClass} {...rest} />
      {hint ? <div className="text-xs leading-relaxed text-muted">{hint}</div> : null}
    </div>
  )
}
