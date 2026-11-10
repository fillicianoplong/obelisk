import type { PageTab } from '../shell/tabs/model.js';

export function isAutosavePaused(tab: PageTab): boolean {
  return tab.autosavePaused === true;
}

export function pauseAutosave(tab: PageTab): PageTab {
  if (tab.autosavePaused === true) {
    return tab;
  }
  return { ...tab, autosavePaused: true };
}

export function resumeAutosave(tab: PageTab): PageTab {
  if (tab.autosavePaused !== true) {
    return tab;
  }
  return { ...tab, autosavePaused: false };
}
