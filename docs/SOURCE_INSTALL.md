# Installing and building from source

This guide is for developers and advanced users who want to run Launchpad from a git checkout, customize it, or produce a local package. For a shorter overview, see [Installation](INSTALLATION.md).

## What you are building

Launchpad is an **Electron** application:

| Part | Location | Notes |
|------|----------|--------|
| Renderer (React + Vite) | `launchpad_client/renderer` | Own `package.json`; produces `dist/` when you run `npm run build`. |
| Main / preload (Electron + TypeScript) | `launchpad_client/app` | Own `package.json`; **Electron Forge + Vite**; entry `npm run dev` / `npm run package`. |
| Companion Arma mod | `launchpad_mod` | Built with **HEMTT**; PBOs staged under `A3LaunchPad/mod/addons/`. |
| Native RV extension | `launchpad_mod/extension` | **CMake**; DLL / `.so` copied by CMake to `A3LaunchPad/` (next to `mod/`). |

The desktop app does **not** use a bundled Python HTTP server anymore. Features talk to the OS and the game through **IPC** handlers in `launchpad_client/app/src/ipc/handlers`.

Optional release automation lives in **`util.py`** at the repo root (`python util.py --build`, etc.); it stages `A3LaunchPad/web_dist`, runs Forge packaging, and can orchestrate HEMTT / extension / hook builds depending on flags.

---

## Prerequisites

### Required (all platforms)

- **Git**
- **Node.js** — current **LTS** (even major) is recommended; match what CI uses when in doubt.
- **npm** (ships with Node)

### Required for a packaged / “production-like” build

- A successful **`npm run build`** in `launchpad_client/renderer` so `launchpad_client/renderer/dist` exists.  
  Electron Forge can embed the UI from other paths in some modes, but **`util.py` and a predictable `A3LaunchPad/web_dist` layout expect `renderer/dist`**.

### Optional but common for full functionality

| Tool | Purpose |
|------|---------|
| **HEMTT** | Build companion mod PBOs from `launchpad_mod`. |
| **CMake 3.21+** + a **64-bit** C++ toolchain (MSVC, Clang, or GCC) | Build `A3_LAUNCHPAD_EXT_x64.dll` / `.so` in `launchpad_mod/extension`. |
| **Arma 3** (Steam) | Runtime testing, missions, mod paths. |

### Platform notes

- **Windows**: Visual Studio Build Tools or full VS with C++ workload for the extension; **SmartScreen** may warn on unsigned local binaries (see [Troubleshooting](TROUBLESHOOTING.md)).
- **Linux**: Often the only supported way to run from source today; you may need `libfuse2` or distro equivalents for some AppImage-style artifacts if you use certain makers—follow Electron Forge docs for your target format.
- **macOS**: Forge includes a zip maker; codesigning is outside this doc.

---

## 1. Clone the repository

```bash
git clone https://github.com/a3r0id/launchpad.git
cd launchpad
```

Use a path **without unusual Unicode or very long segments** on Windows to avoid toolchain path limits.

---

## 2. Install JavaScript dependencies

Install **renderer** and **app** dependencies separately (two `package.json` files).

```bash
cd launchpad_client/renderer
npm ci

cd ../app
npm ci
```

Use `npm install` only if you intentionally need floating versions; for reproducible builds prefer **`npm ci`**.

---

## 3. Day-to-day development (hot reload)

From **`launchpad_client/app`**:

```bash
npm run dev
```

This starts **Electron Forge** with the Vite plugin: the renderer is served from the Vite dev server (`MAIN_WINDOW_VITE_DEV_SERVER_URL`), so you **do not** need to run `npm run build` in the renderer first for normal UI work. DevTools open automatically in this mode.

**Inspect flags** (default `dev` script): the app scripts may pass `--inspect` / remote debugging ports for attaching a debugger—see `launchpad_client/app/package.json` if you need to change that.

---

## 4. Building the renderer for packaging

When you package the app or use **`util.py`**, you need a static production build of the web UI:

```bash
cd launchpad_client/renderer
npm ci   # if not already done
npm run build
```

Output: `launchpad_client/renderer/dist/`.

To mirror what Forge’s `extraResource` expects for a self-contained **`A3LaunchPad`** folder, copy that tree to **`A3LaunchPad/web_dist/`** (or run `python util.py --build`, which runs `stage_web_dist()` after verifying `dist` exists).

---

## 5. Companion mod (HEMTT)

From repo root (with **HEMTT** on your `PATH`):

```bash
cd launchpad_mod
hemtt build
```

On **Windows**, you can use **`build_mod.bat`** at the repo root: it runs HEMTT and copies addons into **`A3LaunchPad/mod/addons/`**.

Forge’s `forge.config.js` adds **`A3LaunchPad/mod`** as an `extraResource` when that directory exists, so packaged builds can ship the companion mod alongside the app.

---

## 6. Native extension (CMake)

From repo root on **Windows**:

```bat
build_extension.bat
```

Or manually:

```bash
cd launchpad_mod/extension
cmake -B build -S . -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

CMake **POST_BUILD** copies **`A3_LAUNCHPAD_EXT_x64.dll`** (or `.so` on Linux) into **`A3LaunchPad/`**. Forge picks those files up as `extraResource` when present.

See `launchpad_mod/extension/README.md` for Linux smoke tests (`ctest`) and invoker scripts.

---

## 7. Package the Electron app

Ensure **`npm run build`** has been run in **`launchpad_client/renderer`** if you rely on **`web_dist`** or `util.py` preflight.

From **`launchpad_client/app`**:

```bash
npm run package
```

Artifacts appear under **`launchpad_client/app/out/`** (or a custom directory if **`LAUNCHPAD_ELECTRON_OUT`** is set—`util.py` uses this on Windows to avoid locked `out` trees).

Other scripts:

- **`npm run make`** — distribution targets (Squirrel, zip, deb, rpm, …) per `forge.config.js`.
- **`npm run publish`** — publishing pipeline (requires credentials / configuration).

---

## 8. First-run data and settings

On first launch the app creates **`launchpad_data`** next to Electron’s **`userData`** directory (for example **`%AppData%\<app>\launchpad_data`** on Windows, where `<app>` matches the packaged product folder name). That folder holds **`settings.json`**, logs, managed missions, mod projects, testing modlists, and similar state.

In **Settings** inside the app, configure at least:

- **Arma 3 install path** (`arma3_path`)
- Optionally **Workshop content folder** for mod resolution (`arma3_workshop_path`) — useful when importing presets or resolving workshop items to disk paths.

---

## 9. Optional: full release-style build with `util.py`

From the **repository root** (Python 3):

```bash
python util.py --build
```

Add **`--pbo`** with **`--build`** to require **HEMTT** and run **`hemtt build`** for the companion addon. See `python util.py --help`.

This coordinates staging **`web_dist`**, packaging the Electron app into **`A3LaunchPad/app`**, and related steps (see `util.py`). Use it when you want the same deliverable layout maintainers use for releases.

---

## 10. Verify and next steps

- Launch the packaged executable from **`launchpad_client/app/out/…`** or your staged **`A3LaunchPad/app`** tree.
- Confirm **Settings → Arma 3 path** points at your Steam install.
- If the companion mod or extension is missing, confirm **`A3LaunchPad/mod`** and **`A3LaunchPad/A3_LAUNCHPAD_EXT_x64.*`** exist before **`npm run package`**.

For IPC architecture and contribution rules, see [Contributing](CONTRIBUTING.md). If something fails, check [Troubleshooting](TROUBLESHOOTING.md).
