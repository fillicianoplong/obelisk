import type { FontSizePt, ThemePreference } from '../../../shared/ipc/types.js';
import { FONT_SIZES_PT } from '../../../shared/schema/limits.js';

export interface PreferencesDraft {
  theme: ThemePreference;
  spelling: boolean;
  defaultFont: string;
  defaultSize: FontSizePt;
  restoreTabs: boolean;
  showPageEdges: boolean;
}

export const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'match-windows', label: 'Match Windows' },
];

export const FONT_SIZE_OPTIONS = FONT_SIZES_PT;