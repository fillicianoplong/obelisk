import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { Point, Stroke } from '../../../shared/schema/types.js';
import {
  DEFAULT_INK,
  HIGHLIGHTER_COLORS,
  PEN_COLORS,
  PEN_WIDTHS,
  appendPoint,
  effectiveStrokeWidth,
  removeStrokeAtIndex,
  strokeIndexAtPoint,
  type DrawingTool,
  type PenWidthKey,
} from '../../../shared/drawing/strokes.js';
import { pageThemeIsDark } from '../../../shared/drawing/colors.js';
import { renderStrokeElement, strokeSvgAttributes } from '../../../shared/drawing/render.js';
import { blockStartPos } from '../table/position.js';
import { parseDrawingPayload } from './document.js';
import { drawingBlockFromAttrs, drawingMenuCommand } from './commands.js';
import { stringifyPayload } from '../structured/payload.js';
import { drawingPayloadFromBlock } from './document.js';
import { markCloseHistoryGroup } from '../../editor/history/groups.js';
import './drawing.css';

interface ToolState {
  tool: DrawingTool;
  color: string;
  widthKey: PenWidthKey;
}

function pointerPressure(event: PointerEvent): number | undefined {
  if (event.pointerType === 'mouse') {
    return undefined;
  }
  return event.pressure;
}

function clientToLocal(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const width = viewBox.width > 0 ? viewBox.width : rect.width;
  const height = viewBox.height > 0 ? viewBox.height : rect.height;
  const scaleX = width / rect.width;
  const scaleY = height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function lineStroke(start: Point, end: Point, color: string, width: number): Stroke {
  return {
    points: [start, end],
    width,
    color,
  };
}

export class DrawingBlockView implements NodeView {
  dom: HTMLElement;

  private readonly view: EditorView;

  private readonly getPos: () => number | undefined;

  private node: ProseNode;

  private toolbar: HTMLElement;

  private colorGroup!: HTMLElement;

  private surface: HTMLElement;

  private svg: SVGSVGElement;

  private liveLayer: SVGGElement;

  private toolState: ToolState = {
    tool: 'pen',
    color: DEFAULT_INK,
    widthKey: 'medium',
  };

  private activeStroke: Stroke | null = null;

  private lineStart: Point | null = null;

  private pointerId: number | null = null;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'drawing-block structured-block';
    this.dom.dataset.blockType = 'drawing';
    this.toolbar = this.buildToolbar();
    this.surface = document.createElement('div');
    this.surface.className = 'drawing-surface';
    this.surface.tabIndex = 0;
    this.surface.setAttribute('role', 'img');
    this.surface.setAttribute('aria-label', 'Drawing pad');
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.liveLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.liveLayer.setAttribute('class', 'drawing-live-stroke');
    this.svg.append(this.liveLayer);
    this.surface.append(this.svg);
    this.dom.append(this.toolbar, this.surface);
    this.bindSurface();
    this.bindThemeRefresh();
    this.render(node);
  }

  private themeObserver: MutationObserver | null = null;

  private themeMedia: MediaQueryList | null = null;

  private bindThemeRefresh(): void {
    const doc = this.view.dom.ownerDocument;
    const root = doc.documentElement;
    this.themeObserver = new MutationObserver(() => this.renderStrokes());
    this.themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const media = doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');
    if (media !== undefined && media !== null) {
      this.themeMedia = media;
      media.addEventListener('change', this.onThemeMedia);
    }
  }

  private onThemeMedia = (): void => {
    this.renderStrokes();
  };

  private runDrawingCommand(commandId: string): void {
    const command = drawingMenuCommand(commandId);
    if (command !== null) {
      command(this.view.state, this.view.dispatch.bind(this.view));
    }
  }

  private blockIndex(): number | null {
    const pos = this.getPos();
    if (pos === undefined) {
      return null;
    }
    return this.view.state.doc.resolve(pos).index(0);
  }

  private drawingData() {
    return parseDrawingPayload(this.node.attrs);
  }

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'drawing-toolbar';
    const tools: { id: DrawingTool; label: string }[] = [
      { id: 'pen', label: 'Pen' },
      { id: 'highlighter', label: 'Hi' },
      { id: 'line', label: 'Line' },
      { id: 'eraser', label: 'Eraser' },
    ];
    const toolGroup = document.createElement('div');
    toolGroup.className = 'drawing-toolbar-group';
    for (const tool of tools) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'drawing-tool-button';
      button.textContent = tool.label;
      button.dataset.tool = tool.id;
      button.setAttribute('aria-pressed', tool.id === this.toolState.tool ? 'true' : 'false');
      button.addEventListener('click', () => {
        this.toolState = { ...this.toolState, tool: tool.id };
        this.syncToolbar();
        this.surface.dataset.tool = tool.id;
      });
      toolGroup.append(button);
    }
    this.colorGroup = document.createElement('div');
    this.colorGroup.className = 'drawing-toolbar-group';
    this.colorGroup.dataset.role = 'colors';

    const widthGroup = document.createElement('div');
    widthGroup.className = 'drawing-toolbar-group';
    (['thin', 'medium', 'thick'] as const).forEach((key) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'drawing-width-button';
      button.textContent = key === 'thin' ? 'Thin' : key === 'medium' ? 'Med' : 'Thick';
      button.dataset.width = key;
      button.setAttribute('aria-pressed', this.toolState.widthKey === key ? 'true' : 'false');
      button.addEventListener('click', () => {
        this.toolState = { ...this.toolState, widthKey: key };
        this.syncToolbar();
      });
      widthGroup.append(button);
    });

    const actionGroup = document.createElement('div');
    actionGroup.className = 'drawing-toolbar-group';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'drawing-action-button';
    undo.textContent = 'Undo';
    undo.addEventListener('click', () => this.runDrawingCommand('drawing-undo'));
    const redo = document.createElement('button');
    redo.type = 'button';
    redo.className = 'drawing-action-button';
    redo.textContent = 'Redo';
    redo.addEventListener('click', () => this.runDrawingCommand('drawing-redo'));
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'drawing-action-button';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => this.runDrawingCommand('drawing-clear'));
    actionGroup.append(undo, redo, clear);

    bar.append(toolGroup, this.colorGroup, widthGroup, actionGroup);
    this.syncColorSwatches(this.colorGroup);
    return bar;
  }

  private colorPalette(): readonly string[] {
    return this.toolState.tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;
  }

  private syncColorSwatches(container: HTMLElement): void {
    container.replaceChildren();
    const palette = this.colorPalette();
    if (!palette.some((entry) => entry === this.toolState.color)) {
      this.toolState = { ...this.toolState, color: palette[0] ?? DEFAULT_INK };
    }
    for (const color of palette) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'drawing-swatch';
      swatch.style.backgroundColor = color;
      swatch.title = color;
      swatch.setAttribute('aria-label', `Colour ${color}`);
      swatch.setAttribute('aria-pressed', this.toolState.color === color ? 'true' : 'false');
      swatch.addEventListener('click', () => {
        this.toolState = { ...this.toolState, color };
        this.syncToolbar();
      });
      container.append(swatch);
    }
  }

  private syncToolbar(): void {
    this.toolbar.querySelectorAll<HTMLButtonElement>('.drawing-tool-button').forEach((button) => {
      const pressed = button.dataset.tool === this.toolState.tool;
      button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
    this.toolbar.querySelectorAll<HTMLButtonElement>('.drawing-width-button').forEach((button) => {
      const pressed = button.dataset.width === this.toolState.widthKey;
      button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
    this.syncColorSwatches(this.colorGroup);
    this.surface.dataset.tool = this.toolState.tool;
  }

  private commitDrawing(next: { strokes: Stroke[]; width?: number; height?: number }): void {
    const blockIndex = this.blockIndex();
    const drawing = this.drawingData();
    if (blockIndex === null || drawing === null) {
      return;
    }
    const merged = {
      ...drawing,
      strokes: next.strokes,
      width: next.width ?? drawing.width,
      height: next.height ?? drawing.height,
    };
    const pos = blockStartPos(this.view.state.doc, blockIndex);
    const payload = stringifyPayload(drawingPayloadFromBlock(merged as never));
    const tr = markCloseHistoryGroup(this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      payload,
    }));
    this.view.dispatch(tr);
  }

  private renderStrokes(): void {
    const drawing = this.drawingData();
    if (drawing === null) {
      return;
    }
    const dark = pageThemeIsDark(this.view.dom.ownerDocument);
    while (this.svg.childNodes.length > 1) {
      this.svg.removeChild(this.svg.firstChild!);
    }
    const strokeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    drawing.strokes.forEach((stroke, index) => {
      strokeLayer.append(renderStrokeElement(this.view.dom.ownerDocument, stroke, index, { darkTheme: dark }));
    });
    this.svg.insertBefore(strokeLayer, this.liveLayer);
    this.svg.setAttribute('viewBox', `0 0 ${drawing.width} ${drawing.height}`);
    this.svg.setAttribute('width', String(drawing.width));
    this.svg.setAttribute('height', String(drawing.height));
    this.surface.style.aspectRatio = `${drawing.width} / ${drawing.height}`;
  }

  private renderLiveStroke(): void {
    this.liveLayer.replaceChildren();
    const dark = pageThemeIsDark(this.view.dom.ownerDocument);
    if (this.activeStroke !== null && this.activeStroke.points.length > 0) {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      const attrs = strokeSvgAttributes(this.activeStroke, { darkTheme: dark });
      for (const [key, value] of Object.entries(attrs)) {
        poly.setAttribute(key, value);
      }
      this.liveLayer.append(poly);
    }
  }

  private bindSurface(): void {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const drawing = this.drawingData();
      if (drawing === null) {
        return;
      }
      event.preventDefault();
      this.surface.setPointerCapture(event.pointerId);
      this.pointerId = event.pointerId;
      const local = clientToLocal(this.svg, event.clientX, event.clientY);

      if (this.toolState.tool === 'eraser') {
        const index = strokeIndexAtPoint(drawing.strokes, local.x, local.y);
        if (index >= 0) {
          this.commitDrawing({ strokes: removeStrokeAtIndex(drawing.strokes, index) });
        }
        return;
      }

      if (this.toolState.tool === 'line') {
        this.lineStart = local;
        this.activeStroke = lineStroke(local, local, this.toolState.color, PEN_WIDTHS[this.toolState.widthKey]);
        this.renderLiveStroke();
        return;
      }

      const width = effectiveStrokeWidth(
        {
          points: [local],
          width: PEN_WIDTHS[this.toolState.widthKey],
          color: this.toolState.color,
        },
        pointerPressure(event),
      );
      this.activeStroke = {
        points: [local],
        width,
        color: this.toolState.color,
      };
      this.renderLiveStroke();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (this.pointerId !== event.pointerId) {
        return;
      }
      const drawing = this.drawingData();
      if (drawing === null || this.activeStroke === null) {
        return;
      }
      const local = clientToLocal(this.svg, event.clientX, event.clientY);
      if (this.toolState.tool === 'line' && this.lineStart !== null) {
        this.activeStroke = lineStroke(
          this.lineStart,
          local,
          this.toolState.color,
          PEN_WIDTHS[this.toolState.widthKey],
        );
        this.renderLiveStroke();
        return;
      }
      const width = effectiveStrokeWidth(this.activeStroke, pointerPressure(event));
      this.activeStroke = {
        ...this.activeStroke,
        width,
        points: appendPoint(this.activeStroke.points, local, drawing.width, drawing.height),
      };
      this.renderLiveStroke();
    };

    const finishStroke = (event: PointerEvent) => {
      if (this.pointerId !== event.pointerId) {
        return;
      }
      const drawing = this.drawingData();
      if (drawing === null) {
        return;
      }
      this.surface.releasePointerCapture(event.pointerId);
      this.pointerId = null;
      if (this.activeStroke === null) {
        return;
      }
      const stroke = this.activeStroke;
      this.activeStroke = null;
      this.lineStart = null;
      this.liveLayer.replaceChildren();
      if (stroke.points.length >= 2) {
        this.commitDrawing({ strokes: [...drawing.strokes, stroke] });
      }
    };

    this.surface.addEventListener('pointerdown', onPointerDown);
    this.surface.addEventListener('pointermove', onPointerMove);
    this.surface.addEventListener('pointerup', finishStroke);
    this.surface.addEventListener('pointercancel', finishStroke);

    this.surface.addEventListener('keydown', (event) => {
      if (event.key === 'z' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        event.preventDefault();
        this.runDrawingCommand('drawing-undo');
      }
      if (event.key === 'z' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
        event.preventDefault();
        this.runDrawingCommand('drawing-redo');
      }
    });
  }

  private render(node: ProseNode): void {
    this.node = node;
    const drawing = drawingBlockFromAttrs(node.attrs);
    if (drawing === null) {
      return;
    }
    this.dom.dataset.blockId = drawing.id;
    this.renderStrokes();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type || node.attrs.blockType !== 'drawing') {
      return false;
    }
    this.render(node);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof Node)) {
      return false;
    }
    return this.dom.contains(target);
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  destroy(): void {
    this.themeObserver?.disconnect();
    this.themeMedia?.removeEventListener('change', this.onThemeMedia);
  }
}
