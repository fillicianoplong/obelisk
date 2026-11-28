import { viewFromSaved } from '../../shared/document-view.js';
import { isBundledFontFamily } from '../../shared/fonts.js';
import type { FontSizePt, PreferenceKey, ThemePreference } from '../../shared/ipc/types.js';
import { FONT_SIZES_PT } from '../../shared/schema/limits.js';
import { zoomFromSaved, type ZoomPreset } from '../../shared/zoom.js';
import { type PreferencesRecord, defaultPreferences } from './defaults.js';
import { themePreferenceFromUnknown } from './theme-pref.js';

const FONT_SIZE_SET: ReadonlySet<number> = new Set(FONT_SIZES_PT);

function booleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function fontSizeField(value: unknown, fallback: FontSizePt): FontSizePt {
  if (typeof value === 'number' && FONT_SIZE_SET.has(value)) {
    return value as FontSizePt;
  }
  return fallback;
}

function fontFamilyField(value: unknown, fallback: string): string {
  if (typeof value === 'string' && isBundledFontFamily(value)) {
    return value;
  }
  return fallback;
}

function zoomField(value: unknown, fallback: ZoomPreset): ZoomPreset {
  return zoomFromSaved(value ?? fallback);
}

export function normalizePreferences(source: Record<string, unknown> | null): PreferencesRecord {
  const defaults = defaultPreferences();
  if (source === null) {
    return defaults;
  }
  const version = typeof source.version === 'number' && Number.isInteger(source.version) && source.version >= 1
    ? source.version
    : defaults.version;
  const theme: ThemePreference = themePreferenceFromUnknown(source.theme ?? defaults.theme);
  return {
    version,
    theme,
    spelling: booleanField(source.spelling, defaults.spelling),
    defaultFont: fontFamilyField(source.defaultFont, defaults.defaultFont),
    defaultSize: fontSizeField(source.defaultSize, defaults.defaultSize as FontSizePt),
    restoreTabs: booleanField(source.restoreTabs, defaults.restoreTabs),
    showPageEdges: booleanField(source.showPageEdges, defaults.showPageEdges),
    zoom: zoomField(source.zoom, defaults.zoom as ZoomPreset),
    view: viewFromSaved(source.view ?? defaults.view),
  };
}

export function parsePreferencesText(text: string): PreferencesRecord {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return defaultPreferences();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return defaultPreferences();
  }
  return normalizePreferences(parsed as Record<string, unknown>);
}

export function preferenceValue(record: PreferencesRecord, key: PreferenceKey): unknown {
  switch (key) {
    case 'theme':
      return record.theme;
    case 'spelling':
      return record.spelling;
    case 'defaultFont':
      return record.defaultFont;
    case 'defaultSize':
      return record.defaultSize;
    case 'restoreTabs':
      return record.restoreTabs;
    case 'showPageEdges':
      return record.showPageEdges;
    case 'zoom':
      return record.zoom;
    case 'view':
      return record.view;
    default:
      return undefined;
  }
}

export function defaultForKey(key: PreferenceKey): unknown {
  const defaults = defaultPreferences();
  return preferenceValue(defaults, key);
}