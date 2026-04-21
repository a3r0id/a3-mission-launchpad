# Contributing

Thank you for helping with **A3 Launchpad**. The desktop product is an **Electron** app: the UI runs in a Chromium renderer, and privileged work (filesystem, processes, Arma launch, HEMTT, and the companion native extension) runs in the **main process** behind **IPC**.

For install and packaging steps, see [Installation](INSTALLATION.md). For where features moved during the IPC migration, see [refactor.md](../refactor.md) in the repo root.

## Repository layout

| Area | Role |
|------|------|
| `launchpad_client/renderer` | React UI, pages, components, `api/launchpad.ts` (IPC-first helpers). |
| `launchpad_client/app` | Electron main/preload, `Launchpad.ts`, IPC registration and handlers under `src/ipc/`. |
| `launchpad_mod` | Companion Arma mod (SQF, HEMTT). Native **RV extension** sources under `launchpad_mod/extension` (CMake). |
| `A3LaunchPad` | Staged deliverables layout used by packaging and local dev: `mod/addons`, extension binary next to `mod/`. |
| `a3hook` | Experimental / related native hooking code (separate from the RV extension); build only if you are working in that area. |

The former **Python HTTP server** has been removed from this tree; desktop behavior is implemented in TypeScript IPC handlers, not remote HTTP.

## Architecture expectations

- **IPC-first**: For anything that touches the OS or game (paths, spawn, file I/O, SSH tails, debug socket, PBO/HEMTT), add or change logic in `launchpad_client/app/src/ipc/handlers` and expose it through `IPCAPI.ts`.
- **Renderer**: Prefer `getElectronIpc()` + `ipc.invoke('<channel>', …)` (see `electronIpc.ts` and `api/launchpad.ts`). Keep any HTTP or non-Electron fallback only where the codebase already does so intentionally.
- **Plain results**: Handlers should return JSON-serializable objects with `{ error: '…' }` or similar for failures, not uncaught exceptions, so the UI stays stable.

## IPC conventions

- Register channels in `launchpad_client/app/src/ipc/IPCAPI.ts` and extend the `PredefinedIPC` union when adding named channels.
- Use **action-oriented** channel names (examples: `testing-modlist-get`, `process-manager-kill-post`, `managed-scenario-launch-post`).
- **Validate** payloads (types, required fields); return short, user-safe error strings. Avoid leaking stack traces or internal paths in messages shown in the UI.

## Companion mod and native extension

- **Mod (PBOs)**: Built with **HEMTT** from `launchpad_mod`. On Windows, `build_mod.bat` at the repo root runs `hemtt build` and copies addons into `A3LaunchPad/mod/addons`.
- **Extension (DLL / `.so`)**: Built with **CMake** from `launchpad_mod/extension`. On Windows, `build_extension.bat` configures `build/`, builds Release, and CMake **POST_BUILD** copies `A3_LAUNCHPAD_EXT_x64` next to the staged mod under `A3LaunchPad/`.
- Linux CI for the extension: `.github/workflows/extension-ci.yml` (CMake + Ninja + `ctest` smoke).

If you change extension or mod layout, update packaging docs or `refactor.md` when behavior or paths change.

## Development workflow

1. **Renderer** (from repo root):
   ```bash
   cd launchpad_client/renderer
   npm ci
   npm run build
   ```
2. **Electron app**:
   ```bash
   cd ../app
   npm ci
   npm run dev
   ```

Optional: after changing the companion mod or extension, run `build_mod.bat` / `build_extension.bat` from the repo root (Windows) or the equivalent CMake / HEMTT commands on your OS so `A3LaunchPad` stays in sync with what the app loads during dev.

## UI and product copy

Keep in-app strings focused on what **mission authors and modders** need, not internal implementation details (channel names, stack traces, framework jargon). Match tone and vocabulary of existing pages unless you are writing developer-only docs.

## Pull request expectations

- Keep the change **scoped** (one feature, bugfix, or migration slice).
- Update **docs** when behavior, paths, or setup steps change (`docs/`, `README.md`, or `refactor.md` as appropriate).
- If you add IPC or settings fields, ensure the **renderer types** and parsing in `api/launchpad.ts` stay aligned with the main process.

## Continuous integration

- Follow **CI** on your PR; fix what CI reports when it is clearly tied to your change.
- Extension-only changes are exercised by **Extension CI** when files under `launchpad_mod/extension/` change.

## Review and certification

- Pull requests need **review and certification** from **at least one** project coordinator before merge.
- Base branches on **`main`**, unless maintainers ask for a long-lived integration branch for a larger coordinated effort.

## Guidelines

- Do not use foul or offensive language in comments, commit messages, or UI copy.
- Prefer comments that explain **intent**, **constraints**, and **non-obvious** behavior; match the density and style of the surrounding file rather than adding noise.
- **Heed** code quality and security warnings from CI and the editor; if a problem is straightforward to fix, PRs may be held until it is addressed.
- Launchpad interacts closely with Arma 3 and the Steam ecosystem. Stay within **Bohemia Interactive’s EULA** and Steam terms; do not merge features whose primary purpose is to circumvent protections or online rules.
