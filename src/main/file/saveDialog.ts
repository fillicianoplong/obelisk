import path from 'node:path';
import type { PlatformPath } from 'node:path';
import { OBK_FILTER_NAME, type DialogFilter } from './openDialog.js';

// Spike S-05. The Save dialog is owned by the app window. The filter is
// Obelisk document (*.obk). No extra properties: Windows already asks before
// replacing a file, and showOverwriteConfirmation is not read there.

export const SAVE_DIALOG_TITLE = 'Save as';

export const UNTITLED_FILE_NAME = 'Untitled.obk';

// UC-02: a file with that name exists, and the user is asked before it is replaced.
export const REPLACE_PROMPT_TITLE = 'Save as';

export const REPLACE_PROMPT_MESSAGE = 'A file with that name exists.';

export const REPLACE_BUTTON = 'Replace';

export const CANCEL_BUTTON = 'Cancel';

export interface SaveDialogOptions {
  title: string;
  defaultPath?: string;
  filters: DialogFilter[];
}

export interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

export interface ReplacePromptOptions {
  title: string;
  message: string;
  buttons: readonly [typeof REPLACE_BUTTON, typeof CANCEL_BUTTON];
  cancelId: 1;
  defaultId: 1;
}

export function saveDialogOptions(defaultPath?: string): SaveDialogOptions {
  const options: SaveDialogOptions = {
    title: SAVE_DIALOG_TITLE,
    filters: [{ name: OBK_FILTER_NAME, extensions: ['obk'] }],
  };
  if (defaultPath !== undefined && defaultPath.length > 0) {
    options.defaultPath = defaultPath;
  }
  return options;
}

export function replacePromptOptions(): ReplacePromptOptions {
  return {
    title: REPLACE_PROMPT_TITLE,
    message: REPLACE_PROMPT_MESSAGE,
    buttons: [REPLACE_BUTTON, CANCEL_BUTTON],
    cancelId: 1,
    defaultId: 1,
  };
}

// The filter does not change the extension (spike S-05). The file we write
// ends in .obk. A name that already ends in .obk is left as the dialog returned it.
export function ensureObkName(filePath: string, pathApi: PlatformPath = path): string {
  if (pathApi.extname(filePath).toLowerCase() === '.obk') {
    return filePath;
  }
  return `${filePath}.obk`;
}
