import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { configureSessionPermissions, isAllowedNavigation } from './security.js';
import { createWindowOptions } from './window-options.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const smokeTest = process.argv.includes('--smoke-test');

const createWindow = (): void => {
  const window = new BrowserWindow(
    createWindowOptions(path.join(currentDirectory, 'preload.cjs'), smokeTest),
  );

  const developmentUrl = process.env['VITE_DEV_SERVER_URL'];
  const rendererPath = path.join(currentDirectory, '../dist/renderer/index.html');
  const applicationUrl = developmentUrl ?? pathToFileURL(rendererPath).href;

  configureSessionPermissions(window.webContents.session);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl, applicationUrl)) event.preventDefault();
  });

  if (smokeTest) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void window.webContents
          .executeJavaScript(`(async () => {
            const destinations = [
              'Empresas',
              'Estabelecimentos',
              'Utilizadores',
              'Vendas',
              'Stock',
              'Contabilidade',
              'Configurações',
              'Visão geral'
            ];
            let navigation = true;

            for (const destination of destinations) {
              const button = Array.from(document.querySelectorAll('.navigation-item'))
                .find((candidate) => candidate.textContent?.trim() === destination);

              if (!(button instanceof HTMLButtonElement)) {
                navigation = false;
                break;
              }

              button.click();
              await new Promise((resolve) => requestAnimationFrame(resolve));

              const active = document.querySelector('.navigation-item[aria-current="page"] span')
                ?.textContent?.trim() === destination;
              const content = destination === 'Visão geral'
                ? Boolean(document.querySelector('.dashboard'))
                : document.querySelector('#module-title')?.textContent?.trim() === destination;

              if (!active || !content) {
                navigation = false;
                break;
              }
            }

            return {
              dashboard: Boolean(document.querySelector('.dashboard')),
              navigation,
              preload: Boolean(window.kilDesktop?.runtime?.platform),
              rendererIsolated: typeof window.process === 'undefined' &&
                typeof window.require === 'undefined',
              safeApi: Object.keys(window.kilDesktop ?? {}).join(',') === 'runtime'
            };
          })()`)
          .then((probe: unknown) => {
            const ready =
              typeof probe === 'object' &&
              probe !== null &&
              'dashboard' in probe &&
              probe.dashboard === true &&
              'preload' in probe &&
              probe.preload === true &&
              'navigation' in probe &&
              probe.navigation === true &&
              'rendererIsolated' in probe &&
              probe.rendererIsolated === true &&
              'safeApi' in probe &&
              probe.safeApi === true;

            if (!ready) {
              console.error('KIL_ELECTRON_SMOKE_FAILED', probe);
              app.exit(1);
              return;
            }

            console.log(
              `KIL_ELECTRON_RUNTIME electron=${process.versions.electron} chromium=${process.versions.chrome} node=${process.versions.node}`,
            );
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

  void window.loadFile(rendererPath);
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
