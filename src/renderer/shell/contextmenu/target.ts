import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { blockHandleState, blockIndexAtPos, dropIndexFromClientY } from '../../editor/block-handle-plugin.js';
import { posAtCoordsForEditor } from '../../editor/layout/page-pointer.js';
import { linkAround } from '../../editor/link/commands.js';
import type { ContextTargetKind } from './model.js';

export type ContextBlockType =
  | 'paragraph'
  | 'heading'
  | 'bulleted-list'
  | 'numbered-list'
  | 'checklist'
  | 'quote'
  | 'code'
  | 'divider'
  | 'page-break'
  | string;

export interface ContextMenuTarget {
  kind: ContextTargetKind;
  blockType: ContextBlockType;
  blockIndex: number | null;
  clientX: number;
  clientY: number;
  keyboard: boolean;
  selectionAnchor: number;
  selectionHead: number;
}

const FOREIGN_KIND: Record<string, ContextTargetKind> = {
  table: 'table-cell',
  image: 'image',
  equation: 'equation-block',
  column: 'column-row',
  drawing: 'drawing-pad',
  diagram: 'diagram',
  signature: 'signature',
};

const TEXT_CONTENT_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, pre, li';

function foreignKind(blockType: string): ContextTargetKind {
  return FOREIGN_KIND[blockType] ?? 'block';
}

function inlineKindFromDom(target: EventTarget | null): ContextTargetKind | null {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return null;
  }
  if (target.closest('[data-link], a[data-href]') !== null) {
    return 'link';
  }
  if (target.closest('[data-inline-equation]') !== null) {
    return 'inline-equation';
  }
  if (target.closest('[data-date-time]') !== null) {
    return 'date-time';
  }
  if (target.closest('[data-table-cell]') !== null) {
    return 'table-cell';
  }
  return null;
}

export function pointerOpensBlockMenu(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('.block-handle') !== null) {
    return true;
  }
  if (target.closest('[data-region="page-editor"]') === null) {
    return false;
  }
  if (target.closest(TEXT_CONTENT_SELECTOR) !== null) {
    return false;
  }
  return true;
}

export function proseBlockType(node: ProseNode): ContextBlockType {
  switch (node.type.name) {
    case 'paragraph':
      return 'paragraph';
    case 'heading':
      return 'heading';
    case 'bullet_list':
      return 'bulleted-list';
    case 'ordered_list':
      return 'numbered-list';
    case 'checklist':
      return 'checklist';
    case 'blockquote':
      return 'quote';
    case 'code_block':
      return 'code';
    case 'horizontal_rule':
      return 'divider';
    case 'page_break':
      return 'page-break';
    case 'foreign_block':
      return typeof node.attrs.blockType === 'string' ? node.attrs.blockType : 'unknown';
    case 'structured_block':
      return typeof node.attrs.blockType === 'string' ? node.attrs.blockType : 'unknown';
    default:
      return 'paragraph';
  }
}

function blockSelectionActive(state: EditorState): boolean {
  return state.selection instanceof NodeSelection && state.selection.$anchor.depth === 0;
}

function clampTopLevelBlockIndex(doc: ProseNode, index: number): number {
  if (doc.childCount === 0) {
    return 0;
  }
  return Math.max(0, Math.min(index, doc.childCount - 1));
}

function blockIndexAtPointer(view: EditorView, clientX: number, clientY: number): number {
  const { doc } = view.state;
  const hit = (() => {
    try {
      return posAtCoordsForEditor(view, clientX, clientY);
    } catch {
      return null;
    }
  })();
  if (hit !== null) {
    return clampTopLevelBlockIndex(doc, blockIndexAtPos(doc, hit.pos));
  }
  const hover = blockHandleState(view.state).hoverBlock;
  if (hover !== null) {
    return clampTopLevelBlockIndex(doc, hover);
  }
  if (doc.childCount === 0) {
    return 0;
  }
  const drop = dropIndexFromClientY(view, clientY);
  return clampTopLevelBlockIndex(doc, drop >= doc.childCount ? doc.childCount - 1 : drop);
}

function selectionBounds(state: EditorState): Pick<ContextMenuTarget, 'selectionAnchor' | 'selectionHead'> {
  return { selectionAnchor: state.selection.anchor, selectionHead: state.selection.head };
}

function targetForForeign(blockType: string, blockIndex: number, coords: {
  clientX: number;
  clientY: number;
  keyboard: boolean;
}, selection: Pick<ContextMenuTarget, 'selectionAnchor' | 'selectionHead'>): ContextMenuTarget {
  return {
    kind: foreignKind(blockType),
    blockType,
    blockIndex,
    clientX: coords.clientX,
    clientY: coords.clientY,
    keyboard: coords.keyboard,
    ...selection,
  };
}

export function resolveMenuKind(
  state: EditorState,
  blockType: ContextBlockType,
  domTarget: EventTarget | null,
  keyboard = false,
): ContextTargetKind {
  if (keyboard) {
    if (blockSelectionActive(state)) {
      return 'block';
    }
    return linkAround(state) !== null ? 'link' : 'text';
  }
  if (pointerOpensBlockMenu(domTarget)) {
    return 'block';
  }
  if (blockSelectionActive(state)) {
    return 'block';
  }
  const inline = inlineKindFromDom(domTarget);
  if (inline !== null) {
    return inline;
  }
  if (typeof blockType === 'string' && FOREIGN_KIND[blockType] !== undefined) {
    return foreignKind(blockType);
  }
  return 'text';
}

export function resolveContextTarget(
  view: EditorView,
  clientX: number,
  clientY: number,
  domTarget: EventTarget | null,
  keyboard: boolean,
): ContextMenuTarget {
  const selection = selectionBounds(view.state);
  const blockIndex = keyboard
    ? (blockSelectionActive(view.state)
      ? view.state.selection.$anchor.index(0)
      : blockIndexAtPointer(view, clientX, clientY))
    : blockIndexAtPointer(view, clientX, clientY);
  const node = view.state.doc.child(blockIndex);
  const blockType = proseBlockType(node);
  if (node.type.name === 'foreign_block' || node.type.name === 'structured_block') {
    return targetForForeign(String(node.attrs.blockType), blockIndex, { clientX, clientY, keyboard }, selection);
  }
  const kind = resolveMenuKind(view.state, blockType, keyboard ? null : domTarget, keyboard);
  return {
    kind,
    blockType,
    blockIndex,
    clientX,
    clientY,
    keyboard,
    ...selection,
  };
}