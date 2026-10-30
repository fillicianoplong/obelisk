import type { PageTab } from '../shell/tabs/model.js';
import { autosaveEligible } from './eligibility.js';
import type { AutosaveScheduler } from './scheduler.js';

export function syncTabAutosave(scheduler: AutosaveScheduler, tab: PageTab): void {
  if (!autosaveEligible(tab)) {
    scheduler.cancel(tab.id);
    return;
  }
  scheduler.sync(tab.id, { revision: tab.revision });
}
