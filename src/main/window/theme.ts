import type { ThemeSetting } from '../../shared/theme.js';
import { themeChangedMessage, themeSourceFor, type ThemeChangedMessage } from '../../shared/theme.js';
import type { ContrastCaptionColors } from './caption.js';
import { frameColorsFor, type ShellFrameColors } from '../shell-theme.js';

export interface NativeThemeState {
  themeSource: ThemeSetting;
  readonly shouldUseDarkColors: boolean;
  readonly shouldUseHighContrastColors: boolean;
  readonly inForcedColorsMode?: boolean;
}

export function activateThemeSource(nativeTheme: { themeSource: ThemeSetting }, theme: ThemeSetting): void {
  nativeTheme.themeSource = themeSourceFor(theme);
}

// High contrast and Chromium forced colors both mean a Windows contrast theme.
// Either one is enough to repaint the caption buttons.
export function contrastThemeActive(nativeTheme: {
  shouldUseHighContrastColors: boolean;
  inForcedColorsMode?: boolean;
}): boolean {
  return nativeTheme.shouldUseHighContrastColors || nativeTheme.inForcedColorsMode === true;
}

export function frameForNativeTheme(
  nativeTheme: {
    shouldUseDarkColors: boolean;
    shouldUseHighContrastColors: boolean;
    inForcedColorsMode?: boolean;
  },
  readContrast: () => ContrastCaptionColors | null,
): ShellFrameColors {
  const highContrast = contrastThemeActive(nativeTheme);
  return frameColorsFor({
    highContrast,
    dark: nativeTheme.shouldUseDarkColors,
    contrast: highContrast ? readContrast() : null,
  });
}

export interface ThemeFrameTarget {
  setBackgroundColor(color: string): void;
  setTitleBarOverlay(options: { color: string; symbolColor: string }): void;
}

export function applyFrame(target: ThemeFrameTarget, frame: ShellFrameColors, platform: NodeJS.Platform): void {
  // The window background shows through as a line along the top, so it has to
  // match the caption strip. The buttons do not follow the page on their own.
  target.setBackgroundColor(frame.backgroundColor);
  if (platform === 'win32') {
    target.setTitleBarOverlay({
      color: frame.overlayColor,
      symbolColor: frame.symbolColor,
    });
  }
}

export interface ThemeUpdateSource {
  on(event: 'updated', listener: () => void): void;
  off(event: 'updated', listener: () => void): void;
}

export interface ThemeWindowLife {
  isDestroyed(): boolean;
  on(event: 'closed', listener: () => void): void;
}

export function watchThemeFrame(options: {
  nativeTheme: ThemeUpdateSource & {
    shouldUseDarkColors: boolean;
    shouldUseHighContrastColors: boolean;
    inForcedColorsMode?: boolean;
  };
  window: ThemeWindowLife & ThemeFrameTarget;
  platform: NodeJS.Platform;
  readContrast: () => ContrastCaptionColors | null;
  notify: (message: ThemeChangedMessage) => void;
  theme: ThemeSetting;
}): void {
  const onUpdated = () => {
    if (options.window.isDestroyed()) {
      return;
    }
    applyFrame(options.window, frameForNativeTheme(options.nativeTheme, options.readContrast), options.platform);
    options.notify(themeChangedMessage(options.theme));
  };
  options.nativeTheme.on('updated', onUpdated);
  options.window.on('closed', () => {
    options.nativeTheme.off('updated', onUpdated);
  });
}
