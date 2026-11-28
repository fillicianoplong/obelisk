import { sampleDiagramEdgeStroke } from '../../../shared/diagram/mermaid-palette.js';
import type { DiagramRenderTarget } from '../../../shared/diagram/render-target.js';
import { renderDiagramSource } from './render.js';

export const PROBE_FLOWCHART_WITH_EDGE = `flowchart LR
  Start([Start]) -->|go| Done([Done])`;

function diagramStyleNonce(): string {
  const nonce = (globalThis as { window?: { obeliskStyleNonce?: string } }).window?.obeliskStyleNonce;
  return typeof nonce === 'string' && nonce.length > 0 ? nonce : '';
}

async function edgeStrokeAfterRender(
  mount: HTMLElement,
  source: string,
  target: DiagramRenderTarget,
  diagramKey: string,
): Promise<string | null> {
  const result = await renderDiagramSource(source, diagramKey, mount, diagramStyleNonce(), target);
  if (!result.ok) {
    return null;
  }
  const svg = mount.querySelector('svg');
  return svg instanceof SVGSVGElement ? sampleDiagramEdgeStroke(svg) : null;
}

export async function probeDiagramEdgeStroke(
  source: string,
  target: DiagramRenderTarget,
  diagramKey: string,
): Promise<string | null> {
  const mount = document.createElement('div');
  mount.hidden = true;
  document.body.append(mount);
  try {
    return await edgeStrokeAfterRender(mount, source, target, diagramKey);
  } finally {
    mount.remove();
  }
}

export async function mountDiagramExportPreview(
  source: string,
  mount: HTMLElement,
  diagramKey: string,
): Promise<string | null> {
  return edgeStrokeAfterRender(mount, source, 'export', diagramKey);
}