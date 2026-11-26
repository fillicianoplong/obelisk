import { viewFromArguments, type AppDocumentView } from '../shared/document-view.js';

export const VIEW_BRIDGE_KEY = 'obeliskView';

export interface ViewBridge {
  exposeInMainWorld(apiKey: string, api: unknown): void;
}

// The saved view is on the window before the page script runs, so the first
// paint already uses it.
export function installViewBridge(bridge: ViewBridge, argv: readonly string[]): AppDocumentView {
  const view = viewFromArguments(argv);
  bridge.exposeInMainWorld(VIEW_BRIDGE_KEY, view);
  return view;
}
