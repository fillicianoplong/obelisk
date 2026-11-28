import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { formatDiagramRenderError } from '../../../shared/diagram/error-message.js';
import { screenDiagramRenderTarget } from '../../../shared/diagram/render-target.js';
import { renderDiagramSource } from './render.js';
import { registerDiagramRepaint } from './theme-sync.js';
import { blockStartPos } from '../table/position.js';
import { stringifyPayload } from '../structured/payload.js';
import { parseDiagramPayload } from './document.js';

const SAMPLE_FLOWCHART = `flowchart TD
  Start([Start]) --> Decide{Ready?}
  Decide -->|Yes| Done([Done])
  Decide -->|No| Start`;

function diagramStyleNonce(): string {
  const nonce = (globalThis as { window?: { obeliskStyleNonce?: string } }).window?.obeliskStyleNonce;
  return typeof nonce === 'string' && nonce.length > 0 ? nonce : '';
}

type DiagramMode = 'display' | 'edit';

export class DiagramBlockView implements NodeView {
  dom: HTMLElement;

  private readonly source: HTMLTextAreaElement;

  private readonly preview: HTMLElement;

  private readonly errorBox: HTMLElement;

  private readonly view: EditorView;

  private readonly getPos: () => number | undefined;

  private node: ProseNode;

  paintToken = 0;

  private mode: DiagramMode = 'display';

  private hasRenderedPreview = false;

  private hasDiagramError = false;

  private latestPaint: Promise<void> = Promise.resolve();

  private readonly unsubscribeTheme: () => void;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'diagram-block';
    this.dom.dataset.blockType = 'diagram';
    this.dom.dataset.diagramBlock = 'true';

    this.source = document.createElement('textarea');
    this.source.className = 'diagram-source';
    this.source.setAttribute('aria-label', 'Mermaid source');
    this.source.spellcheck = false;
    this.source.rows = 4;

    this.preview = document.createElement('div');
    this.preview.className = 'diagram-preview';
    this.preview.setAttribute('aria-live', 'polite');
    this.preview.tabIndex = -1;

    this.errorBox = document.createElement('div');
    this.errorBox.className = 'diagram-error';
    this.errorBox.hidden = true;

    this.dom.append(this.source, this.preview, this.errorBox);
    this.setMode('display');
    this.render(node);
    this.source.addEventListener('input', () => {
      void this.commitSource();
    });
    this.source.addEventListener('focus', () => {
      this.setMode('edit');
    });
    this.source.addEventListener('blur', () => {
      void this.onSourceBlur();
    });
    this.preview.addEventListener('pointerdown', (event) => {
      if (this.mode === 'display') {
        event.preventDefault();
        this.setMode('edit');
        this.source.focus();
      }
    });
    this.unsubscribeTheme = registerDiagramRepaint(() => {
      this.queuePaint(this.source.value);
    });
  }

  destroy(): void {
    this.unsubscribeTheme();
  }

  private setMode(mode: DiagramMode): void {
    this.mode = mode;
    this.dom.dataset.mode = mode;
  }

  private maybeEnterDisplayMode(): void {
    if (this.hasDiagramError || document.activeElement === this.source) {
      return;
    }
    const hasPreview = this.preview.querySelector('svg') !== null;
    if (this.hasRenderedPreview || hasPreview) {
      this.setMode('display');
    }
  }

  private async onSourceBlur(): Promise<void> {
    await this.commitSource();
    await this.latestPaint;
    if (document.activeElement === this.source) {
      return;
    }
    this.maybeEnterDisplayMode();
  }

  private blockIndex(): number | null {
    const pos = this.getPos();
    if (pos === undefined) {
      return null;
    }
    return this.view.state.doc.resolve(pos).index(0);
  }

  private blockId(): string {
    const id = this.node.attrs.blockId;
    return typeof id === 'string' && id.length > 0 ? id : 'diagram';
  }

  private async commitSource(): Promise<void> {
    const blockIndex = this.blockIndex();
    if (blockIndex === null) {
      return;
    }
    const text = this.source.value;
    const pos = blockStartPos(this.view.state.doc, blockIndex);
    const payload = stringifyPayload({ source: text });
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      payload,
    });
    this.view.dispatch(tr);
  }

  private queuePaint(source: string): void {
    const token = this.paintToken + 1;
    this.paintToken = token;
    this.latestPaint = this.paintSource(source, token);
  }

  private async paintSource(source: string, token: number): Promise<void> {
    this.preview.replaceChildren();
    this.errorBox.replaceChildren();
    this.errorBox.hidden = true;
    this.hasDiagramError = false;

    const trimmed = source.trim();
    if (trimmed.length === 0) {
      if (this.paintToken !== token) {
        return;
      }
      this.hasRenderedPreview = false;
      return;
    }

    const result = await renderDiagramSource(
      source,
      this.blockId(),
      this.preview,
      diagramStyleNonce(),
      screenDiagramRenderTarget(),
    );
    if (this.paintToken !== token) {
      return;
    }

    if (result.ok) {
      this.hasRenderedPreview = true;
      this.hasDiagramError = false;
      this.maybeEnterDisplayMode();
      return;
    }

    this.preview.replaceChildren();
    this.hasRenderedPreview = false;
    if (result.error !== null) {
      const { headline, detail } = formatDiagramRenderError(result.error);
      const title = document.createElement('p');
      title.className = 'diagram-error-text';
      title.textContent = headline;
      this.errorBox.append(title);
      if (detail !== null) {
        const sub = document.createElement('p');
        sub.className = 'diagram-error-detail';
        sub.textContent = detail;
        this.errorBox.append(sub);
      }
      this.errorBox.hidden = false;
      this.hasDiagramError = true;
      this.setMode('edit');
    }
  }

  private render(node: ProseNode): void {
    this.node = node;
    const diagram = parseDiagramPayload(node.attrs);
    const source = diagram?.source ?? '';
    if (this.source.value !== source) {
      this.source.value = source;
    }
    if (source.trim().length === 0 && document.activeElement === this.source) {
      this.source.placeholder = SAMPLE_FLOWCHART;
    } else {
      this.source.placeholder = '';
    }
    this.queuePaint(source);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type || node.attrs.blockType !== 'diagram') {
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
    if (this.mode === 'display' && target === this.preview) {
      return true;
    }
    return false;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    this.setMode('edit');
    this.source.focus();
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
    if (document.activeElement !== this.source) {
      this.maybeEnterDisplayMode();
    }
  }

  ignoreMutation(): boolean {
    return true;
  }
}

export { SAMPLE_FLOWCHART };