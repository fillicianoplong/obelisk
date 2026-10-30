interface CaseRow {
  id: string;
  title: string;
  status: string;
  detail: string;
}

interface PathRow {
  name: string;
  value: string;
}

interface ViewState {
  phase: 'starting' | 'need-folder' | 'running' | 'done';
  headline: string;
  doing: string;
  electronVersion: string;
  packaged: boolean;
  windowsStore: boolean;
  mode: string;
  paths: PathRow[];
  cases: CaseRow[];
  currentId: string | null;
  reportPath: string;
  confirmCommand: string;
  banner: string;
}

interface S01Bridge {
  getState(): Promise<ViewState>;
  useDesktop(): Promise<ViewState>;
  pickFolder(): Promise<ViewState>;
  close(): Promise<ViewState>;
}

function bridge(): S01Bridge | null {
  const candidate = window as Window & { s01?: S01Bridge };
  return candidate.s01 ?? null;
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
    el('h1', { text: 'Spike S-01' }),
    el('p', {
      className: 'meta',
      text: `Electron ${state.electronVersion} · ${state.headline} · ${state.mode}`,
    }),
    el('p', { className: 'banner', text: state.banner }),
  );
  if (state.currentId) {
    root.append(el('h2', { text: 'This case' }));
    root.append(el('p', { className: 'path', text: `case: ${state.currentId}` }));
  }
  root.append(el('p', { className: 'doing', text: state.doing }));

  const paths = el('div', { className: 'card' });
  paths.append(el('p', { text: `Packaged: ${state.packaged ? 'yes' : 'no'}. windowsStore: ${state.windowsStore ? 'yes' : 'no'}.` }));
  for (const row of state.paths) {
    paths.append(el('p', { className: 'path', text: `${row.name}: ${row.value}` }));
  }
  root.append(paths);

  root.append(el('h2', { text: 'Cases' }));
  for (const item of state.cases) {
    const card = el('div', { className: 'card' });
    card.append(el('p', { text: item.title }));
    card.append(el('p', { className: `tag ${item.status}`, text: `${item.id} · ${item.status}` }));
    if (item.detail) card.append(el('p', { text: item.detail }));
    root.append(card);
  }

  if (state.phase === 'need-folder') {
    root.append(el('h2', { text: 'Pick the second folder' }));
    root.append(el('p', {
      text: 'Desktop, or a OneDrive-synced folder. The files go in a folder named Obelisk-Spike-S01 inside it.',
    }));
    const useDesktop = el('button', { text: 'Use Desktop' });
    useDesktop.type = 'button';
    useDesktop.addEventListener('click', () => {
      const api = bridge();
      if (!api) return;
      void api.useDesktop().then(render);
    });
    const pick = el('button', { text: 'Pick a folder' });
    pick.type = 'button';
    pick.addEventListener('click', () => {
      const api = bridge();
      if (!api) return;
      void api.pickFolder().then(render);
    });
    root.append(el('div', { className: 'action' }, useDesktop, pick));
    return;
  }

  if (state.phase === 'done') {
    root.append(el('h2', { text: 'The run is written down.' }));
    root.append(el('p', { className: 'path', text: state.reportPath }));
    if (state.confirmCommand) {
      root.append(el('p', { text: 'Outside check, from a normal PowerShell window:' }));
      root.append(el('p', { className: 'path', text: state.confirmCommand }));
    }
    if (state.mode === 'manual') {
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
