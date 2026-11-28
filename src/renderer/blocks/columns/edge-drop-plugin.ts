import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { blockHandlePluginKey } from '../../editor/block-handle-plugin.js';
import { blockPosAtIndex } from '../../editor/block-handle-plugin.js';
import { createColumnRowFromPair } from './commands.js';

const EDGE_FRACTION = 0.15;

function edgeHit(view: EditorView, clientX: number, clientY: number): { index: number; side: 'left' | 'right' } | null {
  for (let index = 0; index < view.state.doc.childCount; index += 1) {
    const pos = blockPosAtIndex(view.state.doc, index);
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) {
      continue;
    }
    const rect = dom.getBoundingClientRect();
    if (clientY < rect.top || clientY > rect.bottom) {
      continue;
    }
    const width = rect.width;
    const leftEdge = rect.left + width * EDGE_FRACTION;
    const rightEdge = rect.right - width * EDGE_FRACTION;
    if (clientX >= rect.left && clientX <= leftEdge) {
      return { index, side: 'left' };
    }
    if (clientX >= rightEdge && clientX <= rect.right) {
      return { index, side: 'right' };
    }
  }
  return null;
}

export function columnsEdgeDropPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mouseup(view, event) {
          if (view.dom.getAttribute('data-block-drag') !== 'true') {
            return false;
          }
          const drag = blockHandlePluginKey.getState(view.state)?.drag;
          if (drag === null || drag === undefined) {
            return false;
          }
          if (drag.sourceFrom !== drag.sourceTo) {
            return false;
          }
          const hit = edgeHit(view, event.clientX, event.clientY);
          if (hit === null) {
            return false;
          }
          if (hit.index === drag.sourceFrom) {
            return false;
          }
          const node = view.state.doc.child(hit.index);
          if (node.type.name === 'structured_block' && node.attrs.blockType === 'columns') {
            return false;
          }
          const source = view.state.doc.child(drag.sourceFrom);
          if (source.type.name === 'structured_block' && source.attrs.blockType === 'columns') {
            return false;
          }
          const tr = createColumnRowFromPair(view.state, drag.sourceFrom, hit.index, hit.side);
          if (tr === null) {
            return false;
          }
          view.dispatch(tr);
          event.preventDefault();
          return true;
        },
      },
    },
  });
}