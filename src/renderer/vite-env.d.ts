/// <reference types="vite/client" />

import type { ObeliskApi } from '../shared/ipc/api.js';
import type { ObeliskThemeApi } from '../shared/theme.js';

declare global {
  interface Window {
    obelisk: ObeliskApi;
    obeliskTheme: ObeliskThemeApi;
  }
}
