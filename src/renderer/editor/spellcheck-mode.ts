let enabled = true;

export const SPELLCHECK_RECHECK = 'obelisk:spellcheck-recheck';

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

// Detach and reinsert the page so Chromium spellchecks the text it already has.
function remountForSpellcheck(node: HTMLElement): void {
  const parent = node.parentNode;
  if (parent === null) {
    node.setAttribute('spellcheck', 'true');
    return;
  }
  const scroller = node.closest('.page-region');
  const top = scroller instanceof HTMLElement ? scroller.scrollTop : 0;
  const left = scroller instanceof HTMLElement ? scroller.scrollLeft : 0;
  const next = node.nextSibling;
  node.setAttribute('spellcheck', 'false');
  parent.removeChild(node);
  node.setAttribute('spellcheck', 'true');
  parent.insertBefore(node, next);
  if (scroller instanceof HTMLElement) {
    scroller.scrollTop = top;
    scroller.scrollLeft = left;
  }
}

export function setSpellcheckEnabled(value: boolean): void {
  const turningOn = value && !enabled;
  enabled = value;
  const sheets = pageSheets();
  if (!value) {
    for (const node of sheets) {
      node.setAttribute('spellcheck', 'false');
    }
    return;
  }
  if (!turningOn) {
    for (const node of sheets) {
      node.setAttribute('spellcheck', 'true');
    }
    return;
  }
  for (const node of sheets) {
    remountForSpellcheck(node);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SPELLCHECK_RECHECK));
  }
}
