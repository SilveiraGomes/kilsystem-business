import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWindowOptions } from './window-options.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const smokeTest = process.argv.includes('--smoke-test');

const createWindow = (): void => {
  const window = new BrowserWindow(
    createWindowOptions(path.join(currentDirectory, 'preload.cjs'), smokeTest),
  );

  const developmentUrl = process.env['VITE_DEV_SERVER_URL'];
  const applicationUrl = developmentUrl ??
    `file://${path.join(currentDirectory, '../dist/renderer/index.html')}`;

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== applicationUrl) event.preventDefault();
  });

  if (smokeTest) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void window.webContents
          .executeJavaScript(`({
            dashboard: Boolean(document.querySelector('.dashboard')),
            preload: Boolean(window.kilDesktop?.runtime?.platform),
            safeApi: Object.keys(window.kilDesktop ?? {}).join(',') === 'runtime'
          })`)
          .then((probe: unknown) => {
            const ready =
              typeof probe === 'object' &&
              probe !== null &&
              'dashboard' in probe &&
              probe.dashboard === true &&
              'preload' in probe &&
              probe.preload === true &&
              'safeApi' in probe &&
              probe.safeApi === true;

            if (!ready) {
              console.error('KIL_ELECTRON_SMOKE_FAILED', probe);
              app.exit(1);
              return;
            }

            console.log('KIL_ELECTRON_SMOKE_OK');
            app.quit();
          })
          .catch((error: unknown) => {
            console.error('KIL_ELECTRON_SMOKE_FAILED', error);
            app.exit(1);
          });
      }, 500);
    });
    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`KIL_ELECTRON_SMOKE_FAILED ${code}: ${description}`);
      app.exit(1);
    });
  }

  if (developmentUrl) {
    void window.loadURL(developmentUrl);
    return;
  }

  void window.loadFile(path.join(currentDirectory, '../dist/renderer/index.html'));
};

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
