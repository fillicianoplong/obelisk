let enabled = true;
const listeners = new Set<(enabled: boolean) => void>();

export function whenSpellcheckChanges(handler: (enabled: boolean) => void): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

export function spellcheckEnabled(): boolean {
  return enabled;
}

function pageSheets(): HTMLElement[] {
  if (typeof document === 'undefined') {
    return [];
  }
  const nodes: HTMLElement[] = [];
  for (const node of document.querySelectorAll('.page-sheet')) {
    if (node instanceof HTMLElement) {
      nodes.push(node);
    }
  }
  return nodes;
}

// Chromium draws nothing. The app draws the underlines.
export function setSpellcheckEnabled(value: boolean): void {
  const changed = enabled !== value;
  enabled = value;
  for (const node of pageSheets()) {
    node.setAttribute('spellcheck', 'false');
  }
  if (!changed) {
    return;
  }
  for (const handler of listeners) {
    handler(value);
  }
}
