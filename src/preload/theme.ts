import { ipcError, isIpcErrorCode, IPC_ERROR_RETRYABLE, type IpcErrorResult } from '../shared/ipc/errors.js';
import {
  THEME_CHANGED_CHANNEL,
  THEME_GET_CHANNEL,
  applyDataTheme,
  parseThemeChangedMessage,
  parseThemeGetOk,
  themeGetOk,
  themeSettingFromArguments,
  type ObeliskThemeApi,
  type ThemeRoot,
} from '../shared/theme.js';

export interface ThemeIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export interface ThemeBridge {
  exposeInMainWorld(apiKey: string, api: unknown): void;
}

export const THEME_BRIDGE_KEY = 'obeliskTheme';

type ThemeListener = (event: unknown, payload: unknown) => void;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function parseIpcError(value: unknown): IpcErrorResult | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 4 || value.status !== 'error' || !isIpcErrorCode(value.code)) {
    return null;
  }
  if (typeof value.message !== 'string' || value.message.length < 1 || value.message.includes('\0')) {
    return null;
  }
  if (value.retryable !== IPC_ERROR_RETRYABLE[value.code]) {
    return null;
  }
  return {
    status: 'error',
    code: value.code,
    message: value.message,
    retryable: IPC_ERROR_RETRYABLE[value.code],
  };
}

export function createThemeApi(ipc: ThemeIpc): ObeliskThemeApi {
  return {
    get() {
      return ipc.invoke(THEME_GET_CHANNEL).then((value) => {
        const theme = parseThemeGetOk(value);
        if (theme !== null) {
          return themeGetOk(theme);
        }
        return parseIpcError(value) ?? ipcError('INVALID_ARGUMENT', 'The theme:get result is not valid.');
      });
    },
    onChanged(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('The theme:changed listener must be a function.');
      }
      const wrapped: ThemeListener = (_event, payload) => {
        const theme = parseThemeChangedMessage(payload);
        if (theme === null) {
          return;
        }
        listener(theme);
      };
      ipc.on(THEME_CHANGED_CHANNEL, wrapped);
      return () => {
        ipc.removeListener(THEME_CHANGED_CHANNEL, wrapped);
      };
    },
  };
}

export function installThemeBridge(
  bridge: ThemeBridge,
  ipc: ThemeIpc,
  argv: readonly string[],
  root: ThemeRoot | null,
): void {
  if (root !== null) {
    applyDataTheme(root, themeSettingFromArguments(argv));
  }
  bridge.exposeInMainWorld(THEME_BRIDGE_KEY, createThemeApi(ipc));
}

