import fs from 'node:fs';
import path from 'node:path';
import { parseThemeSetting, type ThemeSetting } from '../shared/theme.js';

// Temporary theme store. Settings (#60) replaces this module.
// The file is <userData>/settings.json and looks like { "theme": "system" }.
// "light", "dark", and "system" are the only values. Anything else, including
// a missing file, is Match Windows.
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
