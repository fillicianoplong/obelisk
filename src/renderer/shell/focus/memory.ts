// The last focused control in each region, keyed by a stable string.
// The page entry is the editor element. The editor keeps the caret and selection.

export interface FocusMemory {
  readonly targets: Readonly<Record<string, string>>;
}

export function emptyFocusMemory(): FocusMemory {
  return { targets: {} };
}

export function rememberFocus(memory: FocusMemory, regionId: string, targetKey: string): FocusMemory {
  if (memory.targets[regionId] === targetKey) {
    return memory;
  }
  return { targets: { ...memory.targets, [regionId]: targetKey } };
}

export function recallFocus(memory: FocusMemory, regionId: string): string | null {
  const key = memory.targets[regionId];
  return key === undefined ? null : key;
}
