export const IPC_ERROR_CODES = [
  'SENDER_NOT_ALLOWED',
  'UNKNOWN_CHANNEL',
  'INVALID_ARGUMENT',
  'NOT_IMPLEMENTED',
  'PATH_NOT_ALLOWED',
  'ENCODE_FAILED',
  'ENOSPC',
  'EBUSY_EXHAUSTED',
  'EACCES',
  'ENOENT',
  'TIMEOUT',
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

// Save codes follow architecture section 6.1. Bridge codes are not retryable.
export const IPC_ERROR_RETRYABLE = {
  SENDER_NOT_ALLOWED: false,
  UNKNOWN_CHANNEL: false,
  INVALID_ARGUMENT: false,
  NOT_IMPLEMENTED: false,
  PATH_NOT_ALLOWED: false,
  ENCODE_FAILED: false,
  ENOSPC: true,
  EBUSY_EXHAUSTED: true,
  EACCES: false,
  ENOENT: false,
  TIMEOUT: true,
} as const satisfies Record<IpcErrorCode, boolean>;

export interface IpcErrorResult {
  status: 'error';
  code: IpcErrorCode;
  message: string;
  retryable: boolean;
}

export interface IpcTimeoutResult {
  status: 'timeout';
  code: 'TIMEOUT';
  message: string;
  retryable: true;
}

const ERROR_CODE_SET: ReadonlySet<string> = new Set(IPC_ERROR_CODES);

export function isIpcErrorCode(value: unknown): value is IpcErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

export function ipcError(code: IpcErrorCode, message: string): IpcErrorResult {
  return {
    status: 'error',
    code,
    message,
    retryable: IPC_ERROR_RETRYABLE[code],
  };
}

export function ipcTimeout(message: string): IpcTimeoutResult {
  return {
    status: 'timeout',
    code: 'TIMEOUT',
    message,
    retryable: true,
  };
}

export function senderNotAllowed(): IpcErrorResult {
  return ipcError('SENDER_NOT_ALLOWED', 'The call did not come from the app page.');
}

export function unknownChannel(): IpcErrorResult {
  return ipcError('UNKNOWN_CHANNEL', 'Unknown channel.');
}

export function invalidArgument(channel: string): IpcErrorResult {
  return ipcError('INVALID_ARGUMENT', `The arguments for ${channel} are not valid.`);
}
