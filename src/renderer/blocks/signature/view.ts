import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { activeSignatureStore } from './assets.js';
import { parseSignaturePayload } from './document.js';

const MIME = 'image/png';

export class SignatureBlockView implements NodeView {
  dom: HTMLElement;

  private wrap: HTMLElement;

  private figure: HTMLElement;

  private img: HTMLImageElement;

  private line: HTMLElement;

  private labels: HTMLElement;

  private node: ProseNode;

  private objectUrl: string | null = null;

  constructor(node: ProseNode, _view: EditorView) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'signature-block';
    this.dom.dataset.blockType = 'signature';
    this.wrap = document.createElement('div');
    this.wrap.className = 'signature-block-wrap';
    this.figure = document.createElement('figure');
    this.figure.className = 'signature-block-figure';
    this.img = document.createElement('img');
    this.img.className = 'signature-block-img';
    this.img.draggable = false;
    this.figure.append(this.img);
    this.line = document.createElement('div');
    this.line.className = 'signature-block-line';
    this.line.setAttribute('aria-hidden', 'true');
    this.labels = document.createElement('div');
    this.labels.className = 'signature-block-labels';
    this.wrap.append(this.figure, this.line, this.labels);
    this.dom.append(this.wrap);
    void this.render(node);
  }

  private revokeUrl(): void {
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private async render(node: ProseNode): Promise<void> {
    this.node = node;
    const signature = parseSignaturePayload(node.attrs as Record<string, unknown>);
    if (signature === null) {
      return;
    }
    this.wrap.style.textAlign = signature.align;
    this.wrap.style.width = `${signature.width}in`;
    this.line.hidden = !signature.line;
    this.labels.replaceChildren();
    for (const text of signature.labels) {
      const line = document.createElement('div');
      line.className = 'signature-block-label';
      line.textContent = text;
      this.labels.append(line);
    }
    this.labels.hidden = signature.labels.length === 0;
    this.figure.hidden = signature.blank;
    if (signature.blank) {
      this.img.removeAttribute('src');
      this.revokeUrl();
      return;
    }
    const asset = activeSignatureStore().get(signature.sha256);
    if (!asset) {
      this.img.removeAttribute('src');
      this.revokeUrl();
      return;
    }
    this.revokeUrl();
    const copy = new Uint8Array(asset.bytes.byteLength);
    copy.set(asset.bytes);
    this.objectUrl = URL.createObjectURL(new Blob([copy], { type: MIME }));
    this.img.src = this.objectUrl;
    this.img.alt = 'Signature';
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    void this.render(node);
    return true;
  }

  destroy(): void {
    this.revokeUrl();
  }

  stopEvent(): boolean {
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