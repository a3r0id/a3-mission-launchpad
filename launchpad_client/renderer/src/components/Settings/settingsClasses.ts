export const settings = {
  page:
    'mission-page relative z-[1] flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface',
  stack:
    'flex w-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-4 text-left',
  tabPanel:
    'scrollbar-subtle min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-smooth pb-14 pt-1 [scrollbar-gutter:stable]',
  pageHeader: 'shrink-0 min-h-0 space-y-1 pb-4',
  pageTitle: 'm-0 text-lg font-semibold text-heading',
  pageLead: 'm-0 text-sm text-muted',

  section: 'flex min-w-0 flex-col gap-4',
  cardTitle: 'm-0 text-base font-semibold text-heading',
  cardBody: 'm-0 text-sm leading-relaxed text-muted',

  field: 'flex flex-col gap-1.5',
  label: 'text-xs font-semibold text-heading',
  input:
    'w-full rounded-md border border-border bg-subtle px-3 py-2 text-sm text-foreground transition-[border-color,box-shadow] placeholder:text-muted hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 dark:focus:ring-accent/25',
  select:
    'w-full cursor-pointer appearance-none rounded-md border border-border bg-subtle py-2 pl-3 pr-9 text-sm text-foreground transition-[border-color,box-shadow] hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 dark:focus:ring-accent/25',
  hint: 'm-0 text-xs leading-relaxed text-muted',

  formActions: 'flex flex-wrap items-center gap-2 pt-1',
  bannerError:
    'm-0 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-heading',
  bannerOk:
    'm-0 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-heading',

  serverRow: 'border-b border-border py-3 last:border-b-0 dark:border-white/10',
  code: ' rounded bg-app px-1 font-mono text-[12px] text-heading ring-1 ring-inset ring-border',
} as const
