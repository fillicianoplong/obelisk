let enabled = true;

export function spellcheckEnabled(): boolean {
  return enabled;
}

export function setSpellcheckEnabled(value: boolean): void {
  enabled = value;
  if (typeof document === 'undefined') {
    return;
  }
  const flag = value ? 'true' : 'false';
  for (const node of document.querySelectorAll('.page-sheet')) {
    node.setAttribute('spellcheck', flag);
  }
}
