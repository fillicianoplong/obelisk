import { tabHasUnsavedChanges } from '../shell/tabs/model.js';
import type { PageTab } from '../shell/tabs/model.js';
import { isAutosavePaused } from './model.js';

export function autosaveEligible(tab: PageTab): boolean {
  if (tab.kind === 'settings') {
    return false;
  }
  if (!tab.handle) {
    return false;
  }
  if (isAutosavePaused(tab)) {
    return false;
  }
  return tabHasUnsavedChanges(tab);
}
