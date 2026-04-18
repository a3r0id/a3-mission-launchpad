# Troubleshooting

## Desktop API Errors After Refactor

If you see errors about deprecated endpoints (HTTP 410), the desktop path has moved to Electron IPC.

Examples:

- `/api/testing/modlist` -> use renderer IPC-first flow:
  - `testing-modlist-get`
  - `testing-modlist-post`
  - `testing-modlist-patch`
- `/api/process-manager` -> `process-manager-get`
- `/api/process-manager/kill` -> `process-manager-kill-post`

## "Invalid response from desktop API."

Common causes:

- IPC channel not registered in `launchpad_client/app/src/ipc/IPCAPI.ts`
- Handler file missing import/export wiring
- Renderer payload shape does not match handler expectations

Checklist:

1. Confirm channel registration in `IPCAPI.ts`
2. Confirm handler exists in `launchpad_client/app/src/ipc/handlers`
3. Confirm renderer call in `launchpad_client/renderer/src/api/launchpad.ts` uses the correct channel and payload

## Process Manager Kill Fails

If stop-session fails:

- Validate PID is a positive integer.
- Only Arma-related process names are allowed by the kill guard.
- On Windows, ensure current user has permission to terminate the process.

## Lint Errors During Migration

Some existing lint warnings/errors may be unrelated to your endpoint migration. Validate changed files first, then address repo-wide issues separately.

## Backend Endpoint Still Being Called

If old HTTP routes are still hit in desktop mode:

- Ensure renderer API function checks `getElectronIpc()` first.
- Ensure app is running in Electron (not a plain browser-only session).
- Ensure a stale cached renderer build is not being served.
