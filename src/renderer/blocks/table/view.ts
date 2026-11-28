import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { evaluateTable } from './math/index.js';
import { cellPlainText } from './cell-text.js';
import { parseTablePayload, tablePayloadFromBlock } from './document.js';
import { setCellText } from './model.js';
import { blockStartPos } from './position.js';
import { setTableSelection } from './selection.js';
import { stringifyPayload } from '../structured/payload.js';

export class TableBlockView implements NodeView {
  dom: HTMLElement;

  table: HTMLTableElement;

  private readonly view: EditorView;

  private readonly getPos: () => number | undefined;

  private node: ProseNode;

  private editing: { row: number; col: number } | null = null;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'table-block';
    this.dom.dataset.blockType = 'table';
    this.table = document.createElement('table');
    this.table.className = 'obelisk-table';
    this.dom.append(this.table);
    this.render(node);
  }

  private blockIndex(): number | null {
    const pos = this.getPos();
    if (pos === undefined) {
      return null;
    }
    return this.view.state.doc.resolve(pos).index(0);
  }

  private commitCell(row: number, col: number, text: string): void {
    const blockIndex = this.blockIndex();
    if (blockIndex === null) {
      return;
    }
    const table = parseTablePayload(this.node.attrs);
    if (table === null) {
      return;
    }
    const next = setCellText(table, row, col, text);
    if (next === null) {
      return;
    }
    const pos = blockStartPos(this.view.state.doc, blockIndex);
    const payload = stringifyPayload(tablePayloadFromBlock(next as never));
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      payload,
    });
    this.view.dispatch(setTableSelection(tr, { blockIndex, row, col }));
  }

  private focusCell(row: number, col: number, selectAll = false): void {
    const blockIndex = this.blockIndex();
    if (blockIndex === null) {
      return;
    }
    this.editing = { row, col };
    this.view.dispatch(setTableSelection(this.view.state.tr, { blockIndex, row, col }));
    this.render(this.node);
    const cell = this.table.rows[row]?.cells[col];
    const editable = cell?.querySelector<HTMLElement>('.table-cell-input');
    if (editable !== undefined && editable !== null) {
      editable.focus();
      if (selectAll) {
        const range = document.createRange();
        range.selectNodeContents(editable);
        const sel = document.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  private render(node: ProseNode): void {
    this.node = node;
    const table = parseTablePayload(node.attrs);
    if (table === null) {
      return;
    }
    const grid = table.rows.map((row) => row.cells);
    const evaluated = evaluateTable(grid);
    this.table.replaceChildren();
    if (table.headerRow) {
      this.table.classList.add('has-header-row');
    } else {
      this.table.classList.remove('has-header-row');
    }
    for (let row = 0; row < grid.length; row += 1) {
      const tr = document.createElement('tr');
      if (table.headerRow && row === 0) {
        tr.className = 'table-header-row';
      }
      const rowCells = grid[row] ?? [];
      for (let col = 0; col < rowCells.length; col += 1) {
        const td = document.createElement('td');
        td.dataset.tableCell = 'true';
        td.dataset.row = String(row);
        td.dataset.col = String(col);
        const ev = evaluated[row]?.[col];
        const isEditing = this.editing?.row === row && this.editing?.col === col;
        const input = document.createElement('div');
        input.className = 'table-cell-input';
        input.contentEditable = 'true';
        input.spellcheck = false;
        const source = rowCells[col]!;
        let show = cellPlainText(source);
        if (!isEditing && source.kind === 'formula' && ev) {
          show = ev.display;
        } else if (isEditing && source.kind === 'formula') {
          show = source.source;
        } else if (!isEditing && ev && show === '' && ev.display.length > 0) {
          show = ev.display;
        }
        input.textContent = show;
        if (ev?.underline === true && !isEditing) {
          input.classList.add('table-cell-error-underline');
        }
        if (ev?.error !== null && ev?.error !== undefined && !isEditing) {
          input.classList.add('table-cell-error');
        }
        input.addEventListener('focus', () => {
          if (this.editing?.row !== row || this.editing?.col !== col) {
            this.editing = { row, col };
            const editText = ev ? (ev.editing.length > 0 ? ev.editing : cellPlainText(rowCells[col]!)) : cellPlainText(rowCells[col]!);
            input.textContent = editText;
          }
          const blockIndex = this.blockIndex();
          if (blockIndex !== null) {
            this.view.dispatch(setTableSelection(this.view.state.tr, { blockIndex, row, col }));
          }
        });
        input.addEventListener('blur', () => {
          const text = input.textContent ?? '';
          this.commitCell(row, col, text);
          this.editing = null;
        });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Tab') {
            event.preventDefault();
            const nextCol = event.shiftKey ? col - 1 : col + 1;
            if (nextCol >= 0 && nextCol < rowCells.length) {
              this.commitCell(row, col, input.textContent ?? '');
              this.editing = null;
              this.focusCell(row, nextCol, true);
              return;
            }
            const nextRow = event.shiftKey ? row - 1 : row + 1;
            const wrapCol = event.shiftKey ? rowCells.length - 1 : 0;
            if (nextRow >= 0 && nextRow < grid.length) {
              this.commitCell(row, col, input.textContent ?? '');
              this.editing = null;
              const width = grid[nextRow]?.length ?? rowCells.length;
              const targetCol = nextCol < 0 || nextCol >= rowCells.length ? Math.min(wrapCol, width - 1) : nextCol;
              this.focusCell(nextRow, targetCol, true);
            }
          }
        });
        td.append(input);
        td.style.width = `${(table.columnWidths[col] ?? 1) * 96}px`;
        tr.append(td);
      }
      this.table.append(tr);
    }
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type || node.attrs.blockType !== 'table') {
      return false;
    }
    this.render(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('.table-cell-input') !== null) {
      return true;
    }
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }
}

export function tableNodeViews(): Record<string, (node: ProseNode, view: EditorView, getPos: () => number | undefined) => NodeView> {
  return {
    structured_block(node, view, getPos) {
      if (node.attrs.blockType === 'table') {
        return new TableBlockView(node, view, getPos);
      }
      return new (class implements NodeView {
        dom = document.createElement('div');
        constructor() {
          this.dom.className = 'structured-block';
          this.dom.textContent = String(node.attrs.blockType);
        }
        update() {
          return false;
        }
      })();
    },
  };
}