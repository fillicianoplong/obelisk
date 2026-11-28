import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_SETTINGS_FILE } from './constants.js';
import { type PreferencesRecord, defaultPreferences } from './defaults.js';
import { normalizePreferences } from './validate.js';
import { themePreferenceFromUnknown } from './theme-pref.js';

function readLegacySettingsObject(userDataDir: string): Record<string, unknown> | null {
  const legacyPath = path.join(userDataDir, LEGACY_SETTINGS_FILE);
  try {
    const text = fs.readFileSync(legacyPath, 'utf8');
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const parsed: unknown = JSON.parse(source);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // Missing or unreadable legacy file keeps defaults.
  }
  return null;
}

/** One-time lift from settings.json when preferences.json is not present yet. */
export function migrateFromLegacySettings(userDataDir: string): PreferencesRecord {
  const legacy = readLegacySettingsObject(userDataDir);
  const base = defaultPreferences();
  if (legacy === null) {
    return base;
  }
  const merged: Record<string, unknown> = {
    version: base.version,
    theme: themePreferenceFromUnknown(legacy.theme ?? base.theme),
    spelling: legacy.spelling ?? base.spelling,
    defaultFont: legacy.defaultFont ?? base.defaultFont,
    defaultSize: legacy.defaultSize ?? base.defaultSize,
    restoreTabs: legacy.restoreTabs ?? base.restoreTabs,
    showPageEdges: legacy.showPageEdges ?? base.showPageEdges,
    zoom: legacy.zoom ?? base.zoom,
    view: legacy.view ?? base.view,
  };
  return normalizePreferences(merged);
}