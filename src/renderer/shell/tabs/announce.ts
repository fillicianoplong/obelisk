const ANNOUNCER_ID = 'tab-strip-live';

function announcer(doc: Document): HTMLElement {
  const existing = doc.getElementById(ANNOUNCER_ID);
  if (existing instanceof HTMLElement) {
    return existing;
  }
  const node = doc.createElement('div');
  node.id = ANNOUNCER_ID;
  node.className = 'status-live';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('aria-atomic', 'true');
  doc.body.appendChild(node);
  return node;
}

export function announceTabMoved(view: Window, tabTitle: string, position: number, total: number): void {
  const node = announcer(view.document);
  const message = `${tabTitle} moved to position ${position} of ${total}`;
  node.textContent = '';
  view.requestAnimationFrame(() => {
    if (node.isConnected) {
      node.textContent = message;
    }
  });
}