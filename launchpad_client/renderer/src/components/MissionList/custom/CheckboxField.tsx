import type { InputHTMLAttributes } from 'react'

const boxClass =
  'mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-border-strong bg-surface text-accent transition-[border-color,box-shadow] focus:ring-2 focus:ring-accent/30 focus:ring-offset-0 focus:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-accent/35'

type Props = {
  id: string
  label: string
  description?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type' | 'className'>

export function CheckboxField({ id, label, description, ...rest }: Props) {
  return (
    <div className="rounded-md border border-border bg-subtle/90 p-3 dark:bg-subtle/60">
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1.5">
        <input id={id} type="checkbox" className={boxClass} {...rest} />
        <label htmlFor={id} className="cursor-pointer pt-0.5 text-sm font-semibold leading-snug text-heading">
          {label}
        </label>
        {description ? (
          <p className="col-start-2 m-0 text-xs leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
    </div>
  )
}
