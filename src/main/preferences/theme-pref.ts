import type { ThemePreference } from '../../shared/ipc/types.js';
import { THEME_VALUES } from '../../shared/ipc/types.js';
import type { ThemeSetting } from '../../shared/theme.js';
import { DEFAULT_THEME_SETTING, parseThemeSetting } from '../../shared/theme.js';

const THEME_PREF_SET: ReadonlySet<string> = new Set(THEME_VALUES);

export function themePreferenceFromSetting(setting: ThemeSetting): ThemePreference {
  if (setting === 'system') {
    return 'match-windows';
  }
  return setting;
}

export function themeSettingFromPreference(preference: ThemePreference): ThemeSetting {
  if (preference === 'match-windows') {
    return 'system';
  }
  return preference;
}

export function themePreferenceFromUnknown(value: unknown): ThemePreference {
  if (typeof value === 'string' && value === 'system') {
    return 'match-windows';
  }
  if (typeof value === 'string' && THEME_PREF_SET.has(value)) {
    return value as ThemePreference;
  }
  const setting = parseThemeSetting(value);
  return themePreferenceFromSetting(setting);
}

export function themeSettingFromStoredTheme(value: unknown): ThemeSetting {
  return themeSettingFromPreference(themePreferenceFromUnknown(value));
}

export function defaultThemePreference(): ThemePreference {
  return themePreferenceFromSetting(DEFAULT_THEME_SETTING);
}