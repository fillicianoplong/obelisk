interface Row {
  name: string;
  value: string;
}

interface ViewState {
  phase: string;
  headline: string;
  doing: string;
  electronVersion: string;
  packaged: boolean;
  windowsStore: boolean;
  rows: Row[];
  reportPath: string;
  banner: string;
  manual: boolean;
}

interface S07Bridge {
  getState(): Promise<ViewState>;
  close(): Promise<ViewState>;
}

function bridge(): S07Bridge | null {
  const candidate = window as Window & { s07?: S07Bridge };
  return candidate.s07 ?? null;
}

const root = document.getElementById('root');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string },
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const child of children) node.append(child);
  return node;
}

function render(state: ViewState): void {
  if (!root) return;
  root.replaceChildren();
  root.append(
    el('h1', { text: 'Spike S-07' }),
    el('p', {
      className: 'meta',
      text: `Electron ${state.electronVersion} · ${state.headline} · ${state.phase}`,
    }),
    el('p', { className: 'banner', text: state.banner }),
    el('p', { className: 'doing', text: state.doing }),
  );
  const card = el('div', { className: 'card' });
  card.append(el('p', {
    text: `Packaged: ${state.packaged ? 'yes' : 'no'}. windowsStore: ${state.windowsStore ? 'yes' : 'no'}.`,
  }));
  for (const row of state.rows) {
    card.append(el('p', { className: 'path', text: `${row.name}: ${row.value}` }));
  }
  root.append(card);
  if (state.reportPath) {
    root.append(el('h2', { text: 'Report' }));
    root.append(el('p', { className: 'path', text: state.reportPath }));
  }
  if (state.manual && state.doing.includes('written down')) {
    const close = el('button', { text: 'Close' });
    close.type = 'button';
    close.addEventListener('click', () => {
      const api = bridge();
      if (!api) return;
      void api.close();
    });
    root.append(el('div', { className: 'action' }, close));
  }
}

async function paint(): Promise<void> {
  if (!root) return;
  const api = bridge();
  if (!api) {
    root.textContent = 'The preload bridge is missing.';
    return;
  }
  try {
    render(await api.getState());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    root.textContent = `The page failed: ${message}`;
  }
}

void paint();
window.setInterval(() => {
  void paint();
}, 250);
