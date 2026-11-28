import fs from 'node:fs';
import path from 'node:path';
import type { PreferenceEntry, PreferenceKey } from '../../shared/ipc/types.js';
import type { ThemeSetting } from '../../shared/theme.js';
import { writeAtomic } from '../file/writeAtomic.js';
import { PREFERENCES_FILE } from './constants.js';
import { type PreferencesRecord, defaultPreferences } from './defaults.js';
import { migrateFromLegacySettings } from './migrate.js';
import { parsePreferencesText, preferenceValue } from './validate.js';
import { themeSettingFromPreference, themeSettingFromStoredTheme } from './theme-pref.js';
import { viewFromSaved } from '../../shared/document-view.js';
import { zoomFromSaved, type ZoomPreset } from '../../shared/zoom.js';

function preferencesPath(userDataDir: string): string {
  return path.join(userDataDir, PREFERENCES_FILE);
}

export class PreferencesStore {
  private record: PreferencesRecord = defaultPreferences();
  private loaded = false;
  private persistPromise: Promise<void> | null = null;

  constructor(private readonly userDataDir: string) {}

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    const filePath = preferencesPath(this.userDataDir);
    try {
      if (fs.existsSync(filePath)) {
        this.record = parsePreferencesText(fs.readFileSync(filePath, 'utf8'));
      } else {
        this.record = migrateFromLegacySettings(this.userDataDir);
        this.persistPromise = this.persist();
      }
    } catch {
      this.record = defaultPreferences();
    }
    this.loaded = true;
  }

  snapshot(): PreferencesRecord {
    this.ensureLoaded();
    return { ...this.record };
  }

  getValue(key: PreferenceKey): PreferenceEntry['value'] {
    this.ensureLoaded();
    return preferenceValue(this.record, key) as PreferenceEntry['value'];
  }

  readThemeSetting(): ThemeSetting {
    this.ensureLoaded();
    return themeSettingFromStoredTheme(this.record.theme);
  }

  readSpelling(): boolean {
    return this.getValue('spelling') as boolean;
  }

  readZoom(): ZoomPreset {
    return zoomFromSaved(this.getValue('zoom'));
  }

  readView(): ReturnType<typeof viewFromSaved> {
    return viewFromSaved(this.getValue('view'));
  }

  async applyEntry(entry: PreferenceEntry): Promise<void> {
    this.ensureLoaded();
    const next = { ...this.record };
    switch (entry.key) {
      case 'theme':
        next.theme = entry.value;
        break;
      case 'spelling':
        next.spelling = entry.value;
        break;
      case 'defaultFont':
        next.defaultFont = entry.value;
        break;
      case 'defaultSize':
        next.defaultSize = entry.value;
        break;
      case 'restoreTabs':
        next.restoreTabs = entry.value;
        break;
      case 'showPageEdges':
        next.showPageEdges = entry.value;
        break;
      case 'zoom':
        next.zoom = entry.value;
        break;
      case 'view':
        next.view = entry.value;
        break;
      default:
        return;
    }
    this.record = next;
    this.persistPromise = this.persist();
    await this.persistPromise;
  }

  /** Waits for the first migrated preferences.json write to finish. */
  async whenPersisted(): Promise<void> {
    this.ensureLoaded();
    if (this.persistPromise !== null) {
      await this.persistPromise;
    }
  }

  themeSettingForPreference(): ThemeSetting {
    this.ensureLoaded();
    return themeSettingFromPreference(this.record.theme);
  }

  private async persist(): Promise<void> {
    const bytes = new TextEncoder().encode(`${JSON.stringify(this.record)}\n`);
    const result = await writeAtomic(preferencesPath(this.userDataDir), bytes, {
      kind: 'record',
      privateAppData: [this.userDataDir],
    });
    if (result.status !== 'ok') {
      const message = 'message' in result && typeof result.message === 'string'
        ? result.message
        : 'Preferences could not be saved.';
      throw new Error(message);
    }
  }
}

const stores = new Map<string, PreferencesStore>();

export function preferencesStore(userDataDir: string): PreferencesStore {
  let store = stores.get(userDataDir);
  if (store === undefined) {
    store = new PreferencesStore(userDataDir);
    stores.set(userDataDir, store);
  }
  return store;
}

export function preferencesFilePath(userDataDir: string): string {
  return preferencesPath(userDataDir);
}

/** Test-only: drop cached stores so a rewritten preferences file is read again. */
export function clearPreferencesStoreCache(): void {
  stores.clear();
}