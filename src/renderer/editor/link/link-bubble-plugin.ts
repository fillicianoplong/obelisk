import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { watchOutsidePress } from '../../shell/outside-press.js';
import { requestShellCommand } from '../editor-command-event.js';
import { linkAround, removeLinkCommand } from './commands.js';

/**
 * Link bubble: a plain click on a link (or Alt+Enter with the caret on one) shows a
 * small bubble under it with the address, then Open, Edit and Remove.
 * The address and Open both open the link right away through the main-process allow-list.
 */
export interface LinkBubbleState {
  open: boolean;
  from: number;
  to: number;
  address: string;
  /** Alt+Enter opens with keyboard focus on Open. A click leaves focus in the text. */
  focus: 'open' | null;
  /** Bumped on each open, so the view knows to place and focus it again. */
  seq: number;
}

export const linkBubblePluginKey = new PluginKey<LinkBubbleState>('linkBubble');

const CLOSED: LinkBubbleState = { open: false, from: 0, to: 0, address: '', focus: null, seq: 0 };

/** Same delay as the grip tooltip. */
const TOOLTIP_HOVER_MS = 500;
const BUBBLE_GAP = 4;
const WINDOW_MARGIN = 8;

type ControlId = 'address' | 'open' | 'edit' | 'remove';

const CONTROL_LABELS: Readonly<Record<Exclude<ControlId, 'address'>, string>> = {
  open: 'Open link',
  edit: 'Edit link (Ctrl+K)',
  remove: 'Remove link',
};

const GLYPHS: Readonly<Record<'link' | Exclude<ControlId, 'address'>, readonly string[]>> = {
  link: ['M6.5 9.5l3-3', 'M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1', 'M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1'],
  open: ['M9.5 2.5h4v4', 'M13.5 2.5L8 8', 'M11.5 9.5v3a1 1 0 01-1 1h-7a1 1 0 01-1-1v-7a1 1 0 011-1h3'],
  edit: ['M10.5 2.5l3 3-8 8h-3v-3z', 'M9 4l3 3'],
  remove: ['M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1', 'M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1', 'M2.5 2.5l11 11'],
};

export function linkBubbleState(state: EditorState): LinkBubbleState {
  return linkBubblePluginKey.getState(state) ?? CLOSED;
}

/** Shows the host and the last path part with … between, and drops https://. */
export function shortLinkAddress(address: string, max = 32): string {
  const shown = address.replace(/^https:\/\//i, '').replace(/^mailto:/i, '');
  if (shown.length <= max) {
    return shown;
  }
  const slash = shown.indexOf('/');
  if (slash > 0) {
    const host = shown.slice(0, slash);
    const last = shown.slice(shown.lastIndexOf('/') + 1);
    const short = `${host}/…/${last}`;
    if (last.length > 0 && short.length <= max) {
      return short;
    }
  }
  const keep = max - 1;
  return `${shown.slice(0, Math.ceil(keep / 2))}…${shown.slice(shown.length - Math.floor(keep / 2))}`;
}

/**
 * Opens the bubble on the link around the caret, or returns null when there is none.
 * A click passes the clicked position, which also becomes the caret: the click event
 * can arrive before the editor has read the new selection from the page.
 */
export function openLinkBubble(state: EditorState, focus: 'open' | null, at?: number): Transaction | null {
  let tr = state.tr;
  let probe = state;
  if (at !== undefined) {
    if (at < 0 || at > state.doc.content.size) {
      return null;
    }
    const caret = TextSelection.create(state.doc, at);
    tr = tr.setSelection(caret);
    probe = state.apply(state.tr.setSelection(caret));
  }
  if (!probe.selection.empty) {
    return null;
  }
  const link = linkAround(probe);
  if (link === null) {
    return null;
  }
  const seq = linkBubbleState(state).seq + 1;
  return tr.setMeta(linkBubblePluginKey, {
    open: true,
    from: link.from,
    to: link.to,
    address: link.address,
    focus,
    seq,
  } satisfies LinkBubbleState);
}

function closeLinkBubble(tr: Transaction, state: EditorState): Transaction {
  return tr.setMeta(linkBubblePluginKey, { ...CLOSED, seq: linkBubbleState(state).seq });
}

export function closeLinkBubbleCommand(): Command {
  return (state, dispatch) => {
    if (!linkBubbleState(state).open) {
      return false;
    }
    dispatch?.(closeLinkBubble(state.tr, state));
    return true;
  };
}

/** Alt+Enter on a link shows the bubble with focus on Open. */
export function openLinkBubbleFromKeyboardCommand(): Command {
  return (state, dispatch) => {
    const tr = openLinkBubble(state, 'open');
    if (tr === null) {
      return false;
    }
    dispatch?.(tr);
    return true;
  };
}

export function linkBubbleKeymap(): Record<string, Command> {
  return {
    Escape: closeLinkBubbleCommand(),
    'Alt-Enter': openLinkBubbleFromKeyboardCommand(),
  };
}

function glyph(doc: Document, name: keyof typeof GLYPHS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('link-bubble-glyph');
  for (const d of GLYPHS[name]) {
    const path = doc.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

interface BubbleDom {
  root: HTMLElement;
  tooltip: HTMLElement;
  addressText: HTMLElement;
  controls: Map<ControlId, HTMLButtonElement>;
}

function createBubble(doc: Document): BubbleDom {
  const root = doc.createElement('div');
  root.className = 'link-bubble';
  // The dialog role is set only while it shows, so a hidden bubble never reads as an open dialog.
  root.setAttribute('aria-label', 'Link');
  root.setAttribute('data-region', 'link-bubble');
  root.hidden = true;
  const controls = new Map<ControlId, HTMLButtonElement>();

  const address = doc.createElement('button');
  address.type = 'button';
  address.className = 'link-bubble-address';
  address.dataset.control = 'address';
  const addressText = doc.createElement('span');
  addressText.className = 'link-bubble-address-text';
  address.append(glyph(doc, 'link'), addressText);
  controls.set('address', address);

  const divider = doc.createElement('span');
  divider.className = 'link-bubble-divider';
  divider.setAttribute('aria-hidden', 'true');
  root.append(address, divider);

  for (const id of ['open', 'edit', 'remove'] as const) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'link-bubble-button';
    button.dataset.control = id;
    button.setAttribute('aria-label', CONTROL_LABELS[id]);
    button.append(glyph(doc, id));
    controls.set(id, button);
    root.append(button);
  }

  const tooltip = doc.createElement('div');
  tooltip.className = 'link-bubble-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.id = `link-bubble-tooltip-${Math.random().toString(36).slice(2)}`;
  tooltip.hidden = true;
  return { root, tooltip, addressText, controls };
}

function linkRect(view: EditorView, bubble: LinkBubbleState): { left: number; top: number; bottom: number } | null {
  let caret: { top: number; bottom: number } | null = null;
  try {
    caret = view.coordsAtPos(view.state.selection.head);
  } catch {
    caret = null;
  }
  try {
    const at = view.domAtPos(Math.min(bubble.from + 1, bubble.to));
    const node = at.node.nodeType === 1 ? at.node as Element : at.node.parentElement;
    const anchor = node?.closest('a.editor-link') ?? null;
    if (anchor !== null) {
      const rects = [...anchor.getClientRects()];
      const line = caret === null
        ? undefined
        : rects.find((rect) => rect.top <= caret.bottom && rect.bottom >= caret.top);
      const rect = line ?? rects[0];
      if (rect !== undefined) {
        return { left: rect.left, top: rect.top, bottom: rect.bottom };
      }
    }
  } catch {
    // Fall back to the link's first character.
  }
  try {
    const start = view.coordsAtPos(bubble.from);
    return { left: start.left, top: start.top, bottom: start.bottom };
  } catch {
    return null;
  }
}

export function linkBubblePlugin(): Plugin {
  return new Plugin({
    key: linkBubblePluginKey,
    state: {
      init(): LinkBubbleState {
        return CLOSED;
      },
      apply(tr, value): LinkBubbleState {
        const meta = tr.getMeta(linkBubblePluginKey) as LinkBubbleState | undefined;
        if (meta !== undefined) {
          return meta;
        }
        if (!value.open) {
          return value;
        }
        // Typing, or any other change, closes it.
        if (tr.docChanged) {
          return { ...CLOSED, seq: value.seq };
        }
        if (tr.selectionSet) {
          const { selection } = tr;
          if (!selection.empty || selection.from < value.from || selection.from > value.to) {
            return { ...CLOSED, seq: value.seq };
          }
        }
        return value;
      },
    },
    view(editorView) {
      const doc = editorView.dom.ownerDocument;
      const win = doc.defaultView;
      const dom = createBubble(doc);
      const mount = editorView.dom.parentElement ?? doc.body;
      mount.append(dom.root, dom.tooltip);
      let shownSeq = -1;
      let tooltipTimer: number | null = null;

      const order: ControlId[] = ['address', 'open', 'edit', 'remove'];

      const hideTooltip = (): void => {
        if (tooltipTimer !== null) {
          win?.clearTimeout(tooltipTimer);
          tooltipTimer = null;
        }
        dom.tooltip.hidden = true;
        for (const control of dom.controls.values()) {
          control.removeAttribute('aria-describedby');
        }
      };

      const showTooltip = (id: ControlId, immediate: boolean): void => {
        hideTooltip();
        const reveal = (): void => {
          tooltipTimer = null;
          const bubble = linkBubbleState(editorView.state);
          if (!bubble.open || dom.root.hidden) {
            return;
          }
          const control = dom.controls.get(id);
          if (control === undefined) {
            return;
          }
          dom.tooltip.textContent = id === 'address' ? bubble.address : CONTROL_LABELS[id];
          dom.tooltip.hidden = false;
          control.setAttribute('aria-describedby', dom.tooltip.id);
          const box = dom.root.getBoundingClientRect();
          const at = control.getBoundingClientRect();
          const tip = dom.tooltip.getBoundingClientRect();
          const width = win?.innerWidth ?? box.right + tip.width;
          const left = Math.max(WINDOW_MARGIN, Math.min(at.left, width - tip.width - WINDOW_MARGIN));
          dom.tooltip.style.setProperty('--link-tooltip-left', `${Math.round(left)}px`);
          dom.tooltip.style.setProperty('--link-tooltip-top', `${Math.round(box.bottom + BUBBLE_GAP)}px`);
        };
        if (immediate || win === null) {
          reveal();
          return;
        }
        tooltipTimer = win.setTimeout(reveal, TOOLTIP_HOVER_MS);
      };

      const place = (): void => {
        const bubble = linkBubbleState(editorView.state);
        if (!bubble.open) {
          return;
        }
        const rect = linkRect(editorView, bubble);
        const viewWidth = win?.innerWidth ?? 0;
        const viewHeight = win?.innerHeight ?? 0;
        if (rect === null || (viewHeight > 0 && (rect.bottom < 0 || rect.top > viewHeight))) {
          // The link scrolled out of view.
          dom.root.hidden = true;
          dom.root.removeAttribute('role');
          hideTooltip();
          return;
        }
        dom.root.hidden = false;
        dom.root.setAttribute('role', 'dialog');
        const box = dom.root.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + BUBBLE_GAP;
        if (viewWidth > 0) {
          left = Math.max(WINDOW_MARGIN, Math.min(left, viewWidth - box.width - WINDOW_MARGIN));
        }
        if (viewHeight > 0 && top + box.height > viewHeight - WINDOW_MARGIN) {
          top = Math.max(WINDOW_MARGIN, rect.top - BUBBLE_GAP - box.height);
        }
        dom.root.style.setProperty('--link-bubble-left', `${Math.round(left)}px`);
        dom.root.style.setProperty('--link-bubble-top', `${Math.round(top)}px`);
      };

      const close = (refocus: boolean): void => {
        hideTooltip();
        if (!editorView.isDestroyed && linkBubbleState(editorView.state).open) {
          editorView.dispatch(closeLinkBubble(editorView.state.tr, editorView.state));
        }
        if (refocus && !editorView.isDestroyed) {
          editorView.focus();
        }
      };

      const run = (id: ControlId): void => {
        const bubble = linkBubbleState(editorView.state);
        if (!bubble.open) {
          return;
        }
        if (id === 'address' || id === 'open') {
          close(true);
          // The shell hands this address to the main process, which opens only allowed links.
          requestShellCommand('link-open', win, bubble.address);
          return;
        }
        if (id === 'edit') {
          close(true);
          requestShellCommand('link-edit', win);
          return;
        }
        close(true);
        removeLinkCommand()(editorView.state, editorView.dispatch);
      };

      const render = (): void => {
        const bubble = linkBubbleState(editorView.state);
        if (!bubble.open) {
          if (!dom.root.hidden) {
            const active = doc.activeElement;
            const hadFocus = active instanceof Node && dom.root.contains(active);
            dom.root.hidden = true;
            dom.root.removeAttribute('role');
            hideTooltip();
            if (hadFocus && !editorView.isDestroyed) {
              editorView.focus();
            }
          }
          return;
        }
        dom.addressText.textContent = shortLinkAddress(bubble.address);
        dom.controls.get('address')?.setAttribute('aria-label', `Open ${bubble.address}`);
        place();
        if (bubble.seq !== shownSeq) {
          shownSeq = bubble.seq;
          hideTooltip();
          if (bubble.focus === 'open' && !dom.root.hidden) {
            dom.controls.get('open')?.focus();
            showTooltip('open', true);
          }
        }
      };

      // A pointer press inside the bubble keeps focus and the caret in the text.
      dom.root.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
      dom.root.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-control]') : null;
        const id = target instanceof HTMLElement ? target.dataset.control as ControlId | undefined : undefined;
        if (id !== undefined && event.button === 0) {
          run(id);
        }
      });
      dom.root.addEventListener('keydown', (event) => {
        const active = doc.activeElement;
        const current = active instanceof HTMLElement ? order.indexOf(active.dataset.control as ControlId) : -1;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && current >= 0) {
          event.preventDefault();
          event.stopPropagation();
          const id = order[current];
          if (id !== undefined) {
            run(id);
          }
          return;
        }
        const step = event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)
          ? 1
          : event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey) ? -1 : 0;
        if (step !== 0) {
          event.preventDefault();
          event.stopPropagation();
          const next = order[((current < 0 ? 0 : current + step) + order.length) % order.length];
          if (next !== undefined) {
            dom.controls.get(next)?.focus();
          }
        }
      });
      for (const [id, control] of dom.controls) {
        control.addEventListener('mouseenter', () => {
          showTooltip(id, false);
        });
        control.addEventListener('mouseleave', hideTooltip);
        control.addEventListener('focus', () => {
          showTooltip(id, true);
        });
        control.addEventListener('blur', hideTooltip);
      }

      const stopOutsidePress = watchOutsidePress(win ?? doc, {
        isOpen: () => linkBubbleState(editorView.state).open,
        isInside: (target) => target !== null && dom.root.contains(target),
        onOutside() {
          close(false);
        },
      });
      const onScrollOrResize = (): void => {
        if (linkBubbleState(editorView.state).open) {
          hideTooltip();
          place();
        }
      };
      win?.addEventListener('scroll', onScrollOrResize, true);
      win?.addEventListener('resize', onScrollOrResize);

      render();
      return {
        update(view, prevState) {
          if (linkBubbleState(view.state) !== linkBubbleState(prevState) || view.state.doc !== prevState.doc) {
            render();
          }
        },
        destroy() {
          hideTooltip();
          stopOutsidePress();
          win?.removeEventListener('scroll', onScrollOrResize, true);
          win?.removeEventListener('resize', onScrollOrResize);
          dom.root.remove();
          dom.tooltip.remove();
        },
      };
    },
  });
}
