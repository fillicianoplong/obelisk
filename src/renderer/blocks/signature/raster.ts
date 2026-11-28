const PX_PER_IN = 96;
const DRAW_HEIGHT_PX = 120;
const DRAW_WIDTH_PX = 480;
const STROKE_COLOR = '#000000';

export interface SignatureStrokePoint {
  x: number;
  y: number;
}

export interface SignatureStroke {
  points: SignatureStrokePoint[];
  width: number;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (blob === null) {
        resolve(null);
        return;
      }
      const buffer = await blob.arrayBuffer();
      resolve(new Uint8Array(buffer));
    }, 'image/png');
  });
}

export async function pngFromStrokes(strokes: readonly SignatureStroke[]): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas');
  canvas.width = DRAW_WIDTH_PX;
  canvas.height = DRAW_HEIGHT_PX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = STROKE_COLOR;
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
  return canvasBlob(canvas);
}

export async function pngFromTypedText(text: string): Promise<Uint8Array | null> {
  const trimmed = text.trim();
  if (trimmed.length < 1) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = DRAW_WIDTH_PX;
  canvas.height = DRAW_HEIGHT_PX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = STROKE_COLOR;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  let size = 64;
  ctx.font = `${size}px "Dancing Script"`;
  while (size > 18 && ctx.measureText(trimmed).width > canvas.width - 40) {
    size -= 2;
    ctx.font = `${size}px "Dancing Script"`;
  }
  ctx.fillText(trimmed, canvas.width / 2, canvas.height / 2);
  return canvasBlob(canvas);
}

export function defaultSignatureWidth(): number {
  return Math.round((DRAW_WIDTH_PX / PX_PER_IN) * 1000) / 1000;
}