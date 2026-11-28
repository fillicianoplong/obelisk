import type { DiagramRenderTarget } from './render-target.js';

export const DOCUMENT_DIAGRAM_STROKE = '#1F2630';
export const SCREEN_DARK_DIAGRAM_STROKE = '#E6EAF0';

export interface MermaidPaletteConfig {
  theme: 'default' | 'base';
  themeVariables: Record<string, string>;
}

const DOCUMENT_DIAGRAM_PALETTE: MermaidPaletteConfig = {
  theme: 'default',
  themeVariables: {
    background: '#FFFFFF',
    mainBkg: '#FFFFFF',
    lineColor: DOCUMENT_DIAGRAM_STROKE,
    arrowheadColor: DOCUMENT_DIAGRAM_STROKE,
    defaultLinkColor: DOCUMENT_DIAGRAM_STROKE,
    primaryTextColor: DOCUMENT_DIAGRAM_STROKE,
    secondaryTextColor: '#4A5361',
    tertiaryTextColor: '#4A5361',
    textColor: DOCUMENT_DIAGRAM_STROKE,
    primaryBorderColor: '#737D8D',
    edgeLabelBackground: '#FFFFFF',
    nodeBorder: '#737D8D',
    clusterBorder: '#737D8D',
    titleColor: DOCUMENT_DIAGRAM_STROKE,
    labelTextColor: DOCUMENT_DIAGRAM_STROKE,
  },
};

const SCREEN_DARK_DIAGRAM_PALETTE: MermaidPaletteConfig = {
  theme: 'base',
  themeVariables: {
    background: '#252B33',
    mainBkg: '#2B313A',
    primaryColor: '#3A424D',
    primaryTextColor: SCREEN_DARK_DIAGRAM_STROKE,
    primaryBorderColor: '#C3CBD6',
    lineColor: SCREEN_DARK_DIAGRAM_STROKE,
    arrowheadColor: SCREEN_DARK_DIAGRAM_STROKE,
    defaultLinkColor: SCREEN_DARK_DIAGRAM_STROKE,
    textColor: SCREEN_DARK_DIAGRAM_STROKE,
    secondaryTextColor: '#C3CBD6',
    tertiaryTextColor: '#C3CBD6',
    edgeLabelBackground: '#252B33',
    nodeBorder: '#C3CBD6',
    clusterBorder: '#C3CBD6',
    titleColor: SCREEN_DARK_DIAGRAM_STROKE,
    labelTextColor: SCREEN_DARK_DIAGRAM_STROKE,
  },
};

export function mermaidPaletteForTarget(target: DiagramRenderTarget): MermaidPaletteConfig {
  if (target === 'screen-dark') {
    return SCREEN_DARK_DIAGRAM_PALETTE;
  }
  return DOCUMENT_DIAGRAM_PALETTE;
}

export function diagramPaletteStrokeColor(target: DiagramRenderTarget): string {
  return mermaidPaletteForTarget(target).themeVariables.lineColor;
}

export function sampleDiagramEdgeStroke(svg: SVGSVGElement): string | null {
  const selectors = [
    'path.flowchart-link',
    'g.edgePaths path',
    'g.edgePaths .path',
    'path[class*="flowchart"]',
  ];
  for (const selector of selectors) {
    const path = svg.querySelector(selector);
    if (path instanceof SVGPathElement) {
      const attribute = path.getAttribute('stroke');
      if (typeof attribute === 'string' && attribute.length > 0) {
        return attribute.trim().toLowerCase();
      }
      if (svg.isConnected) {
        const computed = globalThis.getComputedStyle(path).stroke;
        if (typeof computed === 'string' && computed.length > 0 && computed !== 'none') {
          return computed.trim().toLowerCase();
        }
      }
    }
  }
  return null;
}