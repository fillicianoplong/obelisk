import { zoomFromArguments, type ZoomPreset } from '../shared/zoom.js';

export const ZOOM_BRIDGE_KEY = 'obeliskZoom';

export interface ZoomBridge {
  exposeInMainWorld(apiKey: string, api: unknown): void;
}

// The saved zoom is on the window before the page script runs, so the first
// paint already uses it.
export function installZoomBridge(bridge: ZoomBridge, argv: readonly string[]): ZoomPreset {
  const zoom = zoomFromArguments(argv);
  bridge.exposeInMainWorld(ZOOM_BRIDGE_KEY, zoom);
  return zoom;
}
