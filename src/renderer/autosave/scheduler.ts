import type { AutosaveClock } from './clock.js';
import { AUTOSAVE_DELAY_MS } from './constants.js';

export interface AutosaveTimerTarget {
  revision: number;
}

export interface AutosaveSchedulerOptions {
  clock: AutosaveClock;
  delayMs?: number;
  onFire: (tabId: string, revision: number) => void;
}

export interface AutosaveScheduler {
  sync(tabId: string, target: AutosaveTimerTarget | null): void;
  cancel(tabId: string): void;
  cancelAll(): void;
}

export function createAutosaveScheduler(options: AutosaveSchedulerOptions): AutosaveScheduler {
  const delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
  const timers = new Map<string, { id: number; revision: number }>();

  function cancel(tabId: string) {
    const existing = timers.get(tabId);
    if (!existing) {
      return;
    }
    options.clock.clearTimeout(existing.id);
    timers.delete(tabId);
  }

  return {
    sync(tabId, target) {
      cancel(tabId);
      if (target === null) {
        return;
      }
      const revision = target.revision;
      const id = options.clock.setTimeout(() => {
        const pending = timers.get(tabId);
        if (!pending || pending.id !== id) {
          return;
        }
        timers.delete(tabId);
        options.onFire(tabId, revision);
      }, delayMs);
      timers.set(tabId, { id, revision });
    },
    cancel,
    cancelAll() {
      for (const tabId of [...timers.keys()]) {
        cancel(tabId);
      }
    },
  };
}
