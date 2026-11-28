import { useEffect, useRef } from 'react';
import type { SignatureStroke, SignatureStrokePoint } from './raster.js';

interface DrawCanvasProps {
  strokesRef: React.MutableRefObject<SignatureStroke[]>;
}

function paint(canvas: HTMLCanvasElement, strokes: readonly SignatureStroke[]): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  if (canvas.width !== Math.round(width * devicePixelRatio) || canvas.height !== Math.round(height * devicePixelRatio)) {
    canvas.width = Math.round(width * devicePixelRatio);
    canvas.height = Math.round(height * devicePixelRatio);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ink = getComputedStyle(canvas).getPropertyValue('--color-text-primary').trim()
    || getComputedStyle(canvas).color
    || '#000000';
  ctx.strokeStyle = ink;
  for (const stroke of strokes) {
    if (stroke.points.length < 2) {
      continue;
    }
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    const first = stroke.points[0];
    if (!first) {
      continue;
    }
    ctx.moveTo(first.x, first.y);
    for (let index = 1; index < stroke.points.length; index += 1) {
      const point = stroke.points[index];
      if (point) {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();
  }
}

export function DrawCanvas({ strokesRef }: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<SignatureStroke | null>(null);

  function redraw(): void {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const preview = activeStroke.current;
    const list = preview ? [...strokesRef.current, preview] : strokesRef.current;
    paint(canvas, list);
  }

  useEffect(() => {
    redraw();
  });

  function pointFromEvent(event: PointerEvent, canvas: HTMLCanvasElement): SignatureStrokePoint | null {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return null;
    }
    return { x, y };
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event.nativeEvent, canvas);
    if (point === null) {
      return;
    }
    activeStroke.current = { points: [point], width: 2.5 };
    redraw();
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    const stroke = activeStroke.current;
    if (canvas === null || stroke === null) {
      return;
    }
    const point = pointFromEvent(event.nativeEvent, canvas);
    if (point === null) {
      return;
    }
    stroke.points.push(point);
    redraw();
  }

  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    const stroke = activeStroke.current;
    if (canvas === null) {
      return;
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (stroke !== null && stroke.points.length >= 2) {
      strokesRef.current.push(stroke);
    }
    activeStroke.current = null;
    redraw();
  }

  return (
    <canvas
      ref={canvasRef}
      className="signature-draw-canvas"
      aria-label="Draw your signature"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    />
  );
}