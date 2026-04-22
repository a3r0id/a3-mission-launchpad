# Installation

Launchpad is a **desktop Electron app**. There is no separate Python server in this repository—the UI talks to the main process over **IPC** for filesystem, Arma launch, builds, and related features.

## Choose your path

| Goal | Where to look |
|------|----------------|
| **Clone, build, package, and optional companion mod/extension** | **[Installing from source](SOURCE_INSTALL.md)** (full walkthrough) |
| **Quick local development** | [Development (short)](#development-short) below |
| **Problems** | [Troubleshooting](TROUBLESHOOTING.md) |

## Prerequisites

- **Node.js** (current **LTS** recommended) and **npm**
- **Git** (for source installs)
- **Arma 3** (Steam) for real-world testing of missions, mods, and launches

Optional, depending on what you build locally:

- **HEMTT** — companion mod under `launchpad_mod`
- **CMake 3.21+** and a **64-bit** C++ compiler — native RV extension under `launchpad_mod/extension`
- **Python 3** — only if you use **`util.py`** for release-style staging (`python util.py --build`)

## Development (short)

1. Clone the repo (see [SOURCE_INSTALL.md](SOURCE_INSTALL.md) for details).
2. Install dependencies and run the app in **dev mode** (Vite + Electron):

   ```bash
   cd launchpad_client/renderer
   npm ci

   cd ../app
   npm ci
   npm run dev
   ```

`npm run dev` uses **Electron Forge** with the Vite plugin: the renderer is served from the dev server, so you usually **do not** need `npm run build` in the renderer while iterating on the UI.

For packaging, staging **`A3LaunchPad`**, HEMTT, the extension, and **`util.py`**, follow **[SOURCE_INSTALL.md](SOURCE_INSTALL.md)**.

## Packaged installs and releases

Prebuilt artifacts may be published on the project’s **[GitHub Releases](https://github.com/a3r0id/launchpad/releases)** page when maintainers ship a version.

> [!IMPORTANT]
> Local and CI-built binaries are typically **unsigned**. Windows **SmartScreen** or antivirus may warn or block the first run. Allow only if you trust the source (official release or your own build).

To **build an installer or portable bundle yourself**, use `npm run package` or `npm run make` from `launchpad_client/app` after a renderer production build and any **`A3LaunchPad`** staging you need—see [SOURCE_INSTALL.md](SOURCE_INSTALL.md).

## First launch

After the app starts, open **Settings** and set at least the **Arma 3 install path**. Optionally set **Workshop folder** and profile paths so launches, imports, and mod resolution match your machine.

State files (settings, managed missions, logs, etc.) live under a per-user **`launchpad_data`** folder; see [SOURCE_INSTALL.md § First-run data](SOURCE_INSTALL.md#8-first-run-data-and-settings).

## Contributing

See [Contributing](CONTRIBUTING.md) for architecture expectations, IPC conventions, and review rules.
