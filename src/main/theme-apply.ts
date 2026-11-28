import { BrowserWindow, systemPreferences, type NativeTheme } from 'electron';
import { themeChangedMessage, type ThemeSetting } from '../shared/theme.js';
import { THEME_CHANGED_CHANNEL } from '../shared/theme.js';
import { readSystemCaptionColors } from './window/caption.js';
import { activateThemeSource, applyFrame, frameForNativeTheme } from './window/theme.js';

export function applyThemeToApp(native: NativeTheme, theme: ThemeSetting, platform: NodeJS.Platform): void {
  activateThemeSource(native, theme);
  const frame = frameForNativeTheme(native, () => readSystemCaptionColors(platform, (name) => systemPreferences.getColor(name)));
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    applyFrame(window, frame, platform);
    window.webContents.send(THEME_CHANGED_CHANNEL, themeChangedMessage(theme));
  }
}