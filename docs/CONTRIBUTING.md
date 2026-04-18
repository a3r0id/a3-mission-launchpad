# Contributing

This project is transitioning to an Electron IPC-first architecture for desktop functionality.

## Current Architecture

- `launchpad_client/renderer`: React UI and browser-compatible API wrappers.
- `launchpad_client/app`: Electron main process, IPC handlers, desktop integrations.
- `launchpad_server`: legacy Python HTTP backend; selected endpoints are deprecated as desktop features move to IPC.

## Migration Rule of Thumb

- For desktop-only operations (filesystem, process control, Arma launch/build helpers), add or update an IPC handler in `launchpad_client/app/src/ipc/handlers`.
- In renderer APIs (`launchpad_client/renderer/src/api/launchpad.ts`), prefer:
  1. `getElectronIpc()` + `ipc.invoke(...)` in Electron
  2. HTTP fallback only when running outside Electron (if still needed)
- Deprecated Python endpoints should return `410` with `code: "deprecated_endpoint"` and a short migration hint.

## IPC Conventions

- Register channels in `launchpad_client/app/src/ipc/IPCAPI.ts`.
- Keep channel names action-oriented (example: `testing-modlist-get`, `process-manager-kill-post`).
- Return plain JSON-like objects; avoid throwing uncaught errors from handlers.
- Validate all payload fields and return user-safe error strings.

## Recent Refactor Notes

The following routes have been migrated from Python HTTP to Electron IPC:

- Testing mod list:
  - IPC: `testing-modlist-get`, `testing-modlist-post`, `testing-modlist-patch`
  - Deprecated HTTP: `/api/testing/modlist`
- Process manager:
  - IPC: `process-manager-get`, `process-manager-kill-post`
  - Deprecated HTTP: `/api/process-manager`, `/api/process-manager/kill`

## Development Workflow

1. Build renderer:
   - `cd launchpad_client/renderer`
   - `npm ci`
   - `npm run build`
2. Run Electron app:
   - `cd ../app`
   - `npm ci`
   - `npm run dev`

## Pull Request Expectations

- Keep changes scoped (single feature or migration slice).
- Update docs when you migrate endpoints/channels.
- Preserve fallback behavior unless explicitly removing HTTP support.
- Prefer clear migration messages when deprecating endpoints.
