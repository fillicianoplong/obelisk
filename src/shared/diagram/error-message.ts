export const DIAGRAM_ERROR_HEADLINE = "Couldn't draw this diagram. Check the Mermaid syntax.";

export function formatDiagramRenderError(raw: string): { headline: string; detail: string | null } {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';
  const cleaned = firstLine.replace(/\s+for text:\s*.*$/i, '').trim();
  const detail = cleaned.length > 0 && cleaned !== DIAGRAM_ERROR_HEADLINE ? cleaned : null;
  return { headline: DIAGRAM_ERROR_HEADLINE, detail };
}

export function extractMermaidErrorText(svg: SVGSVGElement): string | null {
  const labels = [...svg.querySelectorAll('text, tspan')]
    .map((node) => (node.textContent ?? '').trim())
    .filter((text) => text.length > 0);
  const text = labels.join(' ').trim();
  return text.length > 0 ? text : null;
}

export function looksLikeMermaidErrorSvg(svg: SVGSVGElement): boolean {
  if (svg.querySelector('.error-icon, .error-text, [class*="error"]')) {
    return true;
  }
  const text = extractMermaidErrorText(svg) ?? '';
  return /No diagram type detected|Parse error on line|Syntax error in graph|Lexical error/i.test(text);
}