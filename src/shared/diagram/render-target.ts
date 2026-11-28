export type DiagramRenderTarget = 'screen-light' | 'screen-dark' | 'export';

export interface DiagramThemeRoot {
  dataset: { theme?: string };
}

export function isDarkDocumentTheme(root: DiagramThemeRoot): boolean {
  const explicit = root.dataset.theme;
  if (explicit === 'dark') {
    return true;
  }
  if (explicit === 'light') {
    return false;
  }
  if (typeof globalThis.matchMedia === 'function') {
    return globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function screenDiagramRenderTarget(root?: DiagramThemeRoot): 'screen-light' | 'screen-dark' {
  const resolved = root ?? (typeof document !== 'undefined' ? document.documentElement : { dataset: {} });
  return isDarkDocumentTheme(resolved) ? 'screen-dark' : 'screen-light';
}