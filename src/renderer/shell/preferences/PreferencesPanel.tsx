import { useEffect, useId, useState, type FormEvent } from 'react';
import type { FontSizePt, PreferenceKey, ThemePreference } from '../../../shared/ipc/types.js';
import { BUNDLED_FONT_FAMILIES } from '../../../shared/fonts.js';
import { FONT_SIZE_OPTIONS, THEME_OPTIONS, type PreferencesDraft } from './model.js';
import './preferences.css';

interface PreferencesPanelProps {
  onShowPageEdgesChange?: (enabled: boolean) => void;
  onSpellingChange?: (enabled: boolean) => void;
}

async function readPref(key: PreferenceKey): Promise<unknown | null> {
  const result = await window.obelisk['prefs:get']({ key });
  if (result.status !== 'ok' || result.key !== key) {
    return null;
  }
  return result.value;
}

async function writePref(entry: { key: PreferenceKey; value: unknown }): Promise<boolean> {
  const result = await window.obelisk['prefs:set'](entry as never);
  return result.status === 'ok';
}

export function PreferencesPanel({ onShowPageEdgesChange, onSpellingChange }: PreferencesPanelProps) {
  const titleId = useId();
  const [draft, setDraft] = useState<PreferencesDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [theme, spelling, defaultFont, defaultSize, restoreTabs, showPageEdges] = await Promise.all([
        readPref('theme'),
        readPref('spelling'),
        readPref('defaultFont'),
        readPref('defaultSize'),
        readPref('restoreTabs'),
        readPref('showPageEdges'),
      ]);
      if (cancelled) {
        return;
      }
      if (
        theme === null ||
        spelling === null ||
        defaultFont === null ||
        defaultSize === null ||
        restoreTabs === null ||
        showPageEdges === null
      ) {
        setDraft(null);
        setLoaded(true);
        return;
      }
      setDraft({
        theme: theme as ThemePreference,
        spelling: spelling as boolean,
        defaultFont: defaultFont as string,
        defaultSize: defaultSize as FontSizePt,
        restoreTabs: restoreTabs as boolean,
        showPageEdges: showPageEdges as boolean,
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function commit<K extends keyof PreferencesDraft>(
    key: K,
    value: PreferencesDraft[K],
    after?: (value: PreferencesDraft[K]) => void,
  ): Promise<void> {
    setSaving(true);
    const ok = await writePref({ key: key as PreferenceKey, value });
    setSaving(false);
    if (!ok) {
      return;
    }
    setDraft((current) => (current === null ? current : { ...current, [key]: value }));
    after?.(value);
  }

  function onThemeChange(event: FormEvent<HTMLInputElement>): void {
    if (draft === null) {
      return;
    }
    const value = event.currentTarget.value as ThemePreference;
    void commit('theme', value);
  }

  if (draft === null) {
    return (
      <section
        className="preferences-panel"
        data-preferences={loaded ? 'error' : 'loading'}
        aria-labelledby={titleId}
      >
        <h1 className="preferences-title" id={titleId}>
          Settings
        </h1>
        <p className="preferences-hint">{loaded ? 'Preferences could not be loaded.' : 'Loading…'}</p>
      </section>
    );
  }

  return (
    <section
      className="preferences-panel"
      data-preferences=""
      aria-labelledby={titleId}
      aria-busy={saving ? 'true' : undefined}
    >
      <h1 className="preferences-title" id={titleId}>
        Settings
      </h1>
      <div className="preferences-grid">
        <fieldset className="preferences-fieldset">
          <legend className="preferences-legend">Theme</legend>
          <div className="preferences-options" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((option) => (
              <label key={option.value} className="preferences-option">
                <input
                  type="radio"
                  name="preferences-theme"
                  value={option.value}
                  checked={draft.theme === option.value}
                  onChange={onThemeChange}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="preferences-row">
          <span className="preferences-label" id={`${titleId}-spelling`}>
            Spelling
          </span>
          <label className="preferences-toggle">
            <input
              type="checkbox"
              checked={draft.spelling}
              aria-labelledby={`${titleId}-spelling`}
              onChange={(event) => {
                const value = event.currentTarget.checked;
                void commit('spelling', value, (next) => {
                  onSpellingChange?.(next);
                });
              }}
            />
            <span>{draft.spelling ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="preferences-row">
          <label className="preferences-label" htmlFor={`${titleId}-font`}>
            Default font
          </label>
          <select
            id={`${titleId}-font`}
            className="preferences-select"
            value={draft.defaultFont}
            onChange={(event) => {
              void commit('defaultFont', event.currentTarget.value);
            }}
          >
            {BUNDLED_FONT_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </div>

        <div className="preferences-row">
          <label className="preferences-label" htmlFor={`${titleId}-size`}>
            Default font size
          </label>
          <select
            id={`${titleId}-size`}
            className="preferences-select"
            value={draft.defaultSize}
            onChange={(event) => {
              const value = Number(event.currentTarget.value) as FontSizePt;
              void commit('defaultSize', value);
            }}
          >
            {FONT_SIZE_OPTIONS.map((pt) => (
              <option key={pt} value={pt}>
                {pt}
                {' pt'}
              </option>
            ))}
          </select>
        </div>

        <div className="preferences-row">
          <span className="preferences-label" id={`${titleId}-restore`}>
            Restore tabs on launch
          </span>
          <label className="preferences-toggle">
            <input
              type="checkbox"
              checked={draft.restoreTabs}
              aria-labelledby={`${titleId}-restore`}
              data-pref-extension="restore-tabs"
              onChange={(event) => {
                void commit('restoreTabs', event.currentTarget.checked);
              }}
            />
            <span>{draft.restoreTabs ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="preferences-row">
          <span className="preferences-label" id={`${titleId}-edges`}>
            Show page edges in Pages view
          </span>
          <label className="preferences-toggle">
            <input
              type="checkbox"
              checked={draft.showPageEdges}
              aria-labelledby={`${titleId}-edges`}
              onChange={(event) => {
                const value = event.currentTarget.checked;
                void commit('showPageEdges', value, (next) => {
                  onShowPageEdgesChange?.(next);
                });
              }}
            />
            <span>{draft.showPageEdges ? 'On' : 'Off'}</span>
          </label>
        </div>
      </div>
    </section>
  );
}