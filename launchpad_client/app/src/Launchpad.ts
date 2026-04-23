import { app, BrowserWindow, shell, Menu, autoUpdater, nativeTheme } from 'electron';
import MENU_TEMPLATE from './menu.json';
import CONFIG from '../config.json';
import path from 'node:path';
import fs from 'node:fs';
import { IPCAPI } from './ipc/IPCAPI';
import { handleInstallHemttWinget } from './ipc/handlers/handleInstallHemttWinget';
import { detectArmaPaths } from './arma/detectArmaPaths';
import { bootstrapDataDirectory } from './bootstrap/bootstrapDataDirectory';
import util from 'node:util';
import { DebugSocketService } from './debug/DebugSocketService';

/** Clone before attaching ``click`` handlers so dev reload does not stack duplicate handlers. */
function cloneMenuTemplate<T>(template: T): T {
  return JSON.parse(JSON.stringify(template));
}

type MenuItemWithChildren = {
  id?: string;
  submenu?: MenuItemWithChildren[];
  click?: (event: Electron.KeyboardEvent) => void;
};

export type AutotestWatchState = {
  watch_id: string;
  started_ts: number;
  mission_id: string;
  mission_folder: string;
  pid: number;
  appdata: string | null;
  offsets: Record<string, number>;
  carry: Record<string, string>;
  result: Record<string, unknown> | null;
  poll_count: number;
};

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

//// --- Installation & Update functions --- ////
const GITHUB_OWNER = CONFIG.author;
const GITHUB_REPO = CONFIG.repository;
const REMOTE_VERSION_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/refs/heads/main/version.json`;
const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

function githubReleaseDownloadBase(tag: string) {
  const t = encodeURIComponent(String(tag).trim());
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${t}/`;
}

function releaseTagFromRemotePayload(latestVersion: string, data: any) {
  const fromField =
    (typeof data?.releaseTag === 'string' && data.releaseTag.trim()) ||
    (typeof data?.tag === 'string' && data.tag.trim());
  if (fromField) return fromField;
  return `v${String(latestVersion).trim()}`;
}

/** Squirrel installs place ``Update.exe`` next to the versioned app folder (Windows only). */
function isSquirrelWindowsInstall() {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return false;
  }
  const updateExe = path.join(path.dirname(process.execPath), '..', 'Update.exe');
  return fs.existsSync(updateExe);
}

// Compare semver strings
function compareSemver(a: string, b: string) {
  const pa = String(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}
//// --- End of Installation & Update functions --- ////

/** Title bar / taskbar icon; packaged build serves ``web_dist`` from ``resources``. */
function resolveWindowIconPath() {
  if (app.isPackaged) {
    const fromWebDist = path.join(process.resourcesPath, 'web_dist', 'favicon.ico');
    if (fs.existsSync(fromWebDist)) {
      return fromWebDist;
    }
  }
  const fromSourceTree = path.join(__dirname, '../../renderer/public/favicon.ico');
  if (fs.existsSync(fromSourceTree)) {
    return fromSourceTree;
  }
  return undefined;
}

export default class Launchpad {
  private static isConsoleLogHookInstalled = false;
  mainWindow: BrowserWindow | null = null;
  ipcAPI: IPCAPI;
  dataDir: string;
  logsDir: string;
  mainLogFile: string;
  settingsFile: string;
  managedMissionsFile: string;
  managedModProjectsFile: string;
  autotestWatch: AutotestWatchState | null = null;
  debugSocket: DebugSocketService;

  constructor() {

    this.dataDir = path.join(app.getPath('userData'), 'launchpad_data');
    this.logsDir = path.join(this.dataDir, 'logs');
    this.mainLogFile = path.join(this.logsDir, 'launchpad-main.log');
    this.settingsFile = path.join(this.dataDir, 'settings.json');
    this.managedMissionsFile = path.join(this.dataDir, 'managed_missions.json');
    this.managedModProjectsFile = path.join(this.dataDir, 'managed_mod_projects.json');
    this.debugSocket = new DebugSocketService();

    // Ensure logging can start before any bootstrap console output.
    fs.mkdirSync(this.logsDir, { recursive: true });
    this.installConsoleLogHook();

    // Bootstrap the data directory
    bootstrapDataDirectory(this);

    this.ipcAPI = new IPCAPI(this);
    const menuTemplate = cloneMenuTemplate(MENU_TEMPLATE) as MenuItemWithChildren[];
    this.setMenuEventHandler(menuTemplate);
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate as any));

    this.registerIpc();
    this.createWindow();

    this.debugSocket.setListeners({
      state: (state) => {
        this.mainWindow?.webContents?.send('debug-socket-state', state);
      },
      event: (event) => {
        this.mainWindow?.webContents?.send('debug-event', event);
      },
    });

    // On activate, create the window if it doesn't exist
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      }
    });

    // On window all closed, quit the app if it's not on macOS
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
  }

  private installConsoleLogHook() {
    if (Launchpad.isConsoleLogHookInstalled) {
      return;
    }
    Launchpad.isConsoleLogHookInstalled = true;

    const original = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };

    const writeLogLine = (level: string, args: unknown[]) => {
      const timestamp = new Date().toISOString();
      const rendered = util.formatWithOptions({ colors: false, depth: 5 }, ...args);
      const line = `[${timestamp}] [${level}] ${rendered}\n`;
      try {
        fs.appendFileSync(this.mainLogFile, line, 'utf8');
      } catch (err) {
        original.error('[Launchpad] Failed to write log file:', err);
      }
    };

    console.log = (...args: unknown[]) => {
      original.log(...args);
      writeLogLine('INFO', args);
    };
    console.info = (...args: unknown[]) => {
      original.info(...args);
      writeLogLine('INFO', args);
    };
    console.warn = (...args: unknown[]) => {
      original.warn(...args);
      writeLogLine('WARN', args);
    };
    console.error = (...args: unknown[]) => {
      original.error(...args);
      writeLogLine('ERROR', args);
    };
    console.debug = (...args: unknown[]) => {
      original.debug(...args);
      writeLogLine('DEBUG', args);
    };
  }

  // Register IPC handlers
  registerIpc() {
    this.ipcAPI.registerIPC('detect-arma-paths', () => ({
      ok: true as const,
      paths: detectArmaPaths(app.getPath('documents')),
    }));

    this.ipcAPI.registerIPC('checkForUpdates', async () => {
      const current = app.getVersion();
      try {
        const res = await fetch(REMOTE_VERSION_URL, { cache: 'no-store' });
        if (!res.ok) {
          console.error('[Launchpad] Could not check for updates right now. Try again later. Error: ' + res.statusText);
          return { ok: false, message: 'Could not check for updates right now. Try again later. Error: ' + res.statusText };
        }
        const data = await res.json();
        const latest = typeof data?.version === 'string' ? data.version.trim() : '';
        if (!latest) {
          return { ok: false, message: 'Could not check for updates right now. Try again later. Error: No version found in the remote version.json file.' };
        }
        const updateAvailable = compareSemver(current, latest) < 0;
        const releaseTag = releaseTagFromRemotePayload(latest, data);
        const canAutoInstall = updateAvailable && isSquirrelWindowsInstall();
        return {
          ok: true,
          current,
          latest,
          updateAvailable,
          releasesUrl: RELEASES_PAGE_URL,
          releaseTag,
          canAutoInstall,
        };
      } catch {
        return {
          ok: false,
          message: 'Could not reach the update information. Check your internet connection.',
        };
      }
    });

    this.ipcAPI.registerIPC('installUpdate', async (_event, payload: any) => {
      const releaseTag =
        payload && typeof payload.releaseTag === 'string' ? payload.releaseTag.trim() : '';
      if (!releaseTag) {
        return { ok: false, message: 'Could not start the update. Try the downloads page instead.' };
      }
      if (!isSquirrelWindowsInstall()) {
        return {
          ok: false,
          message: 'In-app updates work after you install the Windows version from the setup program.',
        };
      }
      const feedUrl = githubReleaseDownloadBase(releaseTag);
      autoUpdater.setFeedURL({ url: feedUrl });

      return await new Promise((resolve) => {
        const timeoutMs = 180000;
        const timer = setTimeout(() => {
          cleanup();
          resolve({
            ok: false,
            message: 'The update is taking too long. Try the downloads page instead.',
          });
        }, timeoutMs);

        const onError = (err: any) => {
          clearTimeout(timer);
          cleanup();
          const msg =
            err && typeof err.message === 'string'
              ? err.message
              : 'Something went wrong while downloading the update.';
          resolve({
            ok: false,
            message:
              msg.includes('Squirrel') || msg.includes('squirrel')
                ? 'This copy of the app cannot apply updates automatically. Use the downloads page.'
                : 'Could not download the update. Try the downloads page instead.',
          });
        };

        const onNotAvailable = () => {
          clearTimeout(timer);
          cleanup();
          resolve({
            ok: false,
            message:
              'No update package was found for this release yet. Try again later or use the downloads page.',
          });
        };

        const onDownloaded = () => {
          clearTimeout(timer);
          cleanup();
          try {
            setImmediate(() => autoUpdater.quitAndInstall());
            resolve({ ok: true });
          } catch {
            resolve({
              ok: false,
              message: 'The update downloaded but could not be applied. Try the downloads page.',
            });
          }
        };

        function cleanup() {
          autoUpdater.removeListener('error', onError);
          autoUpdater.removeListener('update-not-available', onNotAvailable);
          autoUpdater.removeListener('update-downloaded', onDownloaded);
        }

        autoUpdater.once('error', onError);
        autoUpdater.once('update-not-available', onNotAvailable);
        autoUpdater.once('update-downloaded', onDownloaded);

        try {
          autoUpdater.checkForUpdates();
        } catch {
          clearTimeout(timer);
          cleanup();
          resolve({
            ok: false,
            message: 'Could not start the update. Try the downloads page instead.',
          });
        }
      });
    });

    this.ipcAPI.registerIPC('openExternalUrl', async (_event, url) => {
      if (typeof url !== 'string' || !url.startsWith('https://')) {
        return { ok: false };
      }
      await shell.openExternal(url);
      return { ok: true };
    });

    this.ipcAPI.registerIPC('install-hemtt-winget', (event, args) =>
      handleInstallHemttWinget(this, event, args),
    );

    this.ipcAPI.registerIPC('getAppVersion', async () => {
      return { version: app.getVersion() };
    });

    this.ipcAPI.registerIPC('getAppSettings', async () => {
      const defaultSettings = { use_syntax_highlighting: true };
      const settingsDir = path.join(app.getPath('userData'), 'launchpad_data');
      const appSettingsPath = path.join(settingsDir, 'app_settings.json');
      fs.mkdirSync(settingsDir, { recursive: true });
      if (!fs.existsSync(appSettingsPath)) {
        fs.writeFileSync(appSettingsPath, JSON.stringify(defaultSettings, null, 2));
        return { contents: defaultSettings };
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(appSettingsPath, 'utf8'));
        return { contents: { ...defaultSettings, ...parsed } };
      } catch {
        return { contents: defaultSettings };
      }
    });

    this.ipcAPI.registerIPC('saveAppSettings', async (_event, args: { settings: Record<string, unknown> }) => {
      const defaultSettings = { use_syntax_highlighting: true };
      const settingsDir = path.join(app.getPath('userData'), 'launchpad_data');
      const appSettingsPath = path.join(settingsDir, 'app_settings.json');
      fs.mkdirSync(settingsDir, { recursive: true });
      let current = { ...defaultSettings };
      if (fs.existsSync(appSettingsPath)) {
        try {
          current = { ...current, ...JSON.parse(fs.readFileSync(appSettingsPath, 'utf8')) };
        } catch {
          // keep defaults
        }
      }
      const merged = { ...current, ...args.settings };
      fs.writeFileSync(appSettingsPath, JSON.stringify(merged, null, 2));
      return { ok: true, settingsChanged: args.settings };
    });
  }

  // Create the main window
  createWindow() {
    const icon = resolveWindowIconPath();
    this.mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      /* Match renderer --bg-app so OS chrome / subpixel gaps do not flash default white */
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1d21' : '#e8eaed',
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      this.mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      this.mainWindow.webContents.openDevTools();
    } else {
      const packagedIndex = path.join(process.resourcesPath, 'web_dist', 'index.html');
      if (fs.existsSync(packagedIndex)) {
        this.mainWindow.loadFile(packagedIndex);
      } else {
        this.mainWindow.loadFile(
          path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
        );
      }
    }
  }

  // Handle menu events
  menuEventHandler(event: Electron.KeyboardEvent, args: { event: string }) {
    if (args.event === 'open-data-directory') {
      void shell.openPath(this.dataDir);
      return;
    }
    this.mainWindow?.webContents?.send('menu-event', args);
  }

  // Recursively set the application menu event handlers
  setMenuEventHandler(menuTemplate: MenuItemWithChildren[]) {
    for (const item of menuTemplate) {
      if (item.submenu) {
        this.setMenuEventHandler(item.submenu);
      }
      if (item.id) {
        item.click = (event) => this.menuEventHandler(event, { event: item.id as string });
      }
    }
  }
}