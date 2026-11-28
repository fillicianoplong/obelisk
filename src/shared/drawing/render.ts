import type { Stroke } from '../schema/types.js';
import { isHighlighterColor, strokePointsLiteral } from './strokes.js';
import { strokeDisplayColor, strokeExportColor } from './colors.js';

export interface StrokeRenderOptions {
  darkTheme?: boolean;
  forExport?: boolean;
}

function strokePaint(stroke: Stroke, options: StrokeRenderOptions): { color: string; opacity: number } {
  const base = options.forExport === true
    ? strokeExportColor(stroke.color)
    : strokeDisplayColor(stroke.color, options.darkTheme === true);
  const highlighter = isHighlighterColor(stroke.color);
  return {
    color: base,
    opacity: highlighter ? 0.45 : 1,
  };
}

export function strokeSvgAttributes(stroke: Stroke, options: StrokeRenderOptions = {}): Record<string, string> {
  const paint = strokePaint(stroke, options);
  return {
    fill: 'none',
    stroke: paint.color,
    'stroke-width': String(stroke.width),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-opacity': String(paint.opacity),
    points: strokePointsLiteral(stroke.points),
  };
}

export function renderStrokeElement(
  doc: Document,
  stroke: Stroke,
  index: number,
  options: StrokeRenderOptions = {},
): SVGPolylineElement {
  const el = doc.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  el.setAttribute('data-stroke-index', String(index));
  const attrs = strokeSvgAttributes(stroke, options);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

export function renderStrokesSvg(
  doc: Document,
  width: number,
  height: number,
  strokes: readonly Stroke[],
  options: StrokeRenderOptions = {},
): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  strokes.forEach((stroke, index) => {
    svg.append(renderStrokeElement(doc, stroke, index, options));
  });
  return svg;
}