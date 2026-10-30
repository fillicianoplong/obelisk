export interface AutosaveClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export function createAutosaveClock(): AutosaveClock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (id) => {
      window.clearTimeout(id);
    },
  };
}

export interface FakeAutosaveClock extends AutosaveClock {
  advance(ms: number): void;
  pendingCount(): number;
}

export function createFakeAutosaveClock(startMs = 0): FakeAutosaveClock {
  let nowMs = startMs;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();

  function runDue() {
    for (const [id, timer] of [...timers.entries()]) {
      if (timer.at <= nowMs) {
        timers.delete(id);
        timer.callback();
      }
    }
  }

  return {
    now: () => nowMs,
    setTimeout: (callback, delayMs) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: nowMs + delayMs, callback });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    advance: (ms) => {
      nowMs += ms;
      runDue();
    },
    pendingCount: () => timers.size,
  };
}
