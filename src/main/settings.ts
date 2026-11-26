import fs from 'node:fs';
import path from 'node:path';
import { parseThemeSetting, type ThemeSetting } from '../shared/theme.js';
import { viewFromSaved, type AppDocumentView } from '../shared/document-view.js';
import { zoomFromSaved, type ZoomPreset } from '../shared/zoom.js';

// The file is <userData>/settings.json.
// Theme values are "light", "dark", and "system". Anything else, including
// a missing file, is Match Windows. Spell check is on unless the file says false.
export const THEME_SETTINGS_FILE = 'settings.json';

export function themeSettingsPath(userDataDir: string): string {
  return path.join(userDataDir, THEME_SETTINGS_FILE);
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
  return parseThemeSetting(record.theme);
}

export function readThemeSetting(userDataDir: string): ThemeSetting {
  try {
    return themeSettingFromJson(fs.readFileSync(themeSettingsPath(userDataDir), 'utf8'));
  } catch {
    return parseThemeSetting(undefined);
  }
}

function readSettingsObject(userDataDir: string): Record<string, unknown> {
  try {
    const text = fs.readFileSync(themeSettingsPath(userDataDir), 'utf8');
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const parsed: unknown = JSON.parse(source);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // A missing or unreadable file keeps the defaults.
  }
  return {};
}

export function readSpellingSetting(userDataDir: string): boolean {
  const record = readSettingsObject(userDataDir);
  if (!Object.hasOwn(record, 'spelling')) {
    return true;
  }
  return record.spelling !== false;
}

export function writeSpellingSetting(userDataDir: string, enabled: boolean): void {
  const record = readSettingsObject(userDataDir);
  record.spelling = enabled;
  writeSettingsObject(userDataDir, record);
}

// Zoom is one value for the whole app. It is not stored in the document.
// A missing file, a missing key, or a value that is not a preset is 100%.
export function readZoomSetting(userDataDir: string): ZoomPreset {
  const record = readSettingsObject(userDataDir);
  if (!Object.hasOwn(record, 'zoom')) {
    return zoomFromSaved(undefined);
  }
  return zoomFromSaved(record.zoom);
}

export function writeZoomSetting(userDataDir: string, zoom: number): void {
  const record = readSettingsObject(userDataDir);
  record.zoom = zoomFromSaved(zoom);
  writeSettingsObject(userDataDir, record);
}

// Pages or Pageless is one value for the whole app. A new document starts there.
// A missing file, a missing key, or any other value is Pages.
export function readViewSetting(userDataDir: string): AppDocumentView {
  const record = readSettingsObject(userDataDir);
  if (!Object.hasOwn(record, 'view')) {
    return viewFromSaved(undefined);
  }
  return viewFromSaved(record.view);
}

export function writeViewSetting(userDataDir: string, view: string): void {
  const record = readSettingsObject(userDataDir);
  record.view = viewFromSaved(view);
  writeSettingsObject(userDataDir, record);
}

function writeSettingsObject(userDataDir: string, record: Record<string, unknown>): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(themeSettingsPath(userDataDir), `${JSON.stringify(record)}\n`, 'utf8');
}
