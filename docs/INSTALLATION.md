# Installation Instructions

This document will guide you through setting up the Electron development environment and packaging the desktop app.

> [!NOTE]
> Major refactor update: desktop features are being migrated from Python HTTP endpoints to Electron IPC handlers. The renderer now uses IPC-first calls in desktop mode, with HTTP fallback only where explicitly retained.

## Desktop Development Setup

1. **Prerequisites**: Install Node.js (current LTS recommended).
2. **Clone the Repository**: Run the following command to clone the repo to your local machine.
   ```bash
   git clone https://github.com/a3r0id/a3-mission-launchpad.git
   cd a3-mission-launchpad
   ```
3. **Install renderer dependencies and build**:
   ```bash
   cd launchpad_client/renderer
   npm ci
   npm run build
   ```
4. **Install Electron app dependencies and run**:
   ```bash
   cd ../app
   npm ci
   npm run dev
   ```
## Packaging

For users who prefer not to set up a development environment, a portable binary is available.

> [!IMPORTANT]
> Packaged builds are unsigned and may be flagged by antivirus/smart screen on some systems.

**Install from GitHub**

1. Clone the repo or download it as an archive via the github website.

2. Build the renderer and package the Electron app.

   Windows
   ```bash
   cd a3-mission-launchpad
   cd launchpad_client/renderer
   npm ci
   npm run build
   cd ../app
   npm ci
   npm run package
   ```

   Linux/MacOS
   ```bash
   cd a3-mission-launchpad
   cd launchpad_client/renderer
   npm ci
   npm run build
   cd ../app
   npm ci
   npm run package
   ```

**Build your own executable**

1. Clone the repo or download it as an archive via the github website.

2. Build and package from the Electron app.

   Windows
   ```bash
   cd a3-mission-launchpad
   cd launchpad_client/renderer
   npm ci
   npm run build
   cd ../app
   npm ci
   npm run package
   ```

   Linux/macOS
   ```bash
   cd a3-mission-launchpad
   cd launchpad_client/renderer
   npm ci
   npm run build
   cd ../app
   npm ci
   npm run package
   ```

   Requirements: Node/npm and platform build toolchain requirements used by Electron Forge.

## Publishing desktop builds to GitHub Releases

1. Bump `version.json` at the repo root and `launchpad_client/app/package.json` so they match.
2. Set a GitHub token with `repo` scope (`GITHUB_TOKEN`, `GH_TOKEN`, or `ELECTRON_FORGE_GITHUB_TOKEN`).
3. From `launchpad_client/app`, run `npm run publish` (or use your release workflow).

## Refactor-Aware Runtime Notes

- Desktop runtime path:
  - `renderer` -> `ipc.invoke(...)` -> `app/src/ipc/handlers/*`
- Legacy Python backend remains for non-migrated routes.
- Migrated routes now return HTTP `410` from Python with `deprecated_endpoint` to indicate the new IPC path.

---

Feel free to reach out if you encounter any issues or have questions!
