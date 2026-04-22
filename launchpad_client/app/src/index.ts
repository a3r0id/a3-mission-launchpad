import { app } from 'electron';
import started from 'electron-squirrel-startup';
import Launchpad from './Launchpad';

if (app.isPackaged) {
  try {
    const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: 'a3r0id/launchpad',
      },
      updateInterval: '1 hour',
      logger: require('electron-log'),
    });
  } catch (err: any) {
    console.warn('[Launchpad] Auto-update integration unavailable:', err?.message || err);
  }
}

if (started) {
  app.quit();
}

app.whenReady().then(() => {
  new Launchpad();
});
