import type { Node as ProseNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { FlowUnit, PageBox, PageLayout } from './paginate.js';
import {
  letterPageBox,
  pageCountLabel,
  pageIndexAt,
  paginateFlow,
  sheetStackHeight,
} from './paginate.js';

export interface PageLayoutReport {
  pageCount: number;
  /** 1-based page that holds the caret. */
  page: number;
  label: string;
}

export interface PaginationHost {
  getMode: () => 'pages' | 'pageless';
  getBox: () => PageBox;
  onLayout: (report: PageLayoutReport) => void;
}

interface PaginationState {
  decorations: DecorationSet;
  signature: string;
  pageCount: number;
  page: number;
  label: string;
}

interface MeasureCache {
  doc: ProseNode;
  width: number;
  boxKey: string;
  units: FlowUnit[];
}

const paginationKey = new PluginKey<PaginationState>('pagination');

export function paginationPluginKey(): PluginKey<PaginationState> {
  return paginationKey;
}
const caches = new WeakMap<EditorView, MeasureCache>();

const EMPTY: PaginationState = {
  decorations: DecorationSet.empty,
  signature: '',
  pageCount: 1,
  page: 1,
  label: pageCountLabel(1, 1),
};

let heldCaretTop: number | null = null;

export function holdCaretAnchor(top: number): void {
  heldCaretTop = top;
}

export function takeCaretAnchor(): number | null {
  const top = heldCaretTop;
  heldCaretTop = null;
  return top;
}

export function paginationPlugin(host: PaginationHost): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init() {
        return EMPTY;
      },
      apply(tr, value) {
        const next = tr.getMeta(paginationKey) as PaginationState | undefined;
        if (next !== undefined) {
          return next;
        }
        if (tr.docChanged) {
          return {
            ...value,
            decorations: value.decorations.map(tr.mapping, tr.doc),
          };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
    view(editorView) {
      let frame = 0;
      let destroyed = false;
      const schedule = () => {
        if (destroyed || frame !== 0) {
          return;
        }
        const win = editorView.dom.ownerDocument.defaultView;
        if (win === null) {
          return;
        }
        frame = win.requestAnimationFrame(() => {
          frame = 0;
          if (!destroyed && !editorView.isDestroyed) {
            layoutPagination(editorView, host);
          }
        });
      };
      const observer = new ResizeObserver(() => {
        schedule();
      });
      observer.observe(editorView.dom);
      return {
        update(view, previous) {
          if (view.state.doc.eq(previous.doc) && view.state.selection.eq(previous.selection)) {
            return;
          }
          schedule();
        },
        destroy() {
          destroyed = true;
          observer.disconnect();
          const win = editorView.dom.ownerDocument.defaultView;
          if (frame !== 0 && win !== null) {
            win.cancelAnimationFrame(frame);
          }
          caches.delete(editorView);
        },
      };
    },
  });
}

export function layoutPagination(view: EditorView, host: PaginationHost): PageLayoutReport {
  if (view.isDestroyed) {
    return EMPTY;
  }
  const box = host.getBox();
  const mode = host.getMode();
  const width = Math.round(view.dom.clientWidth);
  if (width < 1) {
    return currentReport(view);
  }
  const boxKey = `${box.pageWidth}:${box.pageHeight}:${box.marginTop}:${box.marginRight}:${box.marginBottom}:${box.marginLeft}:${box.gap}`;
  const cached = caches.get(view);
  let units: FlowUnit[];
  if (
    cached !== undefined
    && cached.doc.eq(view.state.doc)
    && cached.width === width
    && cached.boxKey === boxKey
  ) {
    units = cached.units;
  } else {
    units = measureFlow(view);
    caches.set(view, { doc: view.state.doc, width, boxKey, units });
  }
  const layout = paginateFlow(units, box);
  const page = pageIndexAt(units, layout.unitPage, view.state.selection.head) + 1;
  const label = pageCountLabel(page, layout.pageCount);
  const signature = decorationSignature(mode, layout);
  const previous = paginationKey.getState(view.state) ?? EMPTY;
  applySheetBox(view, mode, box, layout.pageCount);
  const changed = previous.signature !== signature
    || previous.page !== page
    || previous.label !== label
    || previous.pageCount !== layout.pageCount;
  if (changed) {
    const decorations = previous.signature === signature
      ? previous.decorations
      : mode === 'pages'
        ? decorationsFor(view.state.doc, layout)
        : DecorationSet.empty;
    const next: PaginationState = {
      decorations,
      signature,
      pageCount: layout.pageCount,
      page,
      label,
    };
    view.dispatch(view.state.tr.setMeta(paginationKey, next));
    host.onLayout({ pageCount: layout.pageCount, page, label });
  }
  return { pageCount: layout.pageCount, page, label };
}

export function paginationSnapshot(view: EditorView): PageLayoutReport {
  return currentReport(view);
}

function currentReport(view: EditorView): PageLayoutReport {
  const state = paginationKey.getState(view.state);
  if (state === undefined) {
    return { pageCount: 1, page: 1, label: pageCountLabel(1, 1) };
  }
  return { pageCount: state.pageCount, page: state.page, label: state.label };
}

function decorationSignature(mode: 'pages' | 'pageless', layout: PageLayout): string {
  if (mode !== 'pages') {
    return `pageless:${layout.pageCount}`;
  }
  const parts = layout.spacers.map((spacer) => `${spacer.where}:${spacer.pos}:${Math.round(spacer.height)}`);
  return `pages:${layout.pageCount}:${parts.join('|')}`;
}

function decorationsFor(doc: ProseNode, layout: PageLayout): DecorationSet {
  const decorations = [];
  for (const spacer of layout.spacers) {
    if (spacer.height < 1 || spacer.pos < 0 || spacer.pos > doc.content.size) {
      continue;
    }
    if (spacer.where === 'break') {
      const node = doc.nodeAt(spacer.pos);
      if (node === null || node.type.name !== 'page_break') {
        continue;
      }
      decorations.push(Decoration.node(spacer.pos, spacer.pos + node.nodeSize, {
        style: `height: ${spacer.height}px`,
      }));
      continue;
    }
    const height = spacer.height;
    decorations.push(Decoration.widget(spacer.pos, () => spacerElement(height), {
      side: -1,
      ignoreSelection: true,
      key: `page-gap-${spacer.pos}-${Math.round(height)}`,
    }));
  }
  return DecorationSet.create(doc, decorations);
}

function spacerElement(height: number): HTMLElement {
  const element = document.createElement('span');
  element.className = 'page-flow-spacer';
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('aria-hidden', 'true');
  element.style.height = `${height}px`;
  return element;
}

function applySheetBox(view: EditorView, mode: 'pages' | 'pageless', box: PageBox, pageCount: number): void {
  const sheet = view.dom;
  const canvas = sheet.closest('.page-canvas');
  if (canvas instanceof HTMLElement) {
    canvas.style.setProperty('--page-pad-top', `${box.marginTop}px`);
    canvas.style.setProperty('--page-pad-right', `${box.marginRight}px`);
    canvas.style.setProperty('--page-pad-bottom', `${box.marginBottom}px`);
    canvas.style.setProperty('--page-pad-left', `${box.marginLeft}px`);
    if (mode === 'pages') {
      canvas.style.setProperty('--page-stack-height', `${sheetStackHeight(pageCount, box)}px`);
    } else {
      canvas.style.removeProperty('--page-stack-height');
    }
  }
  sheet.dataset.pageCount = String(pageCount);
}

interface RawUnit {
  kind: 'line' | 'page-break';
  pos: number;
  blockPos: number;
  top: number;
  bottom: number;
  startsBlock: boolean;
}

function measureFlow(view: EditorView): FlowUnit[] {
  const sheet = view.dom;
  sheet.classList.add('page-measuring');
  // Spacers and page-break gaps are hidden so line heights stay the unpaginated flow.
  void sheet.offsetHeight;
  let raw: RawUnit[];
  try {
    raw = collectRaw(view);
  } finally {
    sheet.classList.remove('page-measuring');
  }
  const style = view.dom.ownerDocument.defaultView?.getComputedStyle(sheet);
  const padTop = style === undefined ? 0 : Number.parseFloat(style.paddingTop) || 0;
  const contentTop = sheet.getBoundingClientRect().top + padTop;
  let cursor = contentTop;
  const units: FlowUnit[] = [];
  for (const item of raw) {
    if (item.kind === 'page-break') {
      units.push({
        kind: 'page-break',
        pos: item.pos,
        blockPos: item.blockPos,
        height: 0,
        startsBlock: true,
      });
      continue;
    }
    const bottom = item.bottom;
    const height = bottom <= cursor ? 0 : bottom - cursor;
    units.push({
      kind: 'line',
      pos: item.pos,
      blockPos: item.blockPos,
      height,
      startsBlock: item.startsBlock,
    });
    if (bottom > cursor) {
      cursor = bottom;
    }
  }
  return units;
}

function collectRaw(view: EditorView): RawUnit[] {
  const raw: RawUnit[] = [];
  const walk = (node: ProseNode, pos: number) => {
    if (node.type.name === 'page_break') {
      raw.push({
        kind: 'page-break',
        pos,
        blockPos: pos,
        top: 0,
        bottom: 0,
        startsBlock: true,
      });
      return;
    }
    if (node.isTextblock || node.isLeaf) {
      measureBlock(view, node, pos, raw);
      return;
    }
    node.forEach((child, offset) => {
      walk(child, pos + 1 + offset);
    });
  };
  view.state.doc.forEach((node, offset) => {
    walk(node, offset);
  });
  return raw;
}

function measureBlock(view: EditorView, node: ProseNode, pos: number, raw: RawUnit[]): void {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) {
    return;
  }
  const contentStart = pos + 1;
  const rects = lineRects(dom);
  if (rects.length === 0) {
    const box = dom.getBoundingClientRect();
    if (box.height <= 0) {
      return;
    }
    raw.push({
      kind: 'line',
      pos: node.isTextblock ? contentStart : pos,
      blockPos: pos,
      top: box.top,
      bottom: box.bottom,
      startsBlock: true,
    });
    return;
  }
  rects.forEach((rect, index) => {
    const at = index === 0
      ? (node.isTextblock ? contentStart : pos)
      : lineStart(view, rect, contentStart);
    raw.push({
      kind: 'line',
      pos: at,
      blockPos: pos,
      top: rect.top,
      bottom: rect.bottom,
      startsBlock: index === 0,
    });
  });
}

function lineRects(element: HTMLElement): DOMRect[] {
  const rects: DOMRect[] = [];
  const doc = element.ownerDocument;
  const range = doc.createRange();
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (text.textContent === null || text.textContent.length === 0) {
      continue;
    }
    if (text.parentElement?.closest('.page-flow-spacer')) {
      continue;
    }
    range.selectNodeContents(text);
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const last = rects[rects.length - 1];
      if (last !== undefined && Math.abs(last.top - rect.top) < 1) {
        const left = Math.min(last.left, rect.left);
        const top = Math.min(last.top, rect.top);
        const right = Math.max(last.right, rect.right);
        const bottom = Math.max(last.bottom, rect.bottom);
        rects[rects.length - 1] = new DOMRect(left, top, right - left, bottom - top);
      } else {
        rects.push(new DOMRect(rect.left, rect.top, rect.width, rect.height));
      }
    }
  }
  if (rects.length > 0) {
    return rects;
  }
  const box = element.getBoundingClientRect();
  if (box.height > 0) {
    return [new DOMRect(box.left, box.top, box.width, box.height)];
  }
  return [];
}

function lineStart(view: EditorView, rect: DOMRect, fallback: number): number {
  const x = rect.left + Math.min(2, Math.max(0, rect.width / 2));
  const y = rect.top + rect.height / 2;
  const doc = view.dom.ownerDocument;
  const range = typeof doc.caretRangeFromPoint === 'function' ? doc.caretRangeFromPoint(x, y) : null;
  if (range !== null) {
    try {
      const pos = view.posAtDOM(range.startContainer, range.startOffset);
      if (pos > 0) {
        return pos;
      }
    } catch {
      // The point missed the text. Fall through to the block start.
    }
  }
  const found = view.posAtCoords({ left: x, top: y });
  return found?.pos ?? fallback;
}

export function defaultPageBox(): PageBox {
  return letterPageBox();
}
