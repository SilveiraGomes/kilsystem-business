import { describe, expect, it } from 'vitest';

import { createDesktopApi } from '../apps/desktop/src/main/preload-api.cts';
import { createWindowOptions } from '../apps/desktop/src/main/window-options';

describe('Electron security baseline', () => {
  it('isolates the renderer and disables Node.js integration', () => {
    const options = createWindowOptions('C:/safe/preload.js');

    expect(options.webPreferences).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
});
