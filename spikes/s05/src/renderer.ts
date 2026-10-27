interface CaseView {
  id: string;
  title: string;
  purpose: string;
  summary: string;
  steps: string[];
  watch: string[];
  decidesFr12: boolean;
  parentText: string;
  filterText: string;
  pathText: string;
  propertiesText: string;
  fileName: string;
  fileExists: boolean;
  fileBytes: number | null;
  fileSha256: string | null;
  typeText: string | null;
}

interface DialogView {
  canceled: boolean | null;
  filePath: string;
  error: string | null;
  fixtureChanged: boolean;
  hashBefore: string | null;
  hashAfter: string | null;
  returnedExists: boolean;
  sameAsFixture: boolean;
  otherChanges: string[];
}

interface ProgressRow {
  id: string;
  prompt: string;
  clicked: string;
  canceled: boolean | null;
  filePath: string;
  fixtureChanged: boolean;
}

interface ViewState {
  phase: 'ready' | 'asking' | 'done' | 'blocked';
  index: number;
  total: number;
  electronVersion: string;
  platform: string;
  fixtureDir: string;
  reportPath: string;
  formError: string | null;
  checkErrors: string[];
  manualComplete: boolean;
  caseView: CaseView | null;
  dialogView: DialogView | null;
  progress: ProgressRow[];
}

interface ObservationInput {
  prompt: string;
  clicked: string;
  note: string;
}

interface S05Bridge {
  getState(): Promise<ViewState>;
  openDialog(): Promise<ViewState>;
  record(body: ObservationInput): Promise<ViewState>;
  close(): Promise<ViewState>;
}

function bridge(): S05Bridge | null {
  const candidate = window as Window & { s05?: S05Bridge };
  return candidate.s05 ?? null;
}

const root = document.getElementById('root');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; id?: string; text?: string },
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  for (const child of children) node.append(child);
  return node;
}

function list(tag: 'ol' | 'ul', lines: string[]): HTMLElement {
  const node = document.createElement(tag);
  for (const line of lines) node.append(el('li', { text: line }));
  return node;
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function radio(name: string, value: string, label: string): HTMLLabelElement {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  const wrap = document.createElement('label');
  wrap.append(input, document.createTextNode(` ${label}`));
  return wrap;
}

function selected(name: string): string | null {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return input ? input.value : null;
}

function render(state: ViewState): void {
  if (!root) return;
  root.replaceChildren();
  root.append(
    el('h1', { text: 'Spike S-05' }),
    el('p', {
      className: 'meta',
      id: 'electron-version',
      text: `Electron ${state.electronVersion} on ${state.platform}`,
    }),
    el('p', { className: 'path', text: `Fixture folder: ${state.fixtureDir}` }),
  );

  if (state.phase === 'blocked') {
    root.append(el('h2', { text: 'The checks failed, so the Save dialogs stay closed.' }));
    root.append(list('ul', state.checkErrors.length > 0 ? state.checkErrors : ['No detail was recorded.']));
    return;
  }

  if (state.phase === 'done') {
    root.append(el('h2', { text: 'The walkthrough is written down.' }));
    root.append(el('p', {
      text: 'Pass or fail goes in spikes/s05/README.md, in the manual section. This window does not decide it.',
    }));
    root.append(el('p', { className: 'path', text: state.reportPath }));
    if (state.progress.length > 0) {
      const items = state.progress.map((row) =>
        `${row.id}: prompt ${row.prompt}, clicked ${row.clicked}, canceled ${yesNo(row.canceled === true)}, file changed ${yesNo(row.fixtureChanged)}, path ${row.filePath || '(empty)'}`,
      );
      root.append(list('ul', items));
    }
    const close = el('button', { text: 'Close' });
    close.type = 'button';
    close.addEventListener('click', () => {
      const api = bridge();
      if (!api) return;
      void api.close();
    });
    root.append(close);
    return;
  }

  const item = state.caseView;
  if (!item) {
    root.append(el('p', { text: 'This case has no text.' }));
    return;
  }

  root.append(el('p', { text: `Case ${state.index + 1} of ${state.total}` }));
  root.append(el('h2', { id: 'case-id', text: item.id }));
  root.append(el('p', { text: item.title }));
  root.append(el('p', {
    className: item.decidesFr12 ? 'tag decides' : 'tag',
    text: item.decidesFr12 ? 'This case decides FR-12.' : 'Context. This case does not, by itself, pass or fail FR-12.',
  }));

  const facts = el('div', { className: 'card' });
  facts.append(
    el('p', { text: item.purpose }),
    el('p', { text: `In short: ${item.summary}` }),
    el('p', { text: item.parentText }),
    el('p', { text: item.filterText }),
    el('p', { text: item.pathText }),
    el('p', { text: item.propertiesText }),
  );
  root.append(facts);

  root.append(el('h2', { text: 'Do this' }));
  root.append(list('ol', item.steps));
  root.append(el('h2', { text: 'Watch for' }));
  root.append(list('ul', item.watch));

  const file = el('div', { className: 'card' });
  file.append(
    el('p', { text: `Existing file: ${item.fileName}` }),
    el('p', { text: `On disk: ${item.fileExists ? 'yes' : 'no'}, ${item.fileBytes ?? 0} bytes` }),
    el('p', { className: 'hash', text: item.fileSha256 ?? '(no hash)' }),
  );
  if (item.typeText) file.append(el('p', { text: `Type exactly: ${item.typeText}` }));
  root.append(file);

  if (state.phase === 'ready') {
    const open = el('button', { text: 'Open the Save dialog' });
    open.type = 'button';
    open.addEventListener('click', () => {
      open.disabled = true;
      const api = bridge();
      if (!api) return;
      void api.openDialog().then(render);
    });
    root.append(el('div', { className: 'action' }, open));
    return;
  }

  const dialogView = state.dialogView;
  const result = el('div', { className: 'card' });
  result.append(el('h2', { text: 'What the dialog returned' }));
  if (!dialogView) {
    result.append(el('p', { text: 'No dialog result was recorded.' }));
  } else {
    if (dialogView.error) result.append(el('p', { className: 'error', text: dialogView.error }));
    result.append(el('p', { text: `canceled: ${dialogView.canceled === null ? 'unknown' : yesNo(dialogView.canceled)}` }));
    result.append(el('p', { className: 'path', text: `filePath: ${dialogView.filePath || '(empty)'}` }));
    result.append(el('p', { text: `Fixture bytes changed: ${yesNo(dialogView.fixtureChanged)}` }));
    result.append(el('p', { className: 'hash', text: `sha256 before: ${dialogView.hashBefore ?? '(none)'}` }));
    result.append(el('p', { className: 'hash', text: `sha256 after: ${dialogView.hashAfter ?? '(none)'}` }));
    result.append(el('p', { text: `Returned path exists: ${yesNo(dialogView.returnedExists)}` }));
    result.append(el('p', { text: `Returned path is the fixture file: ${yesNo(dialogView.sameAsFixture)}` }));
    result.append(el('p', {
      text: dialogView.otherChanges.length > 0
        ? `Other byte changes: ${dialogView.otherChanges.join(', ')}`
        : 'No other file in the fixture folder changed bytes.',
    }));
  }
  root.append(result);

  const form = el('div', { className: 'card' });
  form.append(el('h2', { text: 'What you saw' }));
  const promptSet = el('fieldset', {});
  promptSet.append(el('legend', { text: 'Replace prompt' }));
  promptSet.append(radio('prompt', 'stayed', 'It stayed until I clicked'));
  promptSet.append(radio('prompt', 'closed-by-itself', 'It appeared and closed by itself'));
  promptSet.append(radio('prompt', 'did-not-appear', 'It did not appear'));
  promptSet.append(radio('prompt', 'could-not-tell', 'I could not tell'));
  const clickSet = el('fieldset', {});
  clickSet.append(el('legend', { text: 'What you clicked on that prompt' }));
  clickSet.append(radio('clicked', 'replace', 'Replace or Yes'));
  clickSet.append(radio('clicked', 'cancel', 'Cancel, No, or Don\'t replace'));
  clickSet.append(radio('clicked', 'no-prompt-button', 'I did not click a prompt button'));
  const note = document.createElement('textarea');
  note.placeholder = 'Optional. The prompt\'s wording, or the name in the box.';
  form.append(promptSet, clickSet, el('p', { text: 'Note' }), note);
  if (state.formError) form.append(el('p', { className: 'error', text: state.formError }));
  const save = el('button', {
    text: state.index + 1 === state.total ? 'Save this observation and finish' : 'Save this observation and continue',
  });
  save.type = 'button';
  save.addEventListener('click', () => {
    const prompt = selected('prompt');
    const clicked = selected('clicked');
    if (!prompt || !clicked) {
      form.append(el('p', { className: 'error', text: 'Choose what the prompt did and what you clicked.' }));
      return;
    }
    save.disabled = true;
    const api = bridge();
    if (!api) return;
    void api.record({ prompt, clicked, note: note.value }).then(render);
  });
  form.append(el('div', { className: 'action' }, save));
  root.append(form);
}

async function main(): Promise<void> {
  if (!root) {
    console.error('S05 page error: the root element is missing.');
    return;
  }
  const api = bridge();
  if (!api) {
    const message = 'The preload bridge is missing.';
    console.error(`S05 page error: ${message}`);
    root.textContent = message;
    return;
  }
  try {
    render(await api.getState());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`S05 page error: ${message}`);
    root.textContent = `The walkthrough page failed: ${message}`;
  }
}

void main();
