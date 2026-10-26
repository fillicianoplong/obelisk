import { useLayoutEffect, useRef } from 'react';

interface TabGlyphProps {
  kind: 'close' | 'new';
}

// The close diagonals span an 8 px box, centred in the 24 px close button.
// Each new-tab bar is 10 px long and is centred in the 32 px new-tab button.
// Both use a 2 px stroke and the same square caps. The 10 px bars meet on a
// whole pixel. The new-tab mark turns antialiasing off, and devicePixelOffset
// moves the icon onto a device pixel, so the stroke stays crisp at 100% and 200%.
const CLOSE = 8;
const ADDED = 10;
const STROKE = 2;
const CAP = STROKE / 2;
// A square cap on a diagonal reaches STROKE / √2 past the endpoint on each axis.
const DIAGONAL = STROKE / Math.SQRT2;

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: STROKE,
  strokeLinecap: 'square' as const,
};

export function devicePixelOffset(position: number, dpr: number): number {
  const scale = dpr > 0 ? dpr : 1;
  return (Math.round(position * scale) - position * scale) / scale;
}

function resolutionQuery(): string {
  return `(resolution: ${Number(window.devicePixelRatio.toFixed(6))}dppx)`;
}

function snapGlyph(node: SVGSVGElement): void {
  node.style.transform = '';
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return;
  }
  const dx = devicePixelOffset(rect.x, window.devicePixelRatio);
  const dy = devicePixelOffset(rect.y, window.devicePixelRatio);
  if (dx !== 0 || dy !== 0) {
    node.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}

export function TabGlyph({ kind }: TabGlyphProps) {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    snapGlyph(node);
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => snapGlyph(node));
    };
    const strip = node.closest('.tab-strip');
    const list = strip?.querySelector('.tab-list');
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    if (list) {
      observer.observe(list);
      list.addEventListener('scroll', schedule, { passive: true });
    }
    window.addEventListener('resize', schedule);
    let alive = true;
    let follow = 0;
    let snapDpr = window.devicePixelRatio;
    let resolution = window.matchMedia(resolutionQuery());
    const onResolution = () => {
      resolution.removeEventListener('change', onResolution);
      // devicePixelRatio often updates a few frames after the media query.
      let frames = 0;
      const watch = () => {
        if (!alive) {
          return;
        }
        frames += 1;
        const query = window.matchMedia(resolutionQuery());
        const moved = window.devicePixelRatio !== snapDpr;
        if ((moved && query.matches && frames >= 2) || frames >= 20) {
          snapGlyph(node);
          snapDpr = window.devicePixelRatio;
          resolution = window.matchMedia(resolutionQuery());
          resolution.addEventListener('change', onResolution);
          return;
        }
        follow = requestAnimationFrame(watch);
      };
      cancelAnimationFrame(follow);
      follow = requestAnimationFrame(watch);
    };
    resolution.addEventListener('change', onResolution);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(follow);
      observer.disconnect();
      list?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      resolution.removeEventListener('change', onResolution);
    };
  }, []);

  const size = kind === 'close' ? CLOSE : ADDED;
  const edge = Number(DIAGONAL.toFixed(4));
  const far = Number((CLOSE - DIAGONAL).toFixed(4));
  const close = `M${edge} ${edge} L${far} ${far} M${far} ${edge} L${edge} ${far}`;
  const crisp = Math.ceil(ADDED / 2);
  const added = `M${crisp} ${CAP} V${ADDED - CAP} M${CAP} ${crisp} H${ADDED - CAP}`;
  return (
    <svg
      ref={ref}
      className="tab-glyph"
      data-tab-glyph={kind}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      overflow="visible"
      shapeRendering={kind === 'new' ? 'crispEdges' : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <path {...stroke} d={kind === 'close' ? close : added} />
    </svg>
  );
}
