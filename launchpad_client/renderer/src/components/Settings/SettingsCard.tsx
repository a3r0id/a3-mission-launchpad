import type { ReactNode } from 'react'
import { settings } from './settingsClasses'

type Props = {
  sectionId: string
  title: string
  lead?: string
  children: ReactNode
}

export function SettingsCard({ sectionId, title, lead, children }: Props) {
  return (
    <section className={settings.section} aria-labelledby={sectionId}>
      <h2 id={sectionId} className={settings.cardTitle}>
        {title}
      </h2>
      {lead ? <p className={`${settings.cardBody} mt-0.5`}>{lead}</p> : null}
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}
