import fs from 'node:fs';
import path from 'node:path';

export type ParentKind = 'main' | 'none' | 'modal';
export type FilterKind = 'obk' | 'docx' | 'none';
export type DefaultPathKind = 'existing-file' | 'directory';

export interface SaveCase {
  id: string;
  title: string;
  purpose: string;
  summary: string;
  decidesFr12: boolean;
  parent: ParentKind;
  filter: FilterKind;
  defaultPath: DefaultPathKind;
  fileName: string;
  /** When set, the steps tell the owner to type this exact string. */
  typeText?: string;
  properties?: Array<'showOverwriteConfirmation'>;
  steps: string[];
  watch: string[];
}

export interface FileFilterSpec {
  name: string;
  extensions: string[];
}

export interface BuiltSaveOptions {
  title: string;
  defaultPath: string;
  parent: ParentKind;
  filters?: FileFilterSpec[];
  properties?: Array<'showOverwriteConfirmation'>;
}

export const CASE_IDS = [
  'save-obk-parent-existing',
  'save-obk-cancel-replace',
  'save-obk-no-parent',
  'save-obk-modal-parent',
  'save-obk-overwrite-property',
  'save-obk-type-stem',
  'export-docx-parent-existing',
  'export-docx-type-stem',
  'save-obk-new-name',
  'save-filter-mismatch',
  'save-nofilter-existing',
] as const;

const DECIDING_IDS = [
  'save-obk-parent-existing',
  'save-obk-cancel-replace',
  'save-obk-type-stem',
  'export-docx-parent-existing',
  'export-docx-type-stem',
] as const;

function stepsForExisting(fileName: string, replace: boolean): string[] {
  const follow = replace
    ? [
        'If a replace prompt appears and stays until you click, click Replace or Yes.',
        'If that prompt appears and then closes with no click from you, click nothing else and wait for this window to continue.',
      ]
    : [
        'If a replace prompt appears and stays until you click, click Cancel, No, or Don\'t replace. Do not click Replace.',
        'If the Save dialog is still open after that, click Cancel on the Save dialog.',
        'If the replace prompt closes with no click from you, click nothing else and wait for this window to continue.',
      ];
  return [
    `The name should already be ${fileName}. Do not change it.`,
    'Click Save.',
    ...follow,
  ];
}

export const CASES: readonly SaveCase[] = [
  {
    id: 'save-obk-parent-existing',
    title: 'Save As, owned by the main window, existing .obk',
    purpose:
      'This is the Save As shape. The dialog is owned by the app window, the filter is Obelisk document (*.obk), and the suggested name is a file that already exists. No extra properties are set. The folder also holds the other fixture files. Keep this name.',
    summary: 'Leave the name as parent-existing.obk, click Save, and if a replace prompt stays, click Replace.',
    decidesFr12: true,
    parent: 'main',
    filter: 'obk',
    defaultPath: 'existing-file',
    fileName: 'parent-existing.obk',
    steps: [
      'The Save dialog opens in front of this window. Its title is S-05 save-obk-parent-existing.',
      ...stepsForExisting('parent-existing.obk', true),
    ],
    watch: [
      'Whether a replace prompt appears.',
      'Whether it stays until you click, or closes on its own.',
      'The file name written in the prompt, if you can read it. Put it in the note.',
    ],
  },
  {
    id: 'save-obk-cancel-replace',
    title: 'Save As, cancel the replace prompt',
    purpose:
      'FR-12 cares about Cancel. This is the same Save As shape as the first case, with a different file. Decline the replace, then leave the Save dialog.',
    summary:
      'Leave the name as cancel-replace.obk, click Save, and if a replace prompt stays, click Cancel or No, then Cancel the Save dialog if it is still open.',
    decidesFr12: true,
    parent: 'main',
    filter: 'obk',
    defaultPath: 'existing-file',
    fileName: 'cancel-replace.obk',
    steps: [
      'The Save dialog title is S-05 save-obk-cancel-replace.',
      ...stepsForExisting('cancel-replace.obk', false),
    ],
    watch: [
      'Whether Cancel on the prompt returns you to the Save dialog.',
      'Whether the log then says the dialog was canceled.',
      'The log also says whether the file bytes changed. They should not.',
    ],
  },
  {
    id: 'save-obk-no-parent',
    title: 'Save As with no parent window',
    purpose:
      'This call passes options and no BrowserWindow. The filter and the existing .obk file still match Save As. Obelisk would pass the app window. This case asks whether leaving the parent off changes the prompt.',
    summary:
      'Leave the name as no-parent.obk. The dialog may be behind this window. Click Save, and if a replace prompt stays, click Replace.',
    decidesFr12: false,
    parent: 'none',
    filter: 'obk',
    defaultPath: 'existing-file',
    fileName: 'no-parent.obk',
    steps: [
      'This dialog is not owned by this window. If you do not see it, look behind this window and on the taskbar. Its title is S-05 save-obk-no-parent.',
      ...stepsForExisting('no-parent.obk', true),
    ],
    watch: [
      'Whether a replace prompt appears, and whether it stays.',
      'Whether the prompt is hidden behind this window.',
    ],
  },
  {
    id: 'save-obk-modal-parent',
    title: 'Save As owned by a modal window',
    purpose:
      'The Save dialog\'s owner is a small modal window, not the main window. The filter and the existing file still match Save As.',
    summary:
      'Leave the name as modal-parent.obk. The Save dialog is owned by the small modal window. Click Save, and if a replace prompt stays, click Replace.',
    decidesFr12: false,
    parent: 'modal',
    filter: 'obk',
    defaultPath: 'existing-file',
    fileName: 'modal-parent.obk',
    steps: [
      'A small window titled "S-05 modal parent" opens, and the Save dialog is owned by that window.',
      ...stepsForExisting('modal-parent.obk', true),
    ],
    watch: [
      'Whether a replace prompt appears and stays.',
      'Whether the prompt is stuck behind the modal window.',
    ],
  },
  {
    id: 'save-obk-overwrite-property',
    title: 'Save As with showOverwriteConfirmation',
    purpose:
      'Electron\'s docs mark showOverwriteConfirmation as a Linux property. This case sets it anyway, with the same parent, filter, and existing .obk file as the first case, to see whether Windows behaves differently.',
    summary: 'Leave the name as overwrite-property.obk, click Save, and if a replace prompt stays, click Replace.',
    decidesFr12: false,
    parent: 'main',
    filter: 'obk',
    defaultPath: 'existing-file',
    fileName: 'overwrite-property.obk',
    properties: ['showOverwriteConfirmation'],
    steps: [
      'The Save dialog title is S-05 save-obk-overwrite-property.',
      ...stepsForExisting('overwrite-property.obk', true),
    ],
    watch: [
      'Whether this prompt matches the first case, or is missing, or closes by itself.',
    ],
  },
  {
    id: 'save-obk-type-stem',
    title: 'Save As, type the name without .obk',
    purpose:
      'Electron sets the default extension from the *.obk filter. The name box starts empty. The folder already contains type-stem.obk. You type the stem only. The question is whether Windows asks before the name becomes type-stem.obk. The folder also contains type-stem.docx for a later case. The filter here is *.obk.',
    summary:
      'Clear the name if it is not empty. Type exactly type-stem with no extension, click Save, and if a replace prompt stays, click Replace.',
    decidesFr12: true,
    parent: 'main',
    filter: 'obk',
    defaultPath: 'directory',
    fileName: 'type-stem.obk',
    typeText: 'type-stem',
    steps: [
      'The Save dialog title is S-05 save-obk-type-stem. The name box should be empty. If it is not, clear it.',
      'Type exactly: type-stem',
      'Do not type .obk.',
      'Click Save.',
      'Watch the name box. If it gains .obk, put that in the note.',
      'If a replace prompt stays, read which name it shows, put that name in the note, and click Replace or Yes.',
      'If the prompt closes with no click from you, click nothing else and wait for this window to continue.',
    ],
    watch: [
      'Whether the dialog adds .obk.',
      'Whether a prompt appears for type-stem, for type-stem.obk, or not at all.',
    ],
  },
  {
    id: 'export-docx-parent-existing',
    title: 'Export, owned by the main window, existing .docx',
    purpose:
      'This is the Export shape for Word. The dialog is owned by the app window, the filter is Word document (*.docx), and the suggested name is a file that already exists.',
    summary: 'Leave the name as parent-existing.docx, click Save, and if a replace prompt stays, click Replace.',
    decidesFr12: true,
    parent: 'main',
    filter: 'docx',
    defaultPath: 'existing-file',
    fileName: 'parent-existing.docx',
    steps: [
      'The Save dialog title is S-05 export-docx-parent-existing.',
      ...stepsForExisting('parent-existing.docx', true),
    ],
    watch: [
      'Whether a replace prompt appears and stays, the same way as the first .obk case.',
      'The file name written in the prompt. Put it in the note if you can read it.',
    ],
  },
  {
    id: 'export-docx-type-stem',
    title: 'Export, type the name without .docx',
    purpose:
      'Same extension question as the .obk stem case, for a Word export. The existing file is type-stem.docx. You type type-stem and no extension. The filter is *.docx.',
    summary:
      'Clear the name if it is not empty. Type exactly type-stem with no extension, click Save, and if a replace prompt stays, click Replace.',
    decidesFr12: true,
    parent: 'main',
    filter: 'docx',
    defaultPath: 'directory',
    fileName: 'type-stem.docx',
    typeText: 'type-stem',
    steps: [
      'The Save dialog title is S-05 export-docx-type-stem. The name box should be empty. If it is not, clear it.',
      'Type exactly: type-stem',
      'Do not type .docx.',
      'Click Save.',
      'If the name box gains .docx, put that in the note.',
      'If a replace prompt stays, read which name it shows, put that name in the note, and click Replace or Yes.',
      'If the prompt closes with no click from you, click nothing else and wait for this window to continue.',
    ],
    watch: [
      'Whether the dialog adds .docx.',
      'Whether a prompt appears for type-stem, for type-stem.docx, or not at all.',
    ],
  },
  {
    id: 'save-obk-new-name',
    title: 'Save As, change the name to a file that does not exist',
    purpose:
      'A new name should not ask to replace anything. This checks that a prompt in the earlier cases was about the existing file. lesson-copy.obk is not in the folder. The dialog should not create it.',
    summary:
      'Change the name to lesson-copy.obk and click Save. A replace prompt should not appear. If one stays, click Cancel or No.',
    decidesFr12: false,
    parent: 'main',
    filter: 'obk',
    defaultPath: 'existing-file',
    fileName: 'new-name.obk',
    typeText: 'lesson-copy.obk',
    steps: [
      'The Save dialog title is S-05 save-obk-new-name. The name starts as new-name.obk.',
      'Replace that name. Type exactly: lesson-copy.obk',
      'Click Save.',
      'A replace prompt should not appear. If one stays, put what it said in the note, click Cancel or No, and then click Cancel on the Save dialog if it is still open.',
      'If no prompt appears, the Save dialog should close after Save.',
    ],
    watch: [
      'That no replace prompt appears for lesson-copy.obk.',
      'The path in the log. lesson-copy.obk should not exist yet, because the dialog does not write it.',
    ],
  },
  {
    id: 'save-filter-mismatch',
    title: 'Existing .obk suggested, Word .docx filter',
    purpose:
      'The suggested file ends in .obk and the filter is *.docx, so the default extension and the suggested name disagree. Save As and Export would not do this on purpose. It is here because the filter can change the name Windows checks.',
    summary: 'Do not edit the name. Read it, click Save, and if a replace prompt stays, click Replace.',
    decidesFr12: false,
    parent: 'main',
    filter: 'docx',
    defaultPath: 'existing-file',
    fileName: 'filter-mismatch.obk',
    steps: [
      'The Save dialog title is S-05 save-filter-mismatch.',
      'Look at the name box before you click. Put the exact name in the note.',
      'Do not edit the name.',
      'Click Save.',
      'If a replace prompt stays, put the name it shows in the note and click Replace or Yes.',
      'If the prompt closes with no click from you, click nothing else and wait for this window to continue.',
    ],
    watch: [
      'The name in the box, and the path that comes back. It may be the .obk file, a .docx file, or a double extension.',
      'Whether a prompt appears for the name that comes back.',
    ],
  },
  {
    id: 'save-nofilter-existing',
    title: 'Existing .obk, no extension filter',
    purpose:
      'With no filters, Electron\'s Windows code adds All Files (*.*) and does not set a default extension. Obelisk would pass a filter. This case shows whether the prompt still appears when that default extension is absent.',
    summary: 'Leave the name as nofilter-existing.obk, click Save, and if a replace prompt stays, click Replace.',
    decidesFr12: false,
    parent: 'main',
    filter: 'none',
    defaultPath: 'existing-file',
    fileName: 'nofilter-existing.obk',
    steps: [
      'The Save dialog title is S-05 save-nofilter-existing.',
      ...stepsForExisting('nofilter-existing.obk', true),
    ],
    watch: [
      'Whether a replace prompt appears and stays when the dialog has no Obelisk filter.',
    ],
  },
];

export function filtersFor(filter: FilterKind): FileFilterSpec[] | undefined {
  if (filter === 'obk') return [{ name: 'Obelisk document', extensions: ['obk'] }];
  if (filter === 'docx') return [{ name: 'Word document', extensions: ['docx'] }];
  return undefined;
}

export function parentLabel(parent: ParentKind): string {
  if (parent === 'main') return 'The main window owns the dialog.';
  if (parent === 'modal') return 'A modal window titled "S-05 modal parent" owns the dialog.';
  return 'No parent window. The dialog may sit behind this one.';
}

export function filterLabel(filter: FilterKind): string {
  if (filter === 'obk') return 'Filter: Obelisk document (*.obk).';
  if (filter === 'docx') return 'Filter: Word document (*.docx).';
  return 'No filter. On Windows, Electron adds All Files (*.*) and does not set a default extension.';
}

export function pathLabel(item: SaveCase): string {
  if (item.defaultPath === 'directory') {
    return `The name box starts empty. The folder already contains ${item.fileName}.`;
  }
  return `The name box starts as ${item.fileName}.`;
}

export function propertiesLabel(item: SaveCase): string {
  if (item.properties?.includes('showOverwriteConfirmation')) {
    return 'Property set: showOverwriteConfirmation. Electron documents this for Linux. The Windows source does not read it.';
  }
  return 'No dialog properties are set.';
}

export function buildOptions(item: SaveCase, fixtureDir: string): BuiltSaveOptions {
  const filePath = path.resolve(fixtureDir, item.fileName);
  const defaultPath = item.defaultPath === 'directory' ? path.resolve(fixtureDir) : filePath;
  const filters = filtersFor(item.filter);
  const options: BuiltSaveOptions = {
    title: `S-05 ${item.id}`,
    defaultPath,
    parent: item.parent,
  };
  if (filters) options.filters = filters;
  if (item.properties) options.properties = [...item.properties];
  return options;
}

export function optionErrors(item: SaveCase, options: BuiltSaveOptions, fixtureDir: string): string[] {
  const errors: string[] = [];
  const filePath = path.resolve(fixtureDir, item.fileName);
  if (!path.isAbsolute(options.defaultPath)) {
    errors.push(`${item.id}: defaultPath is not absolute.`);
  }
  if (item.defaultPath === 'existing-file' && options.defaultPath !== filePath) {
    errors.push(`${item.id}: defaultPath is not the fixture file.`);
  }
  if (item.defaultPath === 'directory' && options.defaultPath !== path.resolve(fixtureDir)) {
    errors.push(`${item.id}: defaultPath is not the fixture folder.`);
  }
  if (!fs.existsSync(filePath)) {
    errors.push(`${item.id}: fixture file is missing.`);
  }
  if (options.title !== `S-05 ${item.id}`) errors.push(`${item.id}: title does not include the case id.`);
  if (options.parent !== item.parent) errors.push(`${item.id}: parent does not match.`);
  const expectedFilters = filtersFor(item.filter);
  if (JSON.stringify(options.filters ?? null) !== JSON.stringify(expectedFilters ?? null)) {
    errors.push(`${item.id}: filters do not match.`);
  }
  const expectedProperties = item.properties ? [...item.properties] : null;
  if (JSON.stringify(options.properties ?? null) !== JSON.stringify(expectedProperties)) {
    errors.push(`${item.id}: properties do not match.`);
  }
  return errors;
}

export function validateCases(): string[] {
  const errors: string[] = [];
  const ids = CASES.map((item) => item.id);
  if (ids.join('\n') !== CASE_IDS.join('\n')) {
    errors.push('The case list is not the expected ids, in order.');
  }
  const fileNames = new Set<string>();
  const parents = new Set<ParentKind>();
  const filters = new Set<FilterKind>();
  const defaults = new Set<DefaultPathKind>();
  let overwriteProperty = 0;
  for (const item of CASES) {
    parents.add(item.parent);
    filters.add(item.filter);
    defaults.add(item.defaultPath);
    if (fileNames.has(item.fileName)) errors.push(`${item.id}: duplicate file name ${item.fileName}.`);
    fileNames.add(item.fileName);
    if (!item.fileName.includes('.') || item.fileName.includes('/') || item.fileName.includes('\\')) {
      errors.push(`${item.id}: file name must be a single file with an extension.`);
    }
    if (item.title.trim().length === 0 || item.purpose.trim().length === 0 || item.summary.trim().length === 0) {
      errors.push(`${item.id}: missing title, purpose, or summary.`);
    }
    if (item.steps.length < 3 || item.watch.length < 1) errors.push(`${item.id}: steps or watch list is too short.`);
    if (!item.steps.some((step) => step.includes('Click Save'))) errors.push(`${item.id}: steps do not say Click Save.`);
    if (item.typeText) {
      if (item.typeText.includes('/') || item.typeText.includes('\\')) {
        errors.push(`${item.id}: typeText must be a file name, not a path.`);
      }
      if (!item.steps.some((step) => step.includes(`Type exactly: ${item.typeText}`))) {
        errors.push(`${item.id}: steps do not tell you to type ${item.typeText}.`);
      }
    }
    if (item.defaultPath === 'directory' && !item.typeText) {
      errors.push(`${item.id}: a folder default path needs the text to type.`);
    }
    if (item.properties?.includes('showOverwriteConfirmation')) overwriteProperty += 1;
    if (item.properties?.some((property) => property !== 'showOverwriteConfirmation')) {
      errors.push(`${item.id}: unexpected dialog property.`);
    }
    const deciding = (DECIDING_IDS as readonly string[]).includes(item.id);
    if (item.decidesFr12 !== deciding) errors.push(`${item.id}: decidesFr12 does not match the FR-12 set.`);
  }
  if (!parents.has('main') || !parents.has('none') || !parents.has('modal')) {
    errors.push('The case list must include a main parent, no parent, and a modal parent.');
  }
  if (!filters.has('obk') || !filters.has('docx') || !filters.has('none')) {
    errors.push('The case list must include an .obk filter, a .docx filter, and no filter.');
  }
  if (!defaults.has('existing-file') || !defaults.has('directory')) {
    errors.push('The case list must include an existing-file path and a folder path.');
  }
  if (overwriteProperty !== 1) errors.push('Exactly one case sets showOverwriteConfirmation.');
  const first = CASES.find((item) => item.id === 'save-obk-parent-existing');
  if (!first || first.parent !== 'main' || first.filter !== 'obk' || first.defaultPath !== 'existing-file' || first.properties) {
    errors.push('save-obk-parent-existing is not the plain Save As shape.');
  }
  const exported = CASES.find((item) => item.id === 'export-docx-parent-existing');
  if (!exported || exported.parent !== 'main' || exported.filter !== 'docx' || exported.defaultPath !== 'existing-file' || exported.properties) {
    errors.push('export-docx-parent-existing is not the plain Export shape.');
  }
  const mismatch = CASES.find((item) => item.id === 'save-filter-mismatch');
  if (!mismatch || mismatch.filter !== 'docx' || !mismatch.fileName.endsWith('.obk')) {
    errors.push('save-filter-mismatch must suggest an .obk file with a .docx filter.');
  }
  const noFilter = CASES.find((item) => item.id === 'save-nofilter-existing');
  if (!noFilter || noFilter.filter !== 'none') errors.push('save-nofilter-existing must set no filter.');
  const fresh = CASES.find((item) => item.id === 'save-obk-new-name');
  if (!fresh || fresh.typeText !== 'lesson-copy.obk') errors.push('save-obk-new-name must type lesson-copy.obk.');
  return errors;
}

export function stepsText(cases: readonly SaveCase[]): string {
  const lines = [
    'Spike S-05',
    '',
    'The walkthrough window shows the same steps. If a dialog covers that window, use this file.',
    '',
  ];
  cases.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.id}`);
    lines.push(item.title);
    lines.push(item.decidesFr12 ? 'This case decides FR-12.' : 'This case is context. It does not, by itself, pass or fail FR-12.');
    lines.push('');
    lines.push(item.purpose);
    lines.push('');
    lines.push(`In short: ${item.summary}`);
    lines.push('');
    lines.push('Do this:');
    item.steps.forEach((step, stepIndex) => lines.push(`${stepIndex + 1}. ${step}`));
    lines.push('');
    lines.push('Watch for:');
    item.watch.forEach((line) => lines.push(`- ${line}`));
    lines.push('');
  });
  return `${lines.join('\n')}\n`;
}

export function readmeErrors(readme: string, electronVersion: string): string[] {
  const errors: string[] = [];
  for (const id of CASE_IDS) {
    if (!readme.includes(id)) errors.push(`README is missing ${id}.`);
  }
  if (!readme.includes(electronVersion)) errors.push(`README does not mention Electron ${electronVersion}.`);
  const required = [
    '## Manual results',
    '## Proposed notes',
    'If this is a pass',
    'If this is a fail',
    'FOS_OVERWRITEPROMPT',
    'npm --prefix spikes/s05 start',
    'npm start',
    'dialog.showSaveDialog',
    'showOverwriteConfirmation',
  ];
  for (const text of required) {
    if (!readme.includes(text)) errors.push(`README is missing "${text}".`);
  }
  const manual = manualSection(readme);
  if (manual.length === 0) errors.push('README has no manual section before the proposed notes.');
  if (!manual.includes('- [x] Pass')) errors.push('The manual section is missing a ticked Pass box.');
  if (!manual.includes('- [ ] Fail')) errors.push('The manual section is missing an unticked Fail box.');
  if (manual.includes('- [x] Fail') || manual.includes('- [X] Fail')) {
    errors.push('The Fail box is ticked. Leave Fail unticked.');
  }
  return errors;
}

function manualSection(readme: string): string {
  const start = readme.indexOf('## Manual results');
  const end = readme.indexOf('## Proposed notes');
  if (start < 0 || end < 0 || end <= start) return '';
  return readme.slice(start, end);
}
