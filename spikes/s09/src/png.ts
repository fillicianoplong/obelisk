import { deflateSync } from 'node:zlib';

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const BLACK: Rgb = { r: 20, g: 20, b: 20 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

const FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ',': [0, 0, 0, 0, 0, 0b01100, 0b01000],
  ':': [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  '+': [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
  '/': [0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0, 0],
  '=': [0, 0, 0b11111, 0, 0b11111, 0, 0],
  '(': [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ')': [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  '^': [0b00100, 0b01010, 0b10001, 0, 0, 0, 0],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
};

export class Canvas {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8Array;

  constructor(width: number, height: number, fill: Rgb = WHITE) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3);
    this.fillRect(0, 0, width, height, fill);
  }

  set(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    const i = (y * this.width + x) * 3;
    this.pixels[i] = color.r;
    this.pixels[i + 1] = color.g;
    this.pixels[i + 2] = color.b;
  }

  fillRect(x: number, y: number, w: number, h: number, color: Rgb): void {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        this.set(xx, yy, color);
      }
    }
  }

  disk(cx: number, cy: number, radius: number, color: Rgb): void {
    const r2 = radius * radius;
    const x0 = Math.floor(cx - radius);
    const y0 = Math.floor(cy - radius);
    const x1 = Math.ceil(cx + radius);
    const y1 = Math.ceil(cy + radius);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) {
          this.set(x, y, color);
        }
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: Rgb = BLACK): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    const radius = width / 2;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      this.disk(x0 + dx * t, y0 + dy * t, radius, color);
    }
  }

  quad(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, width: number, color: Rgb = BLACK): void {
    const steps = Math.max(8, Math.ceil(Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy)));
    let px = x0;
    let py = y0;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const u = 1 - t;
      const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
      const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      this.line(px, py, x, y, width, color);
      px = x;
      py = y;
    }
  }

  text(x: number, y: number, value: string, scale: number, color: Rgb = BLACK): number {
    let cursor = x;
    for (const ch of value) {
      const rows = FONT[ch] ?? FONT[ch.toUpperCase()] ?? [0b11111, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11111];
      rows.forEach((bits, row) => {
        for (let col = 0; col < 5; col += 1) {
          if ((bits & (1 << (4 - col))) !== 0) {
            this.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
          }
        }
      });
      cursor += 6 * scale;
    }
    return cursor;
  }

  textWidth(value: string, scale: number): number {
    return value.length * 6 * scale;
  }

  png(): Buffer {
    const stride = this.width * 3 + 1;
    const raw = Buffer.alloc(stride * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * stride] = 0;
      const start = y * this.width * 3;
      for (let x = 0; x < this.width * 3; x += 1) {
        raw[y * stride + 1 + x] = this.pixels[start + x];
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

/** Pictures are drawn at this many pixels per displayed pixel. */
export const PIXEL_DENSITY = 2;

export const FRACTION_DISPLAY = [260, 150] as const;
export const RADICAL_DISPLAY = [380, 120] as const;
export const SUM_DISPLAY = [340, 190] as const;
export const INTEGRAL_DISPLAY = [360, 180] as const;
export const MATRIX_DISPLAY = [220, 160] as const;
export const GREEK_DISPLAY = [420, 130] as const;
export const SWATCH_DISPLAY = [160, 100] as const;
export const DRAWING_DISPLAY = [240, 140] as const;
export const SIGNATURE_DISPLAY = [280, 100] as const;
export const DIAGRAM_DISPLAY = [320, 130] as const;

const ADVANCE: Record<string, number> = {
  ' ': 0.38,
  '+': 0.85,
  '=': 0.85,
  a: 0.82,
  b: 0.82,
  c: 0.72,
  d: 0.82,
  i: 0.42,
  n: 0.86,
  x: 0.78,
  y: 0.78,
  '0': 0.78,
  '1': 0.62,
  '2': 0.78,
};

function pen(size: number): number {
  return Math.max(2.4, size * 0.13);
}

function drawGlyph(canvas: Canvas, ch: string, x: number, y: number, size: number, color: Rgb): void {
  const s = size;
  const w = pen(size);
  const X = (nx: number): number => x + nx * s;
  const Y = (ny: number): number => y + ny * s;
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    canvas.line(X(x0), Y(y0), X(x1), Y(y1), w, color);
  };
  const quad = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): void => {
    canvas.quad(X(x0), Y(y0), X(cx), Y(cy), X(x1), Y(y1), w, color);
  };
  switch (ch) {
    case 'a':
      quad(0.7, 0.48, 0.08, 0.32, 0.14, 0.74);
      quad(0.14, 0.74, 0.18, 1.08, 0.74, 0.96);
      line(0.68, 0.42, 0.68, 1.02);
      break;
    case 'b':
      line(0.16, 0.02, 0.16, 1.02);
      quad(0.16, 0.46, 0.92, 0.38, 0.86, 0.72);
      quad(0.86, 0.72, 0.8, 1.08, 0.16, 0.98);
      break;
    case 'c':
      quad(0.7, 0.48, 0.05, 0.32, 0.12, 0.74);
      quad(0.12, 0.74, 0.08, 1.08, 0.72, 0.96);
      break;
    case 'd':
      line(0.7, 0.02, 0.7, 1.02);
      quad(0.7, 0.46, 0.02, 0.38, 0.08, 0.72);
      quad(0.08, 0.72, 0.08, 1.08, 0.7, 0.98);
      break;
    case 'i':
      canvas.disk(X(0.22), Y(0.16), w * 0.72, color);
      line(0.22, 0.4, 0.22, 1.02);
      break;
    case 'n':
      line(0.16, 0.42, 0.16, 1.02);
      quad(0.16, 0.52, 0.9, 0.28, 0.78, 1.02);
      break;
    case 'x':
      line(0.1, 0.42, 0.72, 1.02);
      line(0.72, 0.42, 0.1, 1.02);
      break;
    case 'y':
      line(0.1, 0.42, 0.42, 0.86);
      line(0.74, 0.42, 0.22, 1.28);
      break;
    case '0':
      quad(0.4, 0.08, 0.02, 0.08, 0.08, 0.52);
      quad(0.08, 0.52, 0.02, 1.02, 0.4, 1.02);
      quad(0.4, 1.02, 0.78, 1.02, 0.7, 0.52);
      quad(0.7, 0.52, 0.78, 0.08, 0.4, 0.08);
      break;
    case '1':
      line(0.22, 0.28, 0.42, 0.08);
      line(0.42, 0.08, 0.42, 1.02);
      line(0.18, 1.02, 0.64, 1.02);
      break;
    case '2':
      quad(0.1, 0.36, 0.28, -0.02, 0.62, 0.28);
      quad(0.62, 0.28, 0.78, 0.55, 0.1, 1.02);
      line(0.1, 1.02, 0.74, 1.02);
      break;
    case '+':
      line(0.42, 0.32, 0.42, 0.92);
      line(0.12, 0.62, 0.72, 0.62);
      break;
    case '=':
      line(0.08, 0.42, 0.76, 0.42);
      line(0.08, 0.72, 0.76, 0.72);
      break;
    default:
      break;
  }
}

export function measureText(value: string, size: number): number {
  let width = 0;
  for (const ch of value) {
    width += (ADVANCE[ch] ?? 0.7) * size;
  }
  return width;
}

export function drawText(canvas: Canvas, x: number, y: number, value: string, size: number, color: Rgb = BLACK): number {
  let cursor = x;
  for (const ch of value) {
    if (ch !== ' ') {
      drawGlyph(canvas, ch, cursor, y, size, color);
    }
    cursor += (ADVANCE[ch] ?? 0.7) * size;
  }
  return cursor;
}

function at2x(displayWidth: number, displayHeight: number, fill: Rgb = WHITE): Canvas {
  return new Canvas(displayWidth * PIXEL_DENSITY, displayHeight * PIXEL_DENSITY, fill);
}

export function labelImage(lines: readonly string[], fill: Rgb = WHITE): Buffer {
  const scale = 4;
  const width = Math.max(...lines.map((line) => line.length * 6 * scale), 40) + 32;
  const height = lines.length * 10 * scale + 32;
  const canvas = new Canvas(width, height, fill);
  lines.forEach((line, index) => {
    const x = Math.max(16, Math.floor((width - canvas.textWidth(line, scale)) / 2));
    canvas.text(x, 16 + index * 10 * scale, line, scale);
  });
  return canvas.png();
}

export function fractionImage(): Buffer {
  const [dw, dh] = FRACTION_DISPLAY;
  const canvas = at2x(dw, dh);
  const size = 42;
  const num = 'a+b';
  const den = 'c';
  const numW = measureText(num, size);
  const denW = measureText(den, size);
  const mid = canvas.width / 2;
  drawText(canvas, mid - numW / 2, 28, num, size);
  const bar = Math.max(numW, denW) + 36;
  canvas.line(mid - bar / 2, 118, mid + bar / 2, 118, 5);
  drawText(canvas, mid - denW / 2, 138, den, size);
  return canvas.png();
}

export function radicalImage(): Buffer {
  const [dw, dh] = RADICAL_DISPLAY;
  const canvas = at2x(dw, dh);
  const size = 40;
  const yText = 48;
  const barY = 42;
  canvas.line(28, 92, 52, 128, 5);
  canvas.line(52, 128, 96, barY, 5);
  const pieces: Array<{ text: string; rise: number; scale: number }> = [
    { text: 'x', rise: 0, scale: 1 },
    { text: '2', rise: 22, scale: 0.62 },
    { text: '+', rise: 0, scale: 1 },
    { text: 'y', rise: 0, scale: 1 },
    { text: '2', rise: 22, scale: 0.62 },
  ];
  let cursor = 118;
  for (const piece of pieces) {
    const pieceSize = size * piece.scale;
    cursor = drawText(canvas, cursor, yText - piece.rise, piece.text, pieceSize);
    cursor += 4;
  }
  canvas.line(96, barY, cursor + 16, barY, 5);
  return canvas.png();
}

function sigma(canvas: Canvas, x: number, y: number, w: number, h: number): void {
  const thick = 8;
  const vertexX = x + w * 0.62;
  const midY = y + h / 2;
  canvas.line(x, y, x + w, y, thick);
  canvas.line(x, y + h, x + w, y + h, thick);
  canvas.line(x, y, vertexX, midY, thick);
  canvas.line(vertexX, midY, x, y + h, thick);
}

export function sumImage(): Buffer {
  const [dw, dh] = SUM_DISPLAY;
  const canvas = at2x(dw, dh);
  const size = 36;
  sigma(canvas, 36, 78, 92, 150);
  const top = 'n';
  drawText(canvas, 36 + (92 - measureText(top, size)) / 2, 18, top, size);
  const sub = 'i=1';
  drawText(canvas, 24, 248, sub, size * 0.85);
  const cursor = drawText(canvas, 160, 130, 'i', size);
  drawText(canvas, cursor + 2, 108, '2', size * 0.62);
  return canvas.png();
}

function integralSign(canvas: Canvas, x: number, y: number, h: number): void {
  const thick = 7;
  const steps = 48;
  let px = x + h * 0.16;
  let py = y;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const curl = Math.cos(t * Math.PI) * h * 0.16;
    const nx = x + curl;
    const ny = y + t * h;
    canvas.line(px, py, nx, ny, thick);
    px = nx;
    py = ny;
  }
}

export function integralImage(): Buffer {
  const [dw, dh] = INTEGRAL_DISPLAY;
  const canvas = at2x(dw, dh);
  const size = 38;
  const signX = 70;
  const signY = 48;
  const signH = 250;
  integralSign(canvas, signX, signY, signH);
  drawText(canvas, signX + 36, signY - 8, '1', size * 0.7);
  drawText(canvas, signX - 8, signY + signH - 28, '0', size * 0.7);
  let cursor = drawText(canvas, 168, 130, 'x', size);
  cursor += 14;
  drawText(canvas, cursor, 130, 'dx', size);
  return canvas.png();
}

function parenthesis(canvas: Canvas, x: number, y: number, h: number, facing: 1 | -1): void {
  const thick = 5;
  const bend = 18 * facing;
  canvas.quad(x, y, x + bend, y + h * 0.25, x + bend * 0.35, y + h / 2, thick);
  canvas.quad(x + bend * 0.35, y + h / 2, x + bend, y + h * 0.75, x, y + h, thick);
}

export function matrixImage(): Buffer {
  const [dw, dh] = MATRIX_DISPLAY;
  const canvas = at2x(dw, dh);
  const size = 40;
  parenthesis(canvas, 54, 36, canvas.height - 72, -1);
  parenthesis(canvas, canvas.width - 54, 36, canvas.height - 72, 1);
  const col1 = 100;
  const col2 = 210;
  drawText(canvas, col1, 52, '1', size);
  drawText(canvas, col2, 52, '0', size);
  drawText(canvas, col1, 168, '0', size);
  drawText(canvas, col2, 168, '1', size);
  return canvas.png();
}

function drawTheta(canvas: Canvas, cx: number, cy: number, radius: number): void {
  const thick = 6;
  const steps = 36;
  let px = cx + radius;
  let py = cy;
  for (let i = 1; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const nx = cx + Math.cos(t) * radius;
    const ny = cy + Math.sin(t) * radius * 1.15;
    canvas.line(px, py, nx, ny, thick);
    px = nx;
    py = ny;
  }
  canvas.line(cx - radius * 0.72, cy, cx + radius * 0.72, cy, thick);
}

function drawAlpha(canvas: Canvas, x: number, y: number, size: number): void {
  const w = pen(size);
  const X = (nx: number): number => x + nx * size;
  const Y = (ny: number): number => y + ny * size;
  canvas.quad(X(0.72), Y(0.15), X(0.05), Y(0.05), X(0.18), Y(0.55), w);
  canvas.quad(X(0.18), Y(0.55), X(0.28), Y(1.05), X(0.78), Y(0.72), w);
  canvas.line(X(0.48), Y(0.58), X(0.9), Y(1.05), w);
}

function drawBeta(canvas: Canvas, x: number, y: number, size: number): void {
  const w = pen(size);
  const X = (nx: number): number => x + nx * size;
  const Y = (ny: number): number => y + ny * size;
  canvas.line(X(0.22), Y(-0.05), X(0.22), Y(1.05), w);
  canvas.quad(X(0.22), Y(0.02), X(0.95), Y(0.0), X(0.22), Y(0.48), w);
  canvas.quad(X(0.22), Y(0.48), X(0.98), Y(0.5), X(0.22), Y(1.0), w);
}

export function greekImage(): Buffer {
  const [dw, dh] = GREEK_DISPLAY;
  const canvas = at2x(dw, dh);
  const size = 52;
  const base = 78;
  drawTheta(canvas, 78, base + 8, 28);
  canvas.line(58, 28, 78, 8, 5);
  canvas.line(78, 8, 98, 28, 5);
  let cursor = 140;
  cursor = drawText(canvas, cursor, base, '=', size);
  cursor += 16;
  drawAlpha(canvas, cursor, base, size);
  cursor += size * 0.95;
  cursor = drawText(canvas, cursor, base, '+', size);
  cursor += 8;
  drawBeta(canvas, cursor, base, size);
  return canvas.png();
}

export function swatch(fill: Rgb, mark: string): Buffer {
  const [dw, dh] = SWATCH_DISPLAY;
  const canvas = at2x(dw, dh, fill);
  const scale = 6;
  const ink = fill.r + fill.g + fill.b > 380 ? BLACK : WHITE;
  const x = Math.max(8, Math.floor((canvas.width - canvas.textWidth(mark, scale)) / 2));
  canvas.text(x, Math.floor((canvas.height - 7 * scale) / 2), mark, scale, ink);
  return canvas.png();
}

export function drawingImage(): Buffer {
  const [dw, dh] = DRAWING_DISPLAY;
  const canvas = at2x(dw, dh, { r: 255, g: 248, b: 236 });
  const blue = { r: 36, g: 86, b: 158 };
  const ink = { r: 40, g: 44, b: 52 };
  canvas.disk(90, 78, 36, { r: 232, g: 176, b: 74 });
  canvas.fillRect(48, 130, 150, 100, blue);
  canvas.line(48, 130, 198, 130, 4, ink);
  canvas.line(198, 130, 198, 230, 4, ink);
  canvas.line(198, 230, 48, 230, 4, ink);
  canvas.line(48, 230, 48, 130, 4, ink);
  canvas.line(250, 168, 400, 168, 6, ink);
  canvas.line(400, 168, 372, 148, 6, ink);
  canvas.line(400, 168, 372, 188, 6, ink);
  return canvas.png();
}

export function signatureImage(): Buffer {
  const [dw, dh] = SIGNATURE_DISPLAY;
  const canvas = at2x(dw, dh, WHITE);
  const ink = { r: 22, g: 42, b: 120 };
  const steps = 220;
  let px = 36;
  let py = 110;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const nx = 36 + t * 460;
    const ny = 108 + Math.sin(t * Math.PI * 3.2) * 28 + Math.sin(t * Math.PI * 8) * 8;
    canvas.line(px, py, nx, ny, 4.5, ink);
    px = nx;
    py = ny;
  }
  canvas.line(40, 156, 500, 156, 3, BLACK);
  return canvas.png();
}

export function diagramImage(): Buffer {
  const [dw, dh] = DIAGRAM_DISPLAY;
  const canvas = at2x(dw, dh, WHITE);
  const leftFill = { r: 214, g: 226, b: 206 };
  const rightFill = { r: 206, g: 218, b: 236 };
  const ink = BLACK;
  const box = (x: number, y: number, w: number, h: number, fill: Rgb): void => {
    canvas.fillRect(x, y, w, h, fill);
    canvas.line(x, y, x + w, y, 4, ink);
    canvas.line(x + w, y, x + w, y + h, 4, ink);
    canvas.line(x + w, y + h, x, y + h, 4, ink);
    canvas.line(x, y + h, x, y, 4, ink);
  };
  box(28, 60, 150, 110, leftFill);
  box(460, 60, 150, 110, rightFill);
  canvas.line(178, 115, 430, 115, 5, ink);
  canvas.line(430, 115, 400, 96, 5, ink);
  canvas.line(430, 115, 400, 134, 5, ink);
  canvas.text(82, 96, 'A', 5);
  canvas.text(514, 96, 'B', 5);
  return canvas.png();
}

export const RED: Rgb = { r: 180, g: 40, b: 40 };
export const BLUE: Rgb = { r: 30, g: 70, b: 140 };
export const GREEN: Rgb = { r: 30, g: 120, b: 70 };
