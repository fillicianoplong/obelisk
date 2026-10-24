/// <reference types="vite/client" />

import type { ObeliskApi } from '../shared/ipc/api.js';

declare global {
  interface Window {
    obelisk: ObeliskApi;
  }
}
