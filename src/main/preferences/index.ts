export { PREFERENCES_FILE, LEGACY_SETTINGS_FILE, PREFERENCES_VERSION } from './constants.js';
export { type PreferencesRecord, defaultPreferences, DEFAULT_DEFAULT_FONT } from './defaults.js';
export { migrateFromLegacySettings } from './migrate.js';
export { preferencesStore, preferencesFilePath, PreferencesStore, clearPreferencesStoreCache } from './store.js';
export { parsePreferencesText, normalizePreferences } from './validate.js';
export { themePreferenceFromUnknown, themeSettingFromPreference, themePreferenceFromSetting } from './theme-pref.js';