# Troubleshooting

If you are building from git, start with **[Installing from source](SOURCE_INSTALL.md)** to confirm Node versions, `npm ci` in both `renderer` and `app`, and any **`A3LaunchPad`** staging steps.

---

## Blank window or “old” UI after packaging

**Symptoms:** Packaged app opens but the window stays blank, or the UI looks nothing like current `main`.

**Checks:**

1. Run **`npm run build`** in **`launchpad_client/renderer`** so **`launchpad_client/renderer/dist`** exists.
2. If you rely on **`A3LaunchPad/web_dist`** (recommended for parity with Forge `extraResource`), copy `renderer/dist` into **`A3LaunchPad/web_dist/`**, or run **`python util.py --build`** (it enforces a non-empty `dist` before staging).
3. Confirm you launched the binary from the latest **`npm run package`** output under **`launchpad_client/app/out/`** (or your staged **`A3LaunchPad/app`** tree), not an older shortcut.

In **development**, `npm run dev` loads the UI from the **Vite dev server**; a missing renderer build usually affects **packaged** runs, not dev.

---

## “Invalid response from desktop API” or IPC errors

The desktop app does **not** use the legacy Python HTTP API. Features should call **`ipc.invoke('…')`** through the helpers in **`launchpad_client/renderer/src/api/launchpad.ts`**.

**Common causes:**

- Channel not registered in **`launchpad_client/app/src/ipc/IPCAPI.ts`**
- Handler not wired or throws before returning a plain object
- Renderer payload shape does not match what the handler expects

**Checklist:**

1. Confirm the channel name in **`IPCAPI.ts`** and the **`PredefinedIPC`** type if applicable.
2. Confirm the handler under **`launchpad_client/app/src/ipc/handlers/`** returns serializable JSON (use `{ error: '…' }` instead of uncaught exceptions for expected failures).
3. Confirm **`launchpad.ts`** uses the same channel string and field names as the handler.

---

## Deprecated HTTP / 410 errors

If you still see references to **`/api/...`** endpoints returning **410** or “deprecated endpoint,” you are on an **old renderer build** or custom code still calling HTTP in desktop mode. Rebuild the renderer and app; in code, prefer **`getElectronIpc()`** + **`ipc.invoke`** as in the current **`launchpad.ts`** patterns.

---

## Mods or `-mod=` show Steam URLs (`http;//…`) or wrong paths

Launchpad resolves **Steam Workshop page URLs** to **local** `steamapps/workshop/content/107410/<id>` folders when those folders exist. Ensure **Settings → Arma 3 path** is correct (so `steamapps` can be inferred) and, if needed, **Workshop folder** points at your Steam workshop layout.

If a mod is only installed under a custom **`@Folder`** name, store that **disk path** in the mod list—not the Steam HTML URL.

---

## Process manager: kill fails

- The PID must be a valid **positive integer**.
- Only **Arma-related** process names are allowed by the kill guard (by design).
- On Windows, run Launchpad with sufficient rights to terminate the target process.

---

## Companion mod or extension missing in packaged builds

**Electron Forge** adds **`A3LaunchPad/mod`** and **`A3LaunchPad/A3_LAUNCHPAD_EXT_x64.(dll|so)`** as **`extraResource`** only when those paths **exist at package time** (see **`launchpad_client/app/forge.config.js`**).

1. Run **`hemtt build`** (and copy addons into **`A3LaunchPad/mod/addons/`**—e.g. **`build_mod.bat`** on Windows).
2. Build the extension (**`build_extension.bat`** or CMake from **`launchpad_mod/extension`**).
3. Run **`npm run package`** again from **`launchpad_client/app`**.

---

## HEMTT / CMake “not found”

- **HEMTT:** Install and ensure **`hemtt`** is on your **`PATH`** when you run **`build_mod.bat`** or **`python util.py --build --pbo`**.
- **Extension:** Needs **CMake 3.21+** and a **64-bit** toolchain. On Windows, open a **“x64 Native Tools”** or **Developer** prompt if **`cl`** is not on `PATH`.

---

## Windows: packaging fails with locked `out` directory

Electron Forge may leave files locked if an old Launchpad instance or Explorer is holding the tree. **`util.py`** sets **`LAUNCHPAD_ELECTRON_OUT`** to a fresh directory for **`npm run package`** to reduce collisions. Close running builds, exit packaged apps, and retry.

---

## Linux: RPM maker skipped

**`forge.config.js`** only registers the **RPM** maker if **`rpmbuild`** is available. Debian/Ubuntu users can ignore that; use **`deb`** or **zip** targets via **`npm run make`**.

---

## Lint and TypeScript noise during refactors

Fix issues in **files you touch** first. Pre-existing warnings elsewhere can be handled in separate changes so reviews stay focused.

---

## Still stuck?

Open a **[GitHub issue](https://github.com/a3r0id/launchpad/issues)** with your OS, Node version, whether you are in **dev** or **packaged** mode, and the last few lines of the terminal or DevTools console. For architecture questions, see **[Contributing](CONTRIBUTING.md)**.
