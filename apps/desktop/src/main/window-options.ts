import type { BrowserWindowConstructorOptions } from 'electron';

export const createWindowOptions = (
  preloadPath: string,
  smokeTest = false,
): BrowserWindowConstructorOptions => ({
  backgroundColor: '#f4f7f6',
  height: 820,
  minHeight: 680,
  minWidth: 1080,
  show: !smokeTest,
  title: 'KIL Business',
  width: 1440,
  webPreferences: {
    allowRunningInsecureContent: false,
    contextIsolation: true,
    nodeIntegration: false,
    preload: preloadPath,
    sandbox: true,
    webSecurity: true,
  },
});
