export const PACKAGE_NAME = 'Obelisk.SpikeS01';
export const FOLDER_NAME = 'Obelisk-Spike-S01';
export const EXE_NAME = 'ObeliskSpikeS01.exe';

export const GO_DOCUMENTS = 'rename-go-documents.json';
export const STOP_DOCUMENTS = 'rename-stop-documents';
export const GO_SECOND = 'rename-go-second.json';
export const STOP_SECOND = 'rename-stop-second';
export const WATCH_CHILD_DOCUMENTS = 'watch-child-documents.json';
export const WATCH_CHILD_SECOND = 'watch-child-second.json';
export const WATCH_OUTSIDE_DOCUMENTS = 'watch-outside-documents.json';
export const WATCH_OUTSIDE_SECOND = 'watch-outside-second.json';
export const CLAIM_FILE = 'claim.json';
export const REPORT_FILE = 'spike-report.json';
export const OUTSIDE_REPORT = 'outside-report.json';

export const CASE_IDS = [
  'documents-new',
  'second-folder-new',
  'rename-replace-documents',
  'rename-replace-second',
  'rename-readonly',
  'rename-open',
  'appdata-contrast',
] as const;

export type CaseId = (typeof CASE_IDS)[number];

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function samePath(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left.replace(/[\\/]+$/, '').toLowerCase() === right.replace(/[\\/]+$/, '').toLowerCase();
}
