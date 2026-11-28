/// <reference types="vite/client" />

import type { ObeliskApi } from '../shared/ipc/api.js';
import type { ObeliskThemeApi } from '../shared/theme.js';
import type { AppDocumentView } from '../shared/document-view.js';
import type { ZoomPreset } from '../shared/zoom.js';

declare global {
  interface Window {
    obelisk: ObeliskApi;
    obeliskTheme: ObeliskThemeApi;
    obeliskZoom?: ZoomPreset;
    obeliskView?: AppDocumentView;
    obeliskE2e?: {
      openDocument?: boolean;
    };
  }
}
