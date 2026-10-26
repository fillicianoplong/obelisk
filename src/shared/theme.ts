import type { IpcErrorResult } from './ipc/errors.js';

export const THEME_SETTINGS = ['light', 'dark', 'system'] as const;

export type ThemeSetting = (typeof THEME_SETTINGS)[number];

export const DEFAULT_THEME_SETTING: ThemeSetting = 'system';

const THEME_SETTING_SET: ReadonlySet<string> = new Set(THEME_SETTINGS);

export function parseThemeSetting(value: unknown): ThemeSetting {
  if (typeof value === 'string' && THEME_SETTING_SET.has(value)) {
    return value as ThemeSetting;
  }
  return DEFAULT_THEME_SETTING;
}

// nativeTheme.themeSource uses the same three values. "system" is Match Windows.
export function themeSourceFor(theme: ThemeSetting): ThemeSetting {
  return theme;
}

// Match Windows leaves the attribute off so prefers-color-scheme can decide.
export function dataThemeAttribute(theme: ThemeSetting): 'light' | 'dark' | null {
  if (theme === 'system') {
    return null;
  }
  return theme;
}

export interface ThemeRoot {
  dataset: { theme?: string };
}

export function applyDataTheme(root: ThemeRoot, theme: ThemeSetting): void {
  const value = dataThemeAttribute(theme);
  if (value === null) {
    delete root.dataset.theme;
    return;
  }
  root.dataset.theme = value;
}

// Passed into the renderer before the page paints. The preload reads it
// synchronously; the page itself has no Node and does not see process.
export const THEME_ARG_PREFIX = '--obelisk-theme=';

export function themeLaunchArgument(theme: ThemeSetting): string {
  return `${THEME_ARG_PREFIX}${theme}`;
}

export function themeSettingFromArguments(argv: readonly string[]): ThemeSetting {
  let found: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith(THEME_ARG_PREFIX)) {
      found = arg.slice(THEME_ARG_PREFIX.length);
    }
  }
  if (found === undefined) {
    return DEFAULT_THEME_SETTING;
  }
  return parseThemeSetting(found);
}

// Separate from the architecture IPC table. Same allow-list rules: named
// channels only, checked before a handler runs.
export const THEME_GET_CHANNEL = 'theme:get';
export const THEME_CHANGED_CHANNEL = 'theme:changed';

export const THEME_CHANNELS = [THEME_GET_CHANNEL, THEME_CHANGED_CHANNEL] as const;

export type ThemeChannel = (typeof THEME_CHANNELS)[number];

const THEME_CHANNEL_SET: ReadonlySet<string> = new Set(THEME_CHANNELS);

export function isThemeChannel(channel: string): channel is ThemeChannel {
  return THEME_CHANNEL_SET.has(channel);
}

export interface ThemeChangedMessage {
  theme: ThemeSetting;
}

export function themeChangedMessage(theme: ThemeSetting): ThemeChangedMessage {
  return { theme };
}

export interface ThemeGetOk {
  status: 'ok';
  theme: ThemeSetting;
}

export function themeGetOk(theme: ThemeSetting): ThemeGetOk {
  return { status: 'ok', theme };
}

export interface ObeliskThemeApi {
  get(): Promise<ThemeGetOk | IpcErrorResult>;
  onChanged(listener: (theme: ThemeSetting) => void): () => void;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  if (present.length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.hasOwn(value, key));
}

export function parseThemeChangedMessage(value: unknown): ThemeSetting | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['theme'])) {
    return null;
  }
  if (typeof value.theme !== 'string' || !THEME_SETTING_SET.has(value.theme)) {
    return null;
  }
  return value.theme as ThemeSetting;
}

export function parseThemeGetOk(value: unknown): ThemeSetting | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['status', 'theme'])) {
    return null;
  }
  if (value.status !== 'ok') {
    return null;
  }
  if (typeof value.theme !== 'string' || !THEME_SETTING_SET.has(value.theme)) {
    return null;
  }
  return value.theme as ThemeSetting;
}
