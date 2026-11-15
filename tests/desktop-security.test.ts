import { describe, expect, it } from 'vitest';

import { createDesktopApi } from '../apps/desktop/src/main/preload-api.cts';
import {
  denyPermissionRequest,
  isAllowedNavigation,
  isPermissionAllowed,
} from '../apps/desktop/src/main/security';
import { createWindowOptions } from '../apps/desktop/src/main/window-options';

describe('Electron security baseline', () => {
  it('isolates the renderer and disables Node.js integration', () => {
    const options = createWindowOptions('C:/safe/preload.js');

    expect(options.webPreferences).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      navigateOnDragDrop: false,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
    });
  });

  it('exposes only immutable, non-privileged runtime metadata', () => {
    const api = createDesktopApi('win32');

    expect(Object.keys(api)).toEqual(['runtime']);
    expect(api.runtime.platform).toBe('win32');
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.runtime)).toBe(true);
    expect(api).not.toHaveProperty('ipcRenderer');
    expect(api).not.toHaveProperty('require');
  });

  it('denies all renderer permission checks and requests', () => {
    let granted: boolean | undefined;

    denyPermissionRequest((allowed) => {
      granted = allowed;
    });

    expect(isPermissionAllowed()).toBe(false);
    expect(granted).toBe(false);
  });

  it('allows only the application document and its fragments', () => {
    const applicationUrl = 'file:///C:/kil/dist/renderer/index.html';

    expect(isAllowedNavigation(applicationUrl, applicationUrl)).toBe(true);
    expect(isAllowedNavigation(`${applicationUrl}#main-content`, applicationUrl)).toBe(true);
    expect(isAllowedNavigation('https://example.com/', applicationUrl)).toBe(false);
    expect(isAllowedNavigation('file:///C:/kil/secret.txt', applicationUrl)).toBe(false);
    expect(isAllowedNavigation('not a url', applicationUrl)).toBe(false);
  });
});
