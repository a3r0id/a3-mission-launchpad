# Refactor Notes (Current)

This document tracks the major architecture refactor and where features now live.

## Repository Layout

- `launchpad_client`
  - Electron app + renderer.
  - Deliverable desktop app output lives under the packaged app artifacts (`A3LaunchPad/bin` or `A3LaunchPad/app`, depending on target/build flow).
- `launchpad_mod`
  - Companion mod and extension.
  - Deliverables:
    - `A3LaunchPad/mod/addons/a3_launchpad_ext_core.pbo` (HEMTT-built PBO)
    - `A3LaunchPad/mod/A3_LAUNCHPAD_EXT_x64.dll`
    - `A3LaunchPad/mod/A3_LAUNCHPAD_EXT_x64.so`
- `A3LaunchPad`
  - Source of truth for final deliverables/packaging layout.

## Architecture Direction

Desktop feature logic is moving from Python HTTP endpoints to Electron IPC handlers.

- Renderer calls should be IPC-first in desktop mode (`ipc.invoke(...)`).
- Python routes that have been migrated should return `410` with `code: "deprecated_endpoint"`.
- HTTP fallback in renderer can remain for browser/non-Electron contexts when needed.

## Migrated Endpoint Groups (So Far)

- Testing modlist:
  - IPC channels:
    - `testing-modlist-get`
    - `testing-modlist-post`
    - `testing-modlist-patch`
  - Deprecated Python endpoint:
    - `/api/testing/modlist`

- Process manager:
  - IPC channels:
    - `process-manager-get`
    - `process-manager-kill-post`
  - Deprecated Python endpoints:
    - `/api/process-manager`
    - `/api/process-manager/kill`

## Packaging / Updates

Packaging and update flow still needs to be finalized and hardened:

- Electron packaging reference: [Electron Packaging Tutorial](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)