import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { renderFormulaLatex } from '../../../shared/formula/render.js';
import { blockStartPos } from '../table/position.js';
import { parseFormulaPayload } from './document.js';
import { stringifyPayload } from '../structured/payload.js';

function paintPreview(preview: HTMLElement, latex: string): void {
  const result = renderFormulaLatex(latex, true);
  preview.replaceChildren();
  if (result.ok) {
    preview.classList.remove('equation-error');
    preview.insertAdjacentHTML('afterbegin', result.html);
    return;
  }
  preview.classList.add('equation-error');
  const message = document.createElement('span');
  message.className = 'equation-error-text';
  message.textContent = result.error ?? 'The equation could not be rendered.';
  preview.append(message);
}

export class EquationBlockView implements NodeView {
  dom: HTMLElement;

  private readonly source: HTMLTextAreaElement;

  private readonly preview: HTMLElement;

  private readonly view: EditorView;

  private readonly getPos: () => number | undefined;

  private node: ProseNode;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'equation-block';
    this.dom.dataset.blockType = 'formula';
    this.dom.dataset.equationBlock = 'true';

    this.source = document.createElement('textarea');
    this.source.className = 'equation-source';
    this.source.setAttribute('aria-label', 'LaTeX source');
    this.source.spellcheck = false;
    this.source.rows = 3;

    this.preview = document.createElement('div');
    this.preview.className = 'equation-preview';
    this.preview.setAttribute('aria-live', 'polite');

    this.dom.append(this.source, this.preview);
    this.render(node);
    this.source.addEventListener('input', () => this.commitSource());
    this.source.addEventListener('blur', () => this.commitSource());
  }

  private blockIndex(): number | null {
    const pos = this.getPos();
    if (pos === undefined) {
      return null;
    }
    return this.view.state.doc.resolve(pos).index(0);
  }

  private commitSource(): void {
    const blockIndex = this.blockIndex();
    if (blockIndex === null) {
      return;
    }
    const latex = this.source.value;
    const pos = blockStartPos(this.view.state.doc, blockIndex);
    const payload = stringifyPayload({ latex });
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      payload,
    });
    this.view.dispatch(tr);
    paintPreview(this.preview, latex);
  }

  private render(node: ProseNode): void {
    this.node = node;
    const formula = parseFormulaPayload(node.attrs);
    const latex = formula?.latex ?? '';
    if (this.source.value !== latex) {
      this.source.value = latex;
    }
    paintPreview(this.preview, latex);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type || node.attrs.blockType !== 'formula') {
      return false;
    }
    this.render(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (target === this.source || (target instanceof Node && this.source.contains(target))) {
      return true;
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