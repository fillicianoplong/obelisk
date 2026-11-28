import type { PreferenceEntry, PreferenceKey, PrefsGetRequest, PrefsGetResult, PrefsSetResult } from '../../shared/ipc/types.js';
import { ipcError } from '../../shared/ipc/errors.js';
import type { ThemeSetting } from '../../shared/theme.js';
import { preferencesStore } from '../preferences/store.js';
import { sessionStore } from '../session/store.js';
import { themeSettingFromPreference } from '../preferences/theme-pref.js';

export interface PrefsHandlerOptions {
  userData: () => string;
  onThemeChanged?: (theme: ThemeSetting) => void;
}

function okGet(entry: PreferenceEntry): PrefsGetResult {
  return { status: 'ok', ...entry };
}

export function handlePrefsGet(request: PrefsGetRequest, options: PrefsHandlerOptions): PrefsGetResult {
  const store = preferencesStore(options.userData());
  const value = store.getValue(request.key);
  return okGet({ key: request.key, value } as PreferenceEntry);
}

export async function handlePrefsSet(entry: PreferenceEntry, options: PrefsHandlerOptions): Promise<PrefsSetResult> {
  const store = preferencesStore(options.userData());
  const beforeTheme = store.themeSettingForPreference();
  try {
    await store.applyEntry(entry);
  } catch {
    return ipcError('EBUSY_EXHAUSTED', 'Preferences could not be saved.');
  }
  if (entry.key === 'theme') {
    const theme = themeSettingFromPreference(entry.value);
    if (theme !== beforeTheme) {
      options.onThemeChanged?.(theme);
    }
  }
  if (entry.key === 'restoreTabs' && entry.value === false) {
    try {
      await sessionStore(options.userData()).clear();
    } catch {
      return ipcError('EBUSY_EXHAUSTED', 'The session could not be cleared.');
    }
  }
  return { status: 'ok' };
}

export function readPreferenceKey(userDataDir: string, key: PreferenceKey): PreferenceEntry['value'] {
  return preferencesStore(userDataDir).getValue(key);
}