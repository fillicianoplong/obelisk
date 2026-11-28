import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { ColumnsBlock, NestedBlock } from '../../../shared/schema/types.js';
import { COLUMN_GAP_IN } from '../../../shared/schema/limits.js';
import { cssPixelsAt96Dpi } from '../../editor/layout/page.js';
import { blockHandleState } from '../../editor/block-handle-plugin.js';
import { newBlockId } from '../../editor/block-id.js';
import { stringifyPayload } from '../structured/payload.js';
import {
  commitNestedColumnChange,
  moveTopLevelBlocksIntoColumn,
} from './commands.js';
import { columnsPayloadFromBlock, emptyParagraph, parseColumnsPayload } from './document.js';
import { extractNestedFromElement, nestedBlockFromPlain, renderNestedBlock } from './nested.js';
import { resizePair } from './model.js';

const GAP_PX = cssPixelsAt96Dpi(COLUMN_GAP_IN);

export class ColumnsBlockView implements NodeView {
  dom: HTMLElement;

  private readonly view: EditorView;

  private readonly getPos: () => number | undefined;

  private node: ProseNode;

  private row: HTMLElement;

  private resizing = false;

  private pendingResize: ColumnsBlock | null = null;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'columns-block';
    this.dom.dataset.blockType = 'columns';
    this.row = document.createElement('div');
    this.row.className = 'columns-row';
    this.row.style.gap = `${GAP_PX}px`;
    this.dom.append(this.row);
    this.bindDrop();
    this.render(node);
  }

  private blockIndex(): number | null {
    const pos = this.getPos();
    if (pos === undefined) {
      return null;
    }
    return this.view.state.doc.resolve(pos).index(0);
  }

  private currentColumns(): ColumnsBlock | null {
    return parseColumnsPayload(this.node.attrs);
  }

  private commit(columns: ColumnsBlock): void {
    const blockIndex = this.blockIndex();
    if (blockIndex === null) {
      return;
    }
    const payload = stringifyPayload(columnsPayloadFromBlock(columns as never));
    const pos = this.getPos();
    if (pos === undefined) {
      return;
    }
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      blockId: columns.id,
      blockType: 'columns',
      payload,
    });
    this.view.dispatch(tr);
  }

  private collectColumnBlocks(columnEl: HTMLElement): NestedBlock[] {
    const blocks: NestedBlock[] = [];
    const items = columnEl.querySelectorAll<HTMLElement>('.columns-nested-block');
    items.forEach((element) => {
      const type = element.dataset.nestedType ?? 'paragraph';
      const id = element.dataset.blockId ?? newBlockId();
      const base = nestedBlockFromPlain(id, type as NestedBlock['type'], '');
      const extracted = extractNestedFromElement(element, { ...base, id });
      if (extracted !== null) {
        blocks.push(extracted);
      }
    });
    return blocks;
  }

  private flushEdits(): void {
    const columns = this.currentColumns();
    if (columns === null) {
      return;
    }
    const stacks = this.row.querySelectorAll<HTMLElement>('.column-stack');
    const next = columns.columns.map((column, index) => {
      const stack = stacks[index];
      if (stack === undefined) {
        return column;
      }
      return { ...column, blocks: this.collectColumnBlocks(stack) };
    });
    this.commit({ ...columns, columns: next });
  }

  private bindDrop(): void {
    this.dom.addEventListener('mouseup', (event) => {
      if (this.view.dom.getAttribute('data-block-drag') !== 'true') {
        return;
      }
      const drag = blockHandleState(this.view.state).drag;
      if (drag === null) {
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const columnEl = target.closest<HTMLElement>('[data-column-index]');
      if (columnEl === null || !this.dom.contains(columnEl)) {
        return;
      }
      const blockIndex = this.blockIndex();
      if (blockIndex === null) {
        return;
      }
      const columnIndex = Number(columnEl.dataset.columnIndex);
      if (!Number.isFinite(columnIndex)) {
        return;
      }
      const tr = moveTopLevelBlocksIntoColumn(
        this.view.state,
        drag.sourceFrom,
        drag.sourceTo,
        blockIndex,
        columnIndex,
      );
      if (tr !== null) {
        this.flushEdits();
        this.view.dispatch(tr);
        event.preventDefault();
      }
    });
  }

  private startResize(leftIndex: number, gutter: HTMLElement, event: PointerEvent): void {
    event.preventDefault();
    const columns = this.currentColumns();
    const blockIndex = this.blockIndex();
    if (columns === null || blockIndex === null) {
      return;
    }
    const rowRect = this.row.getBoundingClientRect();
    const gapTotal = GAP_PX * (columns.columns.length - 1);
    const innerWidth = rowRect.width - gapTotal;
    const startX = event.clientX;
    const left = columns.columns[leftIndex]!;
    const right = columns.columns[leftIndex + 1]!;
    const startLeft = left.share;
    const startRight = right.share;

    const shells = () => this.row.querySelectorAll<HTMLElement>('.column-shell');

    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) / innerWidth;
      const next = resizePair(columns, leftIndex, startLeft + delta, startRight - delta);
      if (next === null) {
        return;
      }
      const leftShell = shells()[leftIndex];
      const rightShell = shells()[leftIndex + 1];
      if (leftShell !== undefined) {
        leftShell.style.flex = `${next.columns[leftIndex]!.share} 1 0`;
      }
      if (rightShell !== undefined) {
        rightShell.style.flex = `${next.columns[leftIndex + 1]!.share} 1 0`;
      }
      this.pendingResize = next;
    };

    const onUp = () => {
      gutter.releasePointerCapture(event.pointerId);
      gutter.removeEventListener('pointermove', onMove);
      gutter.removeEventListener('pointerup', onUp);
      this.resizing = false;
      this.flushEdits();
      if (this.pendingResize !== null) {
        this.commit(this.pendingResize);
        this.pendingResize = null;
      }
    };

    this.resizing = true;
    gutter.setPointerCapture(event.pointerId);
    gutter.addEventListener('pointermove', onMove);
    gutter.addEventListener('pointerup', onUp);
  }

  private render(node: ProseNode): void {
    this.node = node;
    const columns = parseColumnsPayload(node.attrs);
    if (columns === null) {
      return;
    }
    this.row.replaceChildren();
    columns.columns.forEach((column, columnIndex) => {
      const shell = document.createElement('div');
      shell.className = 'column-shell';
      shell.style.flex = `${column.share} 1 0`;
      shell.dataset.columnIndex = String(columnIndex);

      const stack = document.createElement('div');
      stack.className = 'column-stack';
      for (const block of column.blocks) {
        const nested = renderNestedBlock(block);
        const editable = nested.querySelector<HTMLElement>('[data-nested-editable]');
        if (editable !== null) {
          editable.addEventListener('blur', () => {
            if (!this.resizing) {
              this.flushEdits();
            }
          });
          editable.addEventListener('keydown', (keydown) => {
            if (keydown.key === 'Enter' && !keydown.shiftKey) {
              keydown.preventDefault();
              const columnsNow = this.currentColumns();
              const blockIndex = this.blockIndex();
              if (columnsNow === null || blockIndex === null) {
                return;
              }
              this.flushEdits();
              const fresh = this.currentColumns();
              if (fresh === null) {
                return;
              }
              const currentBlocks = fresh.columns[columnIndex]?.blocks ?? [];
              const at = currentBlocks.findIndex((entry) => entry.id === block.id);
              const insertAt = at < 0 ? currentBlocks.length : at + 1;
              const next = commitNestedColumnChange(fresh, columnIndex, [
                ...currentBlocks.slice(0, insertAt),
                emptyParagraph(newBlockId()),
                ...currentBlocks.slice(insertAt),
              ]);
              this.commit(next);
            }
          });
        }
        stack.append(nested);
      }
      shell.append(stack);
      this.row.append(shell);

      if (columnIndex < columns.columns.length - 1) {
        const gutter = document.createElement('button');
        gutter.type = 'button';
        gutter.className = 'column-resize-gutter';
        gutter.setAttribute('aria-label', 'Resize columns');
        gutter.addEventListener('pointerdown', (pointer) => {
          this.startResize(columnIndex, gutter, pointer);
        });
        this.row.append(gutter);
      }
    });
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    if (this.resizing) {
      this.node = node;
      return true;
    }
    if (node.attrs.payload === this.node.attrs.payload) {
      this.node = node;
      return true;
    }
    this.render(node);
    return true;
  }

  ignoreMutation(): boolean {
    return this.resizing;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.closest('.column-resize-gutter') !== null) {
        return true;
      }
      if (target.closest('[data-nested-editable]') !== null) {
        return true;
      }
    }
    return false;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }
}
