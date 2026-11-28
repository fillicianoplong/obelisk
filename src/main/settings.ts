import { preferencesStore, LEGACY_SETTINGS_FILE, preferencesFilePath } from './preferences/index.js';
import { parseThemeSetting, type ThemeSetting } from '../shared/theme.js';
import { viewFromSaved, type AppDocumentView } from '../shared/document-view.js';
import { zoomFromSaved, type ZoomPreset } from '../shared/zoom.js';
import { themeSettingFromStoredTheme } from './preferences/theme-pref.js';

// Legacy name kept for tests that still mention settings.json paths.
export const THEME_SETTINGS_FILE = LEGACY_SETTINGS_FILE;

export function themeSettingsPath(userDataDir: string): string {
  return preferencesFilePath(userDataDir);
}

export function themeSettingFromJson(text: string): ThemeSetting {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return parseThemeSetting(undefined);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return parseThemeSetting(undefined);
  }
  const record = parsed as Record<string, unknown>;
  if (!Object.hasOwn(record, 'theme')) {
    return parseThemeSetting(undefined);
  }
  return themeSettingFromStoredTheme(record.theme);
}

export function readThemeSetting(userDataDir: string): ThemeSetting {
  return preferencesStore(userDataDir).readThemeSetting();
}

export function readSpellingSetting(userDataDir: string): boolean {
  return preferencesStore(userDataDir).readSpelling();
}

export async function writeSpellingSetting(userDataDir: string, enabled: boolean): Promise<void> {
  await preferencesStore(userDataDir).applyEntry({ key: 'spelling', value: enabled });
}

export function readZoomSetting(userDataDir: string): ZoomPreset {
  return preferencesStore(userDataDir).readZoom();
}

export async function writeZoomSetting(userDataDir: string, zoom: number): Promise<void> {
  await preferencesStore(userDataDir).applyEntry({ key: 'zoom', value: zoomFromSaved(zoom) });
}

export function readViewSetting(userDataDir: string): AppDocumentView {
  return preferencesStore(userDataDir).readView();
}

export async function writeViewSetting(userDataDir: string, view: string): Promise<void> {
  await preferencesStore(userDataDir).applyEntry({ key: 'view', value: viewFromSaved(view) });
}