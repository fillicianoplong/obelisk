import type { NodeSpec } from 'prosemirror-model';
import { checklistItemAttrs, listAttrs, listItemAttrs } from './attrs.js';

const listItemSpec: NodeSpec = {
  content: 'inline*',
  marks: '_',
  attrs: listItemAttrs,
  parseDOM: [{ tag: 'li[data-list-item]', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return { level: Number(dom.dataset.level ?? 0) };
  } }],
  toDOM(node) {
    return ['li', { 'data-list-item': 'true', 'data-level': node.attrs.level }, 0];
  },
};

const checklistItemSpec: NodeSpec = {
  content: 'inline*',
  marks: '_',
  attrs: checklistItemAttrs,
  parseDOM: [{ tag: 'li[data-checklist-item]', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return {
      level: Number(dom.dataset.level ?? 0),
      checked: dom.dataset.checked === 'true',
    };
  } }],
  toDOM(node) {
    return ['li', {
      'data-checklist-item': 'true',
      'data-level': node.attrs.level,
      'data-checked': node.attrs.checked ? 'true' : 'false',
    }, 0];
  },
};

export const bulletListSpec: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  attrs: listAttrs,
  parseDOM: [{ tag: 'ul[data-list-style="bulleted"]', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return { blockId: dom.dataset.blockId ?? '' };
  } }],
  toDOM(node) {
    return ['ul', { 'data-list-style': 'bulleted', 'data-block-id': node.attrs.blockId }, 0];
  },
};

export const orderedListSpec: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  attrs: listAttrs,
  parseDOM: [{ tag: 'ol[data-list-style="numbered"]', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return { blockId: dom.dataset.blockId ?? '' };
  } }],
  toDOM(node) {
    return ['ol', { 'data-list-style': 'numbered', 'data-block-id': node.attrs.blockId }, 0];
  },
};

export const checklistSpec: NodeSpec = {
  content: 'checklist_item+',
  group: 'block',
  attrs: listAttrs,
  parseDOM: [{ tag: 'ul[data-list-style="checklist"]', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return { blockId: dom.dataset.blockId ?? '' };
  } }],
  toDOM(node) {
    return ['ul', { 'data-list-style': 'checklist', 'data-block-id': node.attrs.blockId }, 0];
  },
};

export const listNodeSpecs: { [name: string]: NodeSpec } = {
  list_item: listItemSpec,
  checklist_item: checklistItemSpec,
  bullet_list: bulletListSpec,
  ordered_list: orderedListSpec,
  checklist: checklistSpec,
};
