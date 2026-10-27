import { CASE_IDS, type CaseId } from './paths';
import type { RunMode } from './mode';

export interface CaseInfo {
  id: CaseId;
  title: string;
  summary: string;
  settles: string;
}

export const CASES: readonly CaseInfo[] = [
  {
    id: 'documents-new',
    title: 'New file in Documents',
    summary: 'writeAtomic creates a new file under Documents. A process outside the package runs Get-Item on that path.',
    settles: 'R-06',
  },
  {
    id: 'second-folder-new',
    title: 'New file in the second folder',
    summary: 'The same write into the folder passed on the command line, or the folder picked in the window.',
    settles: 'R-06',
  },
  {
    id: 'rename-replace-documents',
    title: 'Temp file, then rename over a file in Documents',
    summary: 'Many replaces. A watcher polls the target and records a miss or a half-written read.',
    settles: 'R-06, R-07',
  },
  {
    id: 'rename-replace-second',
    title: 'Temp file, then rename over a file in the second folder',
    summary: 'The same replace in the second folder, so a OneDrive folder is not only checked with a new file.',
    settles: 'R-06, R-07',
  },
  {
    id: 'rename-readonly',
    title: 'Rename when the target is read-only',
    summary: 'The read-only attribute stays set. The error from fs.rename is recorded. The old bytes stay.',
    settles: 'R-07',
  },
  {
    id: 'rename-open',
    title: 'Rename when the target is open',
    summary: 'Another process holds the file without sharing delete. The error from fs.rename is recorded. The old bytes stay.',
    settles: 'R-07',
  },
  {
    id: 'appdata-contrast',
    title: 'Writes under AppData',
    summary: 'userData, Roaming, and Local. MSIX virtualizes parts of AppData. The outside Get-Item says where the bytes landed.',
    settles: 'R-06',
  },
];

export function caseInfo(id: string): CaseInfo | null {
  return CASES.find((item) => item.id === id) ?? null;
}

export function caseIdsFor(mode: RunMode, packaged: boolean): CaseId[] {
  if (!packaged && mode !== 'auto') {
    return ['rename-replace-documents', 'rename-readonly', 'rename-open'];
  }
  return [...CASE_IDS];
}

export function readmeErrors(readme: string, electronVersion: string): string[] {
  const errors: string[] = [];
  for (const id of CASE_IDS) {
    if (!readme.includes(id)) errors.push(`README is missing ${id}.`);
  }
  const required = [
    '## Question',
    '## Cases',
    '## Manual results',
    '## Proposed notes',
    '## Uninstall',
    electronVersion,
    'Obelisk.SpikeS01',
    'CN=Obelisk Dev',
    'Get-Item',
    "app.getPath('userData')",
    "app.getPath('documents')",
    'writeAtomic',
    'npm run package:msix',
    'npm --prefix spikes/s01 run packaged',
    'C:\\dev\\obelisk',
    '10.0.26300',
    '22.23.4',
    'LocalMachine\\TrustedPeople',
    '8f4c177',
    'OneDrive',
    'If this is a pass',
    'If this is a fail',
    'NFR-10',
    'NFR-12',
    'R-06',
    'R-07',
  ];
  for (const text of required) {
    if (!readme.includes(text)) errors.push(`README is missing "${text}".`);
  }
  const manual = manualSection(readme);
  if (manual.length === 0) errors.push('README has no manual section before the proposed notes.');
  if (!manual.includes('- [x] Pass')) errors.push('The Pass box is not ticked.');
  if (manual.includes('- [ ] Pass')) errors.push('The Pass box is still empty.');
  if (!manual.includes('- [ ] Fail')) errors.push('The Fail box should stay unticked. The run passed.');
  if (manual.includes('- [x] Fail') || manual.includes('- [X] Fail')) {
    errors.push('The Fail box is ticked. The run passed.');
  }
  return errors;
}

function manualSection(readme: string): string {
  const start = readme.indexOf('## Manual results');
  const end = readme.indexOf('## Proposed notes');
  if (start < 0 || end < 0 || end <= start) return '';
  return readme.slice(start, end);
}
