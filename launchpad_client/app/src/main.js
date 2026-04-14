import { app, BrowserWindow, ipcMain, shell, Menu, autoUpdater } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import MENU_TEMPLATE from './menu.json';
import CONFIG from '../config.json';

if (started) {
  app.quit();
}

const GITHUB_OWNER = CONFIG.author;
const GITHUB_REPO = CONFIG.repository;
const REMOTE_VERSION_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/refs/heads/main/version.json`;
const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

function githubReleaseDownloadBase(tag) {
  const t = encodeURIComponent(String(tag).trim());
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${t}/`;
}

/** Squirrel installs place ``Update.exe`` next to the versioned app folder (Windows only). */
function isSquirrelWindowsInstall() {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return false;
  }
  const updateExe = path.join(path.dirname(process.execPath), '..', 'Update.exe');
  return fs.existsSync(updateExe);
}

function releaseTagFromRemotePayload(latestVersion, data) {
  const fromField =
    (typeof data?.releaseTag === 'string' && data.releaseTag.trim()) ||
    (typeof data?.tag === 'string' && data.tag.trim());
  if (fromField) return fromField;
  return `v${String(latestVersion).trim()}`;
}

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

function compareSemver(a, b) {
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

/** Clone before attaching ``click`` handlers so dev reload does not stack duplicate handlers. */
function cloneMenuTemplate(template) {
  return JSON.parse(JSON.stringify(template));
}

class Main {
	mainWindow = null;
	pythonBackendChild = null;

  	constructor() {
		const menuTemplate = cloneMenuTemplate(MENU_TEMPLATE);
		this.setMenuEventHandler(menuTemplate);
		Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

		this.registerIpc();
		this.startPackagedPythonBackend();
		this.createWindow();

		// On activate, create the window if it doesn't exist
		app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			this.createWindow();
		}
		});

		// On before quit, kill the Python backend if it's running
		app.on('before-quit', () => {
			if (this.pythonBackendChild && !this.pythonBackendChild.killed) {
				this.pythonBackendChild.kill();
				this.pythonBackendChild = null;
			}
		});

		// On window all closed, quit the app if it's not on macOS
		app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			app.quit();
		}
		});
	}

	// Register IPC handlers
	registerIpc() {
		ipcMain.handle('checkForUpdates', async () => {
		const current = app.getVersion();
		try {
			const res = await fetch(REMOTE_VERSION_URL, { cache: 'no-store' });
			if (!res.ok) {
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

		ipcMain.handle('installUpdate', async (_event, payload) => {
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

				const onError = (err) => {
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
						setImmediate(() => autoUpdater.quitAndInstall(false, true));
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

				autoUpdater.checkForUpdates().catch(() => {
					clearTimeout(timer);
					cleanup();
					resolve({
						ok: false,
						message: 'Could not start the update. Try the downloads page instead.',
					});
				});
			});
		});

		ipcMain.handle('openExternalUrl', async (_event, url) => {
		if (typeof url !== 'string' || !url.startsWith('https://')) {
			return { ok: false };
		}
		await shell.openExternal(url);
		return { ok: true };
		});

		ipcMain.handle('fileGetContents', async (_event, args) => {
			const resolved = path.resolve(args.file);
			if (!fs.existsSync(resolved)) {
				return { error: 'File not found' };
			}
			return { contents: fs.readFileSync(resolved, 'utf8') };
			});

			ipcMain.handle('fileExists', async (_event, args) => {
			const resolved = path.resolve(args.file);
			return { exists: fs.existsSync(resolved) };
			});

			ipcMain.handle('directoryList', async (_event, args) => {
			const resolved = path.resolve(args.directory);
			if (!fs.existsSync(resolved)) {
				return { error: 'Directory not found' };
			}
			return { contents: fs.readdirSync(resolved) };
		});

		ipcMain.handle('getAppSettings', async () => {
			const defaultSettings = { use_syntax_highlighting: true };
			const settingsDir = path.join(app.getPath('userData'), 'launchpad_data');
			const settingsPath = path.join(settingsDir, 'app_settings.json');
			fs.mkdirSync(settingsDir, { recursive: true });
			if (!fs.existsSync(settingsPath)) {
				fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
				return { contents: defaultSettings };
			}
			try {
				const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
				return { contents: { ...defaultSettings, ...parsed } };
			} catch {
				return { contents: defaultSettings };
			}
		});

		ipcMain.handle('saveAppSettings', async (_event, args) => {
			const defaultSettings = { use_syntax_highlighting: true };
			const settingsDir = path.join(app.getPath('userData'), 'launchpad_data');
			const settingsPath = path.join(settingsDir, 'app_settings.json');
			fs.mkdirSync(settingsDir, { recursive: true });
			let current = { ...defaultSettings };
			if (fs.existsSync(settingsPath)) {
				try {
					current = { ...current, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
				} catch {
					// keep defaults
				}
			}
			const merged = { ...current, ...args.settings };
			fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
			return { ok: true, settingsChanged: args.settings };
		});
	}

	// Create the main window
	createWindow() {
		const icon = resolveWindowIconPath();
		this.mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
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

	// Start the packaged Python backend
	startPackagedPythonBackend() {
		if (!app.isPackaged) {
		return;
		}
		const binDir = path.join(process.resourcesPath, 'bin');
		const exeName =
		process.platform === 'win32' ? 'A3MissionLaunchpadPython.exe' : 'A3MissionLaunchpadPython';
		const exePath = path.join(binDir, exeName);
		if (!fs.existsSync(exePath)) {
		console.error(
			'[Launchpad] Backend not found. From the repo root run: python package.py package',
		);
		return;
		}
		this.pythonBackendChild = spawn(exePath, [], {
		cwd: binDir,
		stdio: 'ignore',
		env: { ...process.env, LAUNCHPAD_HEADLESS: '1' },
		shell: false,
		});
		this.pythonBackendChild.on('error', (err) => {
		console.error('[Launchpad] Failed to start Python backend:', err);
		});
	}

	// Handle menu events
	menuEventHandler(event, args) {
		this.mainWindow?.webContents?.send('menu-event', args);
	}

  	// Recursively set the application menu event handlers
  	setMenuEventHandler(menuTemplate) {
		for (const item of menuTemplate) {
			if (item.submenu) {
				this.setMenuEventHandler(item.submenu);
			}
			if (item.id) {
				item.click = (event) => this.menuEventHandler(event, { event: item.id });
			}
		}
	}


}

app.whenReady().then(() => {
  new Main();
});
