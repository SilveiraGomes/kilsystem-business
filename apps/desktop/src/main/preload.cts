import { contextBridge } from 'electron';

import { createDesktopApi } from './preload-api.cjs';

contextBridge.exposeInMainWorld('kilDesktop', createDesktopApi(process.platform));
