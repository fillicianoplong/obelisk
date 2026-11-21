let enabled = true;

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

// Chromium only spellchecks text as it is typed. The checker stays on, and
// Tools > Spell check hides or shows the underlines.
export function setSpellcheckEnabled(value: boolean): void {
  enabled = value;
  for (const node of pageSheets()) {
    node.setAttribute('spellcheck', 'true');
    if (value) {
      node.removeAttribute('data-spell-hidden');
    } else {
      node.setAttribute('data-spell-hidden', '');
    }
  }
}
