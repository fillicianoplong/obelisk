interface ActivationView {
  at: string;
  source: string;
  argv: string[];
  cwd: string;
  workingDirectory: string | null;
  additionalDataText: string;
  paths: string[];
}

interface ReceivedPath {
  at: string;
  source: string;
  path: string;
}

interface ViewState {
  electronVersion: string;
  packaged: boolean;
  windowsStore: boolean | null;
  gotLock: boolean;
  windowsOpened: number;
  pid: number;
  reportPath: string;
  coldStart: ActivationView | null;
  activations: ActivationView[];
  receivedPaths: ReceivedPath[];
  probeText: string;
  checkErrors: string[];
}

interface S02Bridge {
  getState(): Promise<ViewState>;
}

function bridge(): S02Bridge | null {
  const candidate = window as Window & { s02?: S02Bridge };
  return candidate.s02 ?? null;
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

function lines(values: readonly string[]): string {
  return values.length > 0 ? values.join('\n') : '(none)';
}

function activationCard(item: ActivationView, heading: string): HTMLElement {
  return el(
    'section',
    { className: 'card' },
    el('h2', { text: heading }),
    el('p', { className: 'meta', text: item.at }),
    el('p', { text: 'argv' }),
    el('pre', { className: 'mono', text: lines(item.argv) }),
    el('p', { className: 'meta', text: `cwd ${item.cwd}` }),
    el('p', { className: 'meta', text: `workingDirectory ${item.workingDirectory ?? '(none)'}` }),
    el('p', { text: 'additionalData' }),
    el('pre', { className: 'mono', text: item.additionalDataText }),
    el('p', { text: 'paths' }),
    ...(item.paths.length > 0
      ? item.paths.map((filePath) => el('p', { className: 'path', text: filePath }))
      : [el('p', { className: 'path', text: '(none)' })]),
  );
}

function render(state: ViewState): void {
  if (!root) return;
  root.replaceChildren();
  root.append(
    el('h1', { text: 'Spike S-02' }),
    el('p', {
      className: 'meta',
      text: [
        `Electron ${state.electronVersion}`,
        `packaged ${state.packaged ? 'yes' : 'no'}`,
        `windowsStore ${state.windowsStore === null ? 'unknown' : state.windowsStore ? 'yes' : 'no'}`,
        `pid ${state.pid}`,
        `lock ${state.gotLock ? 'yes' : 'no'}`,
        `windows in this process ${state.windowsOpened}`,
      ].join('  '),
    }),
    el('p', {
      text: 'This window is the only one this process opens. If another Spike S-02 window is on the taskbar, the single-instance lock did not hold.',
    }),
    el('p', { className: 'meta', text: state.reportPath }),
  );
  if (state.checkErrors.length > 0) {
    root.append(el('p', { className: 'error', text: state.checkErrors.join('\n') }));
  }
  root.append(el('h2', { text: 'Paths this window has received' }));
  if (state.receivedPaths.length === 0) {
    root.append(el('p', { className: 'path', text: '(none yet)' }));
  } else {
    for (const row of state.receivedPaths) {
      root.append(el('p', { className: 'path', text: `${row.at}  ${row.source}  ${row.path}` }));
    }
  }
  if (state.coldStart) root.append(activationCard(state.coldStart, 'Cold start'));
  state.activations
    .filter((item) => item.source !== 'cold-start')
    .forEach((item, index) => {
      root.append(activationCard(item, `${item.source} ${index + 1}`));
    });
  root.append(
    el('h2', { text: 'Activation probe' }),
    el('p', { text: state.probeText || 'The probe has not finished.' }),
    el('h2', { text: 'Cases' }),
    el('ol', {},
      el('li', { text: 'case-01-cold. Double-click with the app closed. The path should show under Cold start.' }),
      el('li', { text: 'case-02-second. Double-click another file while this window is open. The path should show as second-instance, and no second window should open.' }),
      el('li', { text: 'case-03. Select the three files and press Enter.' }),
      el('li', { text: 'case-04. Open the file whose name has spaces and non-ASCII characters. The path text should keep those characters.' }),
      el('li', { text: 'case-05. Open the file under OneDrive Documents.' }),
      el('li', { text: 'case-06. Use Open with while this window is open.' }),
      el('li', { text: 'case-07. Close this window, then pass a path to the ObeliskSpikeS02.exe alias.' }),
    ),
  );
}

async function tick(): Promise<void> {
  const api = bridge();
  if (!root) return;
  if (!api) {
    root.textContent = 'Spike S-02 could not find the page bridge.';
    return;
  }
  try {
    render(await api.getState());
  } catch {
    return;
  }
  window.setTimeout(() => {
    void tick();
  }, 400);
}

void tick();
