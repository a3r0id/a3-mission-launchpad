import { FileFolderInput } from '../FileFolderInput'
import { settings } from './settingsClasses'
import { SettingsCard } from './SettingsCard'

type Props = {
  loading: boolean
  saving: boolean
  dirty: boolean
  hasSaved: boolean
  isWindows: boolean
  hemttDesktop: boolean
  arma3Path: string
  toolsPath: string
  profilePath: string
  appdataPath: string
  defaultAuthor: string
  githubVisibility: 'public' | 'private'
  hemttPath: string
  detectBusy: boolean
  detectMsg: string | null
  hemttInstallBusy: boolean
  hemttInstallMsg: string | null
  onArma3Path: (v: string) => void
  onToolsPath: (v: string) => void
  onProfilePath: (v: string) => void
  onAppdataPath: (v: string) => void
  onDefaultAuthor: (v: string) => void
  onGithubVisibility: (v: 'public' | 'private') => void
  onHemttPath: (v: string) => void
  onDetectArmaPaths: () => void
  onSave: () => void
  onDiscard: () => void
  onReload: () => void
  onInstallHemttWinget: () => void
  onOpenHemttUrl: (url: string) => void
}

export function SettingsArmaPathsSection({
  loading,
  saving,
  dirty,
  hasSaved,
  isWindows,
  hemttDesktop,
  arma3Path,
  toolsPath,
  profilePath,
  appdataPath,
  defaultAuthor,
  githubVisibility,
  hemttPath,
  detectBusy,
  detectMsg,
  hemttInstallBusy,
  hemttInstallMsg,
  onArma3Path,
  onToolsPath,
  onProfilePath,
  onAppdataPath,
  onDefaultAuthor,
  onGithubVisibility,
  onHemttPath,
  onDetectArmaPaths,
  onSave,
  onDiscard,
  onReload,
  onInstallHemttWinget,
  onOpenHemttUrl,
}: Props) {
  return (
    <SettingsCard
      sectionId="paths-heading"
      title="Arma 3 paths"
      lead="Looks for a Steam install, tools next to the game, a likely profile folder, and the usual log location."
    >
      <div className={settings.formActions}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onDetectArmaPaths}
          disabled={detectBusy || loading}
        >
          {detectBusy ? 'Searching…' : 'Find folders'}
        </button>
      </div>
      {detectMsg ? (
        <p className={settings.cardBody} role="status">
          {detectMsg}
        </p>
      ) : null}
      {loading ? <p className={settings.cardBody}>Loading…</p> : null}

      {!loading && (
        <>
          <label className={settings.field}>
            <span className={settings.label}>Arma 3 installation folder</span>
            <FileFolderInput
              type="folder"
              commit="always"
              name="arma3_path"
              autoComplete="off"
              placeholder="e.g. C:\Program Files (x86)\Steam\steamapps\common\Arma 3"
              inputClassName={settings.input}
              value={arma3Path}
              onChange={onArma3Path}
            />
            <p className={settings.hint}>Game root directory (contains arma3.exe).</p>
          </label>

          <label className={settings.field}>
            <span className={settings.label}>Arma 3 Tools folder</span>
            <FileFolderInput
              type="folder"
              commit="always"
              name="arma3_tools_path"
              autoComplete="off"
              placeholder="e.g. C:\Program Files (x86)\Steam\steamapps\common\Arma 3 Tools"
              inputClassName={settings.input}
              value={toolsPath}
              onChange={onToolsPath}
            />
            <p className={settings.hint}>Steam &quot;Arma 3 Tools&quot; app folder, if you use it.</p>
          </label>

          <label className={settings.field}>
            <span className={settings.label}>Arma 3 profile folder</span>
            <FileFolderInput
              type="folder"
              commit="always"
              name="arma3_profile_path"
              autoComplete="off"
              placeholder="e.g. C:\Users\You\Documents\Arma 3 - Other Profiles\YourProfileName"
              inputClassName={settings.input}
              value={profilePath}
              onChange={onProfilePath}
            />
            <p className={settings.hint}>
              Required for new missions: the folder that contains <span className={settings.code}>missions</span> and{' '}
              <span className={settings.code}>mpmissions</span> (where the launcher creates the scenario symlink).
            </p>
          </label>

          <label className={settings.field}>
            <span className={settings.label}>Arma 3 Local AppData folder</span>
            <FileFolderInput
              type="folder"
              commit="always"
              name="arma3_appdata_path"
              autoComplete="off"
              placeholder="%LOCALAPPDATA%\Arma 3"
              inputClassName={settings.input}
              value={appdataPath}
              onChange={onAppdataPath}
            />
            <p className={settings.hint}>
              Typical on Windows: <span className={settings.code}>%LOCALAPPDATA%\Arma 3</span> (logs, BattlEye, cache).
              This is not the same as the Documents &quot;Other Profiles&quot; folder above.
            </p>
          </label>

          <label className={settings.field}>
            <span className={settings.label}>Default author</span>
            <input
              className={settings.input}
              name="default_author"
              type="text"
              autoComplete="name"
              spellCheck={false}
              placeholder="Your name or team"
              value={defaultAuthor}
              onChange={(e) => onDefaultAuthor(e.target.value)}
            />
            <p className={settings.hint}>
              Prefills Author on new missions. If you leave Author empty in the form, this value is still used for the
              build.
            </p>
          </label>

          <label className={settings.field}>
            <span className={settings.label}>Default GitHub repository visibility</span>
            <div className="relative">
              <select
                className={settings.select}
                name="github_new_repo_visibility"
                value={githubVisibility}
                onChange={(e) => onGithubVisibility(e.target.value === 'public' ? 'public' : 'private')}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
              <span
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted"
                aria-hidden
              >
                ▼
              </span>
            </div>
            <p className={settings.hint}>
              Used when you publish a mission from Managed Missions → GitHub. You can still override in that dialog.
            </p>
          </label>

          <div className={settings.field}>
            <span className={settings.label}>HEMTT program (optional)</span>
            <p className="mb-2 text-xs leading-relaxed text-muted">
              Used when you build or check mod projects.{' '}
              <a
                className="text-accent underline-offset-2 hover:underline"
                href="https://hemtt.dev/#what-is-hemtt"
                target="_blank"
                rel="noopener noreferrer"
              >
                What is HEMTT?
              </a>
            </p>
            <div className={`${settings.formActions} mb-2`}>
              {hemttDesktop && isWindows ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onInstallHemttWinget}
                  disabled={hemttInstallBusy}
                >
                  {hemttInstallBusy ? 'Installing…' : 'Install with winget'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onOpenHemttUrl('https://hemtt.dev/installation/')}
              >
                Installation steps
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onOpenHemttUrl('https://github.com/BrettMayson/HEMTT/releases/latest')}
              >
                Downloads
              </button>
            </div>
            {hemttInstallMsg ? (
              <p className="mb-3 text-sm text-heading" role="status">
                {hemttInstallMsg}
              </p>
            ) : null}
            <FileFolderInput
              type="file"
              commit="always"
              name="hemtt_path"
              autoComplete="off"
              placeholder="Leave empty if the installer set up HEMTT for you"
              inputClassName={settings.input}
              value={hemttPath}
              onChange={onHemttPath}
            />
            <p className={settings.hint}>
              Leave empty unless the app cannot find HEMTT. Then choose the HEMTT program (for example hemtt.exe on
              Windows).
            </p>
          </div>

          <div className={`${settings.formActions} border-t border-border pt-4 dark:border-white/10`}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSave}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onDiscard} disabled={saving || !dirty || !hasSaved}>
              Discard changes
            </button>
            <button type="button" className="btn btn-ghost" onClick={onReload} disabled={saving || loading}>
              Reload from disk
            </button>
          </div>
        </>
      )}
    </SettingsCard>
  )
}
