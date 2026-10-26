import { useLayoutEffect } from 'react';
import { applyDataTheme } from '../../../shared/theme.js';

// Confirms the theme the preload applied, then follows theme:changed.
// Match Windows clears data-theme so the system color scheme can show through.
export function ThemeSync() {
  useLayoutEffect(() => {
    let current = true;
    void window.obeliskTheme
      .get()
      .then((result) => {
        if (!current || result.status !== 'ok') {
          return;
        }
        applyDataTheme(document.documentElement, result.theme);
      })
      .catch(() => {
        // The preload already applied the theme for this frame.
      });
    const stop = window.obeliskTheme.onChanged((theme) => {
      applyDataTheme(document.documentElement, theme);
    });
    return () => {
      current = false;
      stop();
    };
  }, []);
  return null;
}
