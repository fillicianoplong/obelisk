let watching = false;
const repaintCallbacks = new Set<() => void>();

function fireDiagramThemeChange(): void {
  for (const callback of repaintCallbacks) {
    callback();
  }
}

function ensureDiagramThemeWatch(): void {
  if (watching) {
    return;
  }
  watching = true;
  const root = document.documentElement;
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.attributeName === 'data-theme')) {
      fireDiagramThemeChange();
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', fireDiagramThemeChange);
  window.obeliskTheme?.onChanged(() => {
    fireDiagramThemeChange();
  });
}

export function registerDiagramRepaint(callback: () => void): () => void {
  ensureDiagramThemeWatch();
  repaintCallbacks.add(callback);
  return () => {
    repaintCallbacks.delete(callback);
  };
}