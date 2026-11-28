import { DEFAULT_DOCUMENT_VIEW } from '../../shared/document-view.js';
import type { ThemePreference } from '../../shared/ipc/types.js';
import { DEFAULT_FONT_SIZE_PT } from '../../shared/schema/limits.js';
import { DEFAULT_ZOOM } from '../../shared/zoom.js';
import { PREFERENCES_VERSION } from './constants.js';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'match-windows';
export const DEFAULT_DEFAULT_FONT = 'Liberation Serif';

export interface PreferencesRecord {
  version: number;
  theme: ThemePreference;
  spelling: boolean;
  defaultFont: string;
  defaultSize: number;
  restoreTabs: boolean;
  showPageEdges: boolean;
  zoom: number;
  view: string;
}

export function defaultPreferences(): PreferencesRecord {
  return {
    version: PREFERENCES_VERSION,
    theme: DEFAULT_THEME_PREFERENCE,
    spelling: true,
    defaultFont: DEFAULT_DEFAULT_FONT,
    defaultSize: DEFAULT_FONT_SIZE_PT,
    restoreTabs: false,
    showPageEdges: true,
    zoom: DEFAULT_ZOOM,
    view: DEFAULT_DOCUMENT_VIEW,
  };
}