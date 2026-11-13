import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const createWindow = (): void => {
  const window = new BrowserWindow({
    height: 720,
    width: 1280,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(currentDirectory, 'preload.js'),
      sandbox: true,
    },
  });

  const developmentUrl = process.env['VITE_DEV_SERVER_URL'];
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
