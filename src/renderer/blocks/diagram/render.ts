import type { MermaidConfig } from 'mermaid';
import mermaid from 'mermaid';
import { mermaidPaletteForTarget } from '../../../shared/diagram/mermaid-palette.js';
import { MERMAID_SECURE_KEYS } from '../../../shared/diagram/options.js';
import type { DiagramRenderTarget } from '../../../shared/diagram/render-target.js';
import { sanitizeDiagramSource } from '../../../shared/diagram/sanitize-source.js';
import {
  extractMermaidErrorText,
  looksLikeMermaidErrorSvg,
} from '../../../shared/diagram/error-message.js';
import {
  collectMovedStyleRules,
  sanitizeDiagramSheet,
  stripDiagramNavigation,
} from '../../../shared/diagram/svg-postprocess.js';

let activeTarget: DiagramRenderTarget | undefined;

function ensureMermaid(target: DiagramRenderTarget): void {
  if (activeTarget === target) {
    return;
  }
  const palette = mermaidPaletteForTarget(target);
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    fontFamily: 'sans-serif',
    theme: palette.theme,
    themeVariables: { ...palette.themeVariables },
    layout: 'dagre',
    maxTextSize: 50_000,
    suppressErrorRendering: true,
    secure: [...MERMAID_SECURE_KEYS],
  };
  mermaid.initialize(config);
  activeTarget = target;
}

export interface DiagramRenderResult {
  ok: boolean;
  error: string | null;
  hasStyleAttributes: boolean;
  hasHrefs: boolean;
  width: number;
  height: number;
  labels: string[];
}

function measureSvg(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.getBoundingClientRect();
  if (box.width > 0 && box.height > 0) {
    return { width: box.width, height: box.height };
  }
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.split(/\s+/).map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  try {
    const bbox = svg.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height };
    }
  } catch {
    // SVG may not be connected yet.
  }
  return { width: 0, height: 0 };
}

function diagramTextLabels(svg: SVGSVGElement): string[] {
  return [...svg.querySelectorAll('text, tspan')]
    .map((node) => (node.textContent ?? '').trim())
    .filter((text) => text.length > 0);
}

function withNoncedStyles<T>(styleNonce: string, run: () => Promise<T>): Promise<T> {
  if (styleNonce.length === 0) {
    return run();
  }
  const stampStyle = (root: ParentNode): void => {
    for (const style of root.querySelectorAll('style')) {
      if (style.nonce.length === 0) {
        style.nonce = styleNonce;
      }
    }
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLStyleElement && node.nonce.length === 0) {
          node.nonce = styleNonce;
        } else if (node instanceof HTMLElement) {
          stampStyle(node);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  stampStyle(document);
  return run().finally(() => {
    observer.disconnect();
  });
}

export function mountDiagramSvg(
  svgText: string,
  mount: HTMLElement,
  diagramKey: string,
  styleNonce: string,
): { svg: SVGSVGElement | null; movedAttributes: number } {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const parsedSvg = parsed.querySelector('svg');
  if (!(parsedSvg instanceof SVGSVGElement)) {
    return { svg: null, movedAttributes: 0 };
  }
  const scopeId = parsedSvg.id || `obelisk-diagram-${diagramKey}`;
  const moved = collectMovedStyleRules(parsedSvg, diagramKey);
  const css = sanitizeDiagramSheet(moved.cssParts.join('\n'), scopeId);
  const live = document.importNode(parsedSvg, true);
  if (!(live instanceof SVGSVGElement)) {
    return { svg: null, movedAttributes: moved.movedAttributes };
  }
  mount.replaceChildren(live);
  if (css.length > 0) {
    const style = document.createElement('style');
    style.nonce = styleNonce;
    style.textContent = css;
    live.appendChild(style);
  }
  stripDiagramNavigation(live);
  void mount.offsetHeight;
  return { svg: live, movedAttributes: moved.movedAttributes };
}

export async function renderDiagramSource(
  source: string,
  diagramKey: string,
  mount: HTMLElement,
  styleNonce: string,
  target: DiagramRenderTarget = 'screen-light',
): Promise<DiagramRenderResult> {
  ensureMermaid(target);
  const trimmed = sanitizeDiagramSource(source).trim();
  if (trimmed.length === 0) {
    mount.replaceChildren();
    return {
      ok: false,
      error: null,
      hasStyleAttributes: false,
      hasHrefs: false,
      width: 0,
      height: 0,
      labels: [],
    };
  }
  const renderId = `obelisk-diagram-${diagramKey}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  try {
    const rendered = await withNoncedStyles(styleNonce, async () => mermaid.render(renderId, trimmed));
    const placed = mountDiagramSvg(rendered.svg, mount, diagramKey, styleNonce);
    if (placed.svg !== null && looksLikeMermaidErrorSvg(placed.svg)) {
      const mermaidMessage = extractMermaidErrorText(placed.svg);
      mount.replaceChildren();
      return {
        ok: false,
        error: mermaidMessage ?? 'The diagram did not produce an image.',
        hasStyleAttributes: false,
        hasHrefs: false,
        width: 0,
        height: 0,
        labels: [],
      };
    }
    if (placed.svg === null) {
      return {
        ok: false,
        error: 'The diagram did not produce an image.',
        hasStyleAttributes: false,
        hasHrefs: false,
        width: 0,
        height: 0,
        labels: [],
      };
    }
    const labels = diagramTextLabels(placed.svg);
    const box = measureSvg(placed.svg);
    const hasGraphic = placed.svg.querySelector('path, rect, circle, ellipse, polygon, line') !== null;
    const ok = labels.length > 0 || hasGraphic;
    return {
      ok,
      error: ok ? null : 'The diagram did not produce an image.',
      hasStyleAttributes: placed.svg.querySelectorAll('[style]').length > 0,
      hasHrefs: [...placed.svg.querySelectorAll('[href], a')]
        .some((element) => {
          const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
          return href.length > 0;
        }),
      width: box.width,
      height: box.height,
      labels,
    };
  } catch (error) {
    mount.replaceChildren();
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      hasStyleAttributes: false,
      hasHrefs: false,
      width: 0,
      height: 0,
      labels: [],
    };
  }
}