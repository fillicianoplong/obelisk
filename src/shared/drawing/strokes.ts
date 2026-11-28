import type { Point, Stroke } from '../schema/types.js';

/** Default pen ink stored in the document (black). */
export const DEFAULT_INK = '#000000';

/** Pen palette (Drawing tools reference: 8 colors). */
export const PEN_COLORS = [
  '#000000',
  '#B3261E',
  '#2B5797',
  '#0E6B0E',
  '#8A5100',
  '#5C2D91',
  '#6E4B2A',
  '#4A5361',
] as const;

/** Highlighter palette (4 colors). */
export const HIGHLIGHTER_COLORS = [
  '#FEF08A',
  '#BBF7D0',
  '#BFDBFE',
  '#FBCFE8',
] as const;

export const STROKE_WIDTH_THIN = 2;
export const STROKE_WIDTH_MEDIUM = 4;
export const STROKE_WIDTH_THICK = 8;

export const PEN_WIDTHS = {
  thin: STROKE_WIDTH_THIN,
  medium: STROKE_WIDTH_MEDIUM,
  thick: STROKE_WIDTH_THICK,
} as const;

export type PenWidthKey = keyof typeof PEN_WIDTHS;

export type DrawingTool = 'pen' | 'highlighter' | 'eraser' | 'line';

export function strokePointsLiteral(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

export function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.min(Math.max(point.x, 0), width),
    y: Math.min(Math.max(point.y, 0), height),
  };
}

export function appendPoint(
  points: Point[],
  point: Point,
  width: number,
  height: number,
  minDistance = 0.5,
): Point[] {
  const clamped = clampPoint(point, width, height);
  const last = points[points.length - 1];
  if (last !== undefined) {
    const dx = clamped.x - last.x;
    const dy = clamped.y - last.y;
    if (dx * dx + dy * dy < minDistance * minDistance) {
      return points;
    }
  }
  return [...points, clamped];
}

export function effectiveStrokeWidth(stroke: Stroke, pressure: number | undefined): number {
  if (pressure === undefined || !Number.isFinite(pressure) || pressure <= 0) {
    return stroke.width;
  }
  const scale = Math.min(Math.max(pressure, 0.2), 1);
  return Math.max(0.5, stroke.width * scale);
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const ddx = px - ax;
    const ddy = py - ay;
    return Math.hypot(ddx, ddy);
  }
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function strokeHitDistance(stroke: Stroke, x: number, y: number): number {
  const points = stroke.points;
  if (points.length === 0) {
    return Infinity;
  }
  if (points.length === 1) {
    const only = points[0]!;
    return Math.hypot(x - only.x, y - only.y);
  }
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    best = Math.min(best, pointSegmentDistance(x, y, a.x, a.y, b.x, b.y));
  }
  return best;
}

/** Whole-stroke eraser: returns the index of the first stroke within the hit threshold. */
export function strokeIndexAtPoint(strokes: readonly Stroke[], x: number, y: number): number {
  const threshold = 12;
  let bestIndex = -1;
  let bestDistance = threshold;
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index]!;
    const distance = strokeHitDistance(stroke, x, y);
    const hitWidth = Math.max(stroke.width, 4);
    if (distance <= hitWidth && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function removeStrokeAtIndex(strokes: readonly Stroke[], index: number): Stroke[] {
  if (index < 0 || index >= strokes.length) {
    return strokes.slice();
  }
  return strokes.filter((_, strokeIndex) => strokeIndex !== index);
}

export function isHighlighterColor(color: string): boolean {
  const normalized = color.toLowerCase();
  return (HIGHLIGHTER_COLORS as readonly string[]).includes(normalized);
}