import { useEffect, useMemo, useState, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchMissionBuild,
  fetchSettings,
  type LaunchpadSettings,
  type MissionBuildResponse,
} from '../api/launchpad'
import {
  AlertBanner,
  BusyBar,
  CheckboxField,
  CodeInline,
  InputField,
  LoadingState,
  ResultPanel,
  SelectField,
  WarningBadge,
} from '../components/MissionList/custom'
import {
  ARMA_MAP_CHOICES,
  ARMA_MAP_CUSTOM_ID,
  armaMapChoiceBySuffix,
  mapSelectIdForSuffix,
} from '../lib/armamaps'

type MissionBuildPageProps = {
  onGoSettings?: () => void
  embedded?: boolean
  onBuilt?: (result: MissionBuildResponse) => void
  footerPortal?: RefObject<HTMLElement | null>
}

type FormState = {
  mission_name: string
  map_suffix: string
  author: string
  network_type: 'Singleplayer' | 'Multiplayer'
  generate_scripting_environment: boolean
  game_type: GameTypeTypes
}

type GameTypeTypes =
  | 'Unknown'
  | 'DM'
  | 'CTF'
  | 'Coop'
  | 'CTI'
  | 'SC'
  | 'TDM'
  | 'RPG'
  | 'Sandbox'
  | 'KOTH'
  | 'LastMan'
  | 'Survive'
  | 'Zeus'
  | 'Support'
  | 'EndGame'
  | 'Apex'
  | 'Escape'
  | 'Patrol'
  | 'Vanguard'
  | 'Warlords'

const GAME_TYPE_OPTIONS: { value: GameTypeTypes; label: string }[] = [
  { value: 'Unknown', label: 'Not set' },
  { value: 'DM', label: 'Deathmatch' },
  { value: 'CTF', label: 'Capture the flag' },
  { value: 'Coop', label: 'Co-op' },
  { value: 'CTI', label: 'Capture the island' },
  { value: 'SC', label: 'Sector control' },
  { value: 'TDM', label: 'Team deathmatch' },
  { value: 'RPG', label: 'Roleplay' },
  { value: 'Sandbox', label: 'Sandbox' },
  { value: 'KOTH', label: 'King of the hill' },
  { value: 'LastMan', label: 'Last man standing' },
  { value: 'Survive', label: 'Survival' },
  { value: 'Zeus', label: 'Zeus' },
  { value: 'Support', label: 'Support' },
  { value: 'EndGame', label: 'End game' },
  { value: 'Apex', label: 'Apex campaign' },
  { value: 'Escape', label: 'Escape' },
  { value: 'Patrol', label: 'Combat patrol' },
  { value: 'Vanguard', label: 'Vanguard' },
  { value: 'Warlords', label: 'Warlords' },
]

const initial: FormState = {
  mission_name: '',
  map_suffix: 'Altis',
  author: '',
  network_type: 'Singleplayer',
  generate_scripting_environment: false,
  game_type: 'Unknown',
}

type SettingsGate =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: LaunchpadSettings }

export function MissionBuildPage({ onGoSettings, embedded = false, onBuilt, footerPortal }: MissionBuildPageProps) {
  const [form, setForm] = useState<FormState>(initial)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MissionBuildResponse | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [settingsGate, setSettingsGate] = useState<SettingsGate>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void fetchSettings()
      .then((data) => {
        if (!cancelled) setSettingsGate({ status: 'ready', data })
      })
      .catch((e) => {
        if (!cancelled) {
          setSettingsGate({
            status: 'error',
            message: e instanceof Error ? e.message : 'Could not load settings',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (settingsGate.status !== 'ready') return
    const fromSettings = settingsGate.data.default_author.trim()
    if (!fromSettings) return
    setForm((f) => (f.author === '' ? { ...f, author: fromSettings } : f))
  }, [settingsGate])

  const profileReady =
    settingsGate.status === 'ready' && settingsGate.data.arma3_profile_path.trim().length > 0

  const missionNameTrim = form.mission_name.trim()
  const mapSuffixTrim = form.map_suffix.trim()
  const missionFullNamePreview = `${missionNameTrim || 'mission_name'}.${mapSuffixTrim || 'map'}`
  const mapSelectId = mapSelectIdForSuffix(form.map_suffix)
  const mapChoice = armaMapChoiceBySuffix(form.map_suffix)
  const canSubmit =
    settingsGate.status === 'ready' && profileReady && !busy

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setClientError(null)
    setResult(null)
    const defaultAuthorTrim = settingsGate.status === 'ready' ? settingsGate.data.default_author.trim() : ''
    const effectiveAuthor = form.author.trim() || defaultAuthorTrim
    if (!form.mission_name.trim() || !form.map_suffix.trim() || !effectiveAuthor) {
      setClientError('Add a mission name and map, and an author (or a default in Settings).')
      return
    }
    if (!profileReady) {
      setClientError('Set your profile folder in Settings first.')
      return
    }
    setBusy(true)
    try {
      const payload = await fetchMissionBuild({
        mission_name: form.mission_name.trim(),
        map_suffix: form.map_suffix.trim(),
        author: effectiveAuthor,
        network_type: form.network_type,
        generate_scripting_environment: form.generate_scripting_environment,
        game_type: form.game_type,
      })
      setResult(payload)
      if (payload.status === 0) {
        onBuilt?.(payload)
      }
    } catch (err) {
      setClientError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const mapOptions = useMemo(
    () => [
      ...ARMA_MAP_CHOICES.map((m) => ({
        value: m.id,
        label: `${m.title} — ${m.scaleLine}${m.needsContent ? ` (needs ${m.needsContent})` : ''}`,
      })),
      { value: ARMA_MAP_CUSTOM_ID, label: 'Other…' },
    ],
    [],
  )

  const gameTypeOptions = useMemo(
    () => GAME_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    [],
  )

  const networkOptions = useMemo(
    () => [
      { value: 'Singleplayer', label: 'Singleplayer' },
      { value: 'Multiplayer', label: 'Multiplayer' },
    ],
    [],
  )

  const mapHint = (
    <span>
      Your mission folder will be <CodeInline>{missionFullNamePreview}</CodeInline>.
      {mapChoice ? <> {mapChoice.about}</> : null}
      {!mapChoice && mapSelectId === ARMA_MAP_CUSTOM_ID ? (
        <> Use the same world name Arma uses after the dot in the folder name.</>
      ) : null}
    </span>
  )

  const actionButtons = (
    <div className={embedded ? 'flex items-center gap-2' : 'form-actions'}>
      <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
        {busy ? 'Building…' : 'Build mission'}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => {
          const fallbackAuthor =
            settingsGate.status === 'ready' ? settingsGate.data.default_author.trim() : ''
          setForm({ ...initial, author: fallbackAuthor })
          setResult(null)
          setClientError(null)
        }}
      >
        Reset
      </button>
    </div>
  )

  const formFields = settingsGate.status === 'ready' ? (
    <>
      {!profileReady && (
        <AlertBanner
          variant="warning"
          title="Profile folder needed"
          action={
            onGoSettings ? (
              <button type="button" className="btn btn-primary" onClick={onGoSettings}>
                Open settings
              </button>
            ) : null
          }
        >
          <p className="m-0">
            In Settings, choose the folder that contains <CodeInline>missions</CodeInline> and{' '}
            <CodeInline>mpmissions</CodeInline>. That location is required before a build can run.
          </p>
        </AlertBanner>
      )}

      <InputField
        id="mission_name"
        name="mission_name"
        label="Mission name"
        autoComplete="off"
        placeholder="my_coop_op"
        value={form.mission_name}
        onChange={(ev) => setForm((f) => ({ ...f, mission_name: ev.target.value }))}
        hint="Folder name only — the map is chosen below."
      />

      <div className="flex flex-col gap-1.5">
        <SelectField
          id="map_preset"
          name="map_preset"
          label="Map"
          value={mapSelectId}
          onChange={(nextId) => {
            if (nextId === ARMA_MAP_CUSTOM_ID) {
              setForm((f) => ({ ...f, map_suffix: '' }))
              return
            }
            const row = ARMA_MAP_CHOICES.find((m) => m.id === nextId)
            if (row) setForm((f) => ({ ...f, map_suffix: row.worldSuffix }))
          }}
          options={mapOptions}
          hint={mapHint}
        />
        {mapSelectId === ARMA_MAP_CUSTOM_ID ? (
          <InputField
            id="map_suffix_custom"
            name="map_suffix"
            autoComplete="off"
            label="Map suffix"
            placeholder="e.g. Takistan"
            value={form.map_suffix}
            onChange={(ev) => setForm((f) => ({ ...f, map_suffix: ev.target.value }))}
          />
        ) : null}
        {mapChoice?.needsContent ? (
          <div className="flex flex-wrap items-center gap-2">
            <WarningBadge>Requires: {mapChoice.needsContent}</WarningBadge>
          </div>
        ) : null}
      </div>

      <InputField
        id="author"
        name="author"
        label="Author"
        autoComplete="name"
        placeholder="Your name"
        value={form.author}
        onChange={(ev) => setForm((f) => ({ ...f, author: ev.target.value }))}
        hint="Shown in the mission list. Fills from Settings if you leave it blank."
      />

      <SelectField
        id="network_type"
        name="network_type"
        label="Mode"
        value={form.network_type}
        onChange={(v) =>
          setForm((f) => ({
            ...f,
            network_type: v as 'Singleplayer' | 'Multiplayer',
          }))
        }
        options={networkOptions}
      />

      <CheckboxField
        id="generate_scripting_environment"
        name="generate_scripting_environment"
        label="Scripting support"
        checked={form.generate_scripting_environment}
        onChange={(ev) => setForm((f) => ({ ...f, generate_scripting_environment: ev.target.checked }))}
        description="Adds event scripts and a small functions library. Turn this on if you expect to add scripts or extend the mission in code."
      />

      <SelectField
        id="game_type"
        name="game_type"
        label="Game type"
        value={form.game_type}
        onChange={(v) => setForm((f) => ({ ...f, game_type: v as GameTypeTypes }))}
        options={gameTypeOptions}
        hint="Optional. Pick the closest style, or leave as not set."
      />

      {clientError && (
        <AlertBanner variant="error" title="Cannot start the build">
          <p className="m-0">{clientError}</p>
        </AlertBanner>
      )}

      {busy ? <BusyBar /> : null}

      {result ? <ResultPanel result={result} compact={embedded} /> : null}

      {!embedded && actionButtons}
    </>
  ) : null

  const footerPortalTarget = footerPortal?.current

  return (
    <div className={embedded ? 'flex min-h-0 flex-col gap-4' : 'page-stack'}>
      {!embedded ? (
        <header className="page-header">
          <h1 className="page-title">New Mission</h1>
          <p className="page-lead">Fill in the details below to create a new mission.</p>
        </header>
      ) : null}

      <form
        className={embedded ? 'flex min-h-0 flex-1 flex-col gap-4' : 'card form-card flex flex-col gap-4'}
        onSubmit={onSubmit}
        id={footerPortalTarget ? 'mission-build-form' : undefined}
        noValidate
      >
        {settingsGate.status === 'loading' && <LoadingState label="Loading settings…" />}

        {settingsGate.status === 'error' && (
          <AlertBanner variant="error" title="Settings unavailable">
            <p className="m-0">We could not load your settings. Please try again.</p>
            {settingsGate.message ? <p className="m-0 text-[12px] text-[var(--text-muted)]">{settingsGate.message}</p> : null}
          </AlertBanner>
        )}

        {formFields}

        {!footerPortalTarget && embedded && settingsGate.status === 'ready' && actionButtons}
      </form>

      {footerPortalTarget && settingsGate.status === 'ready' &&
        createPortal(
          <div className="flex items-center gap-2">
            <button type="submit" form="mission-build-form" className="btn btn-primary" disabled={!canSubmit}>
              {busy ? 'Building…' : 'Build mission'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                const fallbackAuthor =
                  settingsGate.status === 'ready' ? settingsGate.data.default_author.trim() : ''
                setForm({ ...initial, author: fallbackAuthor })
                setResult(null)
                setClientError(null)
              }}
            >
              Reset
            </button>
          </div>,
          footerPortalTarget,
        )}
    </div>
  )
}
