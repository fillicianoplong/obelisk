// The Windows Open dialog lists only .obk files (FR-08). One filter, and no
// All Files entry, so the dialog does not offer other types.

export const OBK_FILTER_NAME = 'Obelisk document';

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title: string;
  filters: DialogFilter[];
  properties: ['openFile'];
}

export function openDialogOptions(): OpenDialogOptions {
  return {
    title: 'Open',
    filters: [{ name: OBK_FILTER_NAME, extensions: ['obk'] }],
    properties: ['openFile'],
  };
}

export interface OpenDialogOwner {
  destroyed: boolean;
  focused: boolean;
}

// The dialog is owned by the app window, the same way Save as is (spike S-05).
export function pickOpenDialogOwner<T extends OpenDialogOwner>(windows: readonly T[]): T | null {
  const live = windows.filter((window) => !window.destroyed);
  return live.find((window) => window.focused) ?? live[0] ?? null;
}
