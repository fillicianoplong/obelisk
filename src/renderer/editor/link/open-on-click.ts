import { classifyLinkAddress } from '../../../shared/links/address.js';

/** The parts of a click that decide whether it opens a link. */
export interface LinkClick {
  target: EventTarget | null;
  button: number;
  detail: number;
  shiftKey: boolean;
  altKey: boolean;
}

function linkElement(target: EventTarget | null): Element | null {
  if (target === null || typeof (target as Node).nodeType !== 'number') {
    return null;
  }
  const node = target as Node;
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  return element?.closest('a.editor-link[data-href]') ?? null;
}

/** True when the event is on a link, so the browser must not follow it. */
export function eventTargetsLink(event: { target: EventTarget | null }): boolean {
  const target = event.target;
  if (target === null || typeof (target as Node).nodeType !== 'number') {
    return false;
  }
  const node = target as Node;
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  return element?.closest('a.editor-link, [data-link], a[data-href]') != null;
}

export interface LinkClickAction {
  /** 'open' goes straight to the Open link prompt. 'bubble' shows the link bubble. */
  kind: 'open' | 'bubble';
  address: string;
}

/**
 * What a click on a link does. A plain click shows the link bubble.
 * Ctrl+click (Cmd+click on a Mac) goes straight to the Open link prompt, even when
 * the click selected the block. Drags, double clicks, Shift, Alt and other buttons do nothing.
 */
export function linkClickAction(
  event: LinkClick & { ctrlKey?: boolean; metaKey?: boolean },
  selectionEmpty: boolean,
): LinkClickAction | null {
  const modified = event.ctrlKey === true || event.metaKey === true;
  const address = linkClickAddress(event, modified || selectionEmpty);
  if (address === null) {
    return null;
  }
  return { kind: modified ? 'open' : 'bubble', address };
}

/**
 * The address a plain click on a link should offer to open, or null.
 * Only a single left click with a collapsed caret counts, with or without Ctrl.
 * A drag that selects text, a double click that selects a word, Shift+click that
 * extends the selection, and Alt+click are left alone.
 */
export function linkClickAddress(event: LinkClick, selectionEmpty: boolean): string | null {
  if (event.button !== 0 || event.detail > 1 || event.shiftKey || event.altKey || !selectionEmpty) {
    return null;
  }
  const link = linkElement(event.target);
  const address = link?.getAttribute('data-href') ?? '';
  if (address.length === 0) {
    return null;
  }
  const checked = classifyLinkAddress(address);
  return checked.ok ? checked.address : null;
}
