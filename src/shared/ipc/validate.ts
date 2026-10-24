import type { InvokeChannel } from './channels.js';
import { IPC_ERROR_RETRYABLE, isIpcErrorCode, type IpcErrorResult } from './errors.js';
import {
  EXPORT_FORMATS,
  FONT_SIZES_PT,
  PREFERENCE_KEYS,
  THEME_VALUES,
  type DocumentMessage,
  type ExportAssets,
  type FileOpenResult,
  type FileSaveAsRequest,
  type FileSaveRequest,
  type FileStat,
  type FontSizePt,
  type JsonObject,
  type JsonValue,
  type LinkOpenRequest,
  type PreferenceEntry,
  type PreferenceKey,
  type PrefsGetRequest,
  type PrintRunRequest,
  type RecoveryDropRequest,
  type RecoveryPutRequest,
  type RecoveryRestoreRequest,
  type ExportRunRequest,
  type RefusedResult,
  type SessionSetRequest,
  type SigDeleteRequest,
  type SigGetRequest,
  type SigSaveRequest,
  type ThemePreference,
} from './types.js';

const JSON_DEPTH_MAX = 40;
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const REASON = /^[a-z0-9-]{1,64}$/;
const MESSAGE_MAX = 4000;
const FILE_NAME_MAX = 255;
// Architecture links reference, formatting reference, section 6.5, and section 6.6.
const ADDRESS_MAX = 2048;
const FIRST_LINE_MAX = 80;
const FONT_NAME_MAX = 64;
const SIGNATURE_NAME_MAX = 100;
const IMAGE_BYTE_MAX = 20 * 1024 * 1024;
const PNG_BASE64_MAX_CHARS = Math.ceil(IMAGE_BYTE_MAX / 3) * 4;

const FONT_SIZE_SET: ReadonlySet<number> = new Set(FONT_SIZES_PT);
const PREFERENCE_KEY_SET: ReadonlySet<string> = new Set(PREFERENCE_KEYS);
const EXPORT_FORMAT_SET: ReadonlySet<string> = new Set(EXPORT_FORMATS);
const THEME_SET: ReadonlySet<string> = new Set(THEME_VALUES);

export type ParsedInvoke = { ok: true; request: unknown } | { ok: false };

export function parseInvokeRequest(channel: InvokeChannel, args: readonly unknown[]): ParsedInvoke {
  switch (channel) {
    case 'file:open':
    case 'sig:list':
    case 'recovery:list':
      return args.length === 0 ? { ok: true, request: undefined } : { ok: false };
    case 'file:save':
      return parsed(parseFileSave(args));
    case 'file:saveAs':
      return parsed(parseFileSaveAs(args));
    case 'session:set':
      return parsed(parseSessionSet(args));
    case 'export:run':
      return parsed(parseExportRun(args));
    case 'print:run':
      return parsed(parsePrintRun(args));
    case 'prefs:get':
      return parsed(parsePrefsGet(args));
    case 'prefs:set':
      return parsed(parsePrefsSet(args));
    case 'sig:get':
      return parsed(parseIdRequest(args));
    case 'sig:save':
      return parsed(parseSigSave(args));
    case 'sig:delete':
      return parsed(parseIdRequest(args));
    case 'recovery:put':
      return parsed(parseRecoveryPut(args));
    case 'recovery:restore':
      return parsed(parseRecoveryId(args));
    case 'recovery:drop':
      return parsed(parseRecoveryId(args));
    case 'link:open':
      return parsed(parseLinkOpen(args));
    default: {
      const neverChannel: never = channel;
      return neverChannel;
    }
  }
}

export function parseFileOpenResult(value: unknown): FileOpenResult | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  if (value.status === 'cancelled') {
    return hasExactKeys(value, ['status']) ? { status: 'cancelled' } : null;
  }
  if (value.status === 'alreadyOpen') {
    if (!hasExactKeys(value, ['status', 'tabId'])) {
      return null;
    }
    const tabId = parseToken(value.tabId);
    return tabId === null ? null : { status: 'alreadyOpen', tabId };
  }
  if (value.status === 'refused') {
    return parseRefused(value);
  }
  if (value.status === 'error') {
    return parseErrorResult(value);
  }
  if (value.status !== 'ok' || !hasExactKeys(value, ['status', 'handle', 'name', 'document', 'stat'])) {
    return null;
  }
  const handle = parseToken(value.handle);
  const name = parseFileName(value.name);
  const document = parseDocument(value.document);
  const stat = parseFileStat(value.stat);
  if (handle === null || name === null || document === null || stat === null) {
    return null;
  }
  return { status: 'ok', handle, name, document, stat };
}

function parsed<T>(value: T | null): ParsedInvoke {
  return value === null ? { ok: false } : { ok: true, request: value };
}

function oneObject(args: readonly unknown[]): Record<string, unknown> | null {
  if (args.length !== 1 || !isPlainRecord(args[0])) {
    return null;
  }
  return args[0];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  if (present.length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.hasOwn(value, key));
}

function parseToken(value: unknown): string | null {
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    return null;
  }
  return value;
}

function parseNullableToken(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return parseToken(value) ?? undefined;
}

function parseRevision(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function parseFileStat(value: unknown): FileStat | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['size', 'modifiedMs'])) {
    return null;
  }
  const size = parseRevision(value.size);
  const modifiedMs = parseRevision(value.modifiedMs);
  if (size === null || modifiedMs === null) {
    return null;
  }
  return { size, modifiedMs };
}

function parseFileName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > FILE_NAME_MAX) {
    return null;
  }
  if (hasPathSeparator(value) || hasControlChar(value)) {
    return null;
  }
  return value;
}

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function hasNullOrLineBreak(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 0 || code === 10 || code === 13) {
      return true;
    }
  }
  return false;
}

function parseMessage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > MESSAGE_MAX || value.includes('\0')) {
    return null;
  }
  return value;
}

function parseReason(value: unknown): string | null {
  if (typeof value !== 'string' || !REASON.test(value)) {
    return null;
  }
  return value;
}

function parseRefused(value: Record<string, unknown>): RefusedResult | null {
  if (!hasExactKeys(value, ['status', 'reason', 'message'])) {
    return null;
  }
  const reason = parseReason(value.reason);
  const message = parseMessage(value.message);
  if (reason === null || message === null) {
    return null;
  }
  return { status: 'refused', reason, message };
}

function parseErrorResult(value: Record<string, unknown>): IpcErrorResult | null {
  if (!hasExactKeys(value, ['status', 'code', 'message', 'retryable'])) {
    return null;
  }
  if (!isIpcErrorCode(value.code)) {
    return null;
  }
  const message = parseMessage(value.message);
  if (message === null || value.retryable !== IPC_ERROR_RETRYABLE[value.code]) {
    return null;
  }
  return {
    status: 'error',
    code: value.code,
    message,
    retryable: IPC_ERROR_RETRYABLE[value.code],
  };
}

function parseJson(value: unknown, depth: number, seen: WeakSet<object>): { ok: true; value: JsonValue } | { ok: false } {
  if (value === null) {
    return { ok: true, value: null };
  }
  if (typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (typeof value === 'string') {
    return value.includes('\0') ? { ok: false } : { ok: true, value };
  }
  if (typeof value !== 'object') {
    return { ok: false };
  }
  if (depth >= JSON_DEPTH_MAX || seen.has(value)) {
    return { ok: false };
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const copy: JsonValue[] = [];
    for (const item of value) {
      const parsedItem = parseJson(item, depth + 1, seen);
      if (!parsedItem.ok) {
        return { ok: false };
      }
      copy.push(parsedItem.value);
    }
    return { ok: true, value: copy };
  }
  if (!isPlainRecord(value)) {
    return { ok: false };
  }
  const copy: JsonObject = {};
  for (const key of Object.keys(value)) {
    const parsedItem = parseJson(value[key], depth + 1, seen);
    if (!parsedItem.ok) {
      return { ok: false };
    }
    copy[key] = parsedItem.value;
  }
  return { ok: true, value: copy };
}

function parseJsonObject(value: unknown): JsonObject | null {
  const parsedJson = parseJson(value, 0, new WeakSet());
  if (!parsedJson.ok || parsedJson.value === null || typeof parsedJson.value !== 'object' || Array.isArray(parsedJson.value)) {
    return null;
  }
  return parsedJson.value;
}

function parseDocument(value: unknown): DocumentMessage | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['view', 'page', 'header', 'footer', 'blocks'])) {
    return null;
  }
  if (value.view !== 'pages' && value.view !== 'pageless') {
    return null;
  }
  const page = parseJsonObject(value.page);
  const header = parseJsonObject(value.header);
  const footer = parseJsonObject(value.footer);
  if (page === null || header === null || footer === null || !Array.isArray(value.blocks)) {
    return null;
  }
  const blocks: JsonObject[] = [];
  for (const block of value.blocks) {
    const parsedBlock = parseJsonObject(block);
    if (parsedBlock === null) {
      return null;
    }
    blocks.push(parsedBlock);
  }
  return { view: value.view, page, header, footer, blocks };
}

function parseStringArray(value: unknown, maxChars: number | null): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const copy: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.includes('\0')) {
      return null;
    }
    if (maxChars !== null && item.length > maxChars) {
      return null;
    }
    copy.push(item);
  }
  return copy;
}

function parseAssets(value: unknown): ExportAssets | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['mathml', 'formulaPngs', 'firstFramePngs'])) {
    return null;
  }
  const mathml = parseStringArray(value.mathml, null);
  const formulaPngs = parseStringArray(value.formulaPngs, PNG_BASE64_MAX_CHARS);
  const firstFramePngs = parseStringArray(value.firstFramePngs, PNG_BASE64_MAX_CHARS);
  if (mathml === null || formulaPngs === null || firstFramePngs === null) {
    return null;
  }
  return { mathml, formulaPngs, firstFramePngs };
}

function parseFileSave(args: readonly unknown[]): FileSaveRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['handle', 'document', 'revision', 'expectedStat', 'replaceConfirmed'])) {
    return null;
  }
  const handle = parseToken(value.handle);
  const document = parseDocument(value.document);
  const revision = parseRevision(value.revision);
  if (handle === null || document === null || revision === null || typeof value.replaceConfirmed !== 'boolean') {
    return null;
  }
  if (value.expectedStat === null) {
    return { handle, document, revision, expectedStat: null, replaceConfirmed: value.replaceConfirmed };
  }
  const expectedStat = parseFileStat(value.expectedStat);
  if (expectedStat === null) {
    return null;
  }
  return { handle, document, revision, expectedStat, replaceConfirmed: value.replaceConfirmed };
}

function parseFileSaveAs(args: readonly unknown[]): FileSaveAsRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['handle', 'document', 'revision'])) {
    return null;
  }
  const handle = parseNullableToken(value.handle);
  const document = parseDocument(value.document);
  const revision = parseRevision(value.revision);
  if (handle === undefined || document === null || revision === null) {
    return null;
  }
  return { handle, document, revision };
}

function parseSessionSet(args: readonly unknown[]): SessionSetRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['handles', 'activeHandle'])) {
    return null;
  }
  if (!Array.isArray(value.handles)) {
    return null;
  }
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const item of value.handles) {
    const handle = parseToken(item);
    if (handle === null || seen.has(handle)) {
      return null;
    }
    seen.add(handle);
    handles.push(handle);
  }
  if (value.activeHandle === null) {
    return { handles, activeHandle: null };
  }
  const activeHandle = parseToken(value.activeHandle);
  if (activeHandle === null || !seen.has(activeHandle)) {
    return null;
  }
  return { handles, activeHandle };
}

function parseExportRun(args: readonly unknown[]): ExportRunRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['format', 'handle', 'document', 'assets'])) {
    return null;
  }
  if (typeof value.format !== 'string' || !EXPORT_FORMAT_SET.has(value.format)) {
    return null;
  }
  const handle = parseNullableToken(value.handle);
  const document = parseDocument(value.document);
  const assets = parseAssets(value.assets);
  if (handle === undefined || document === null || assets === null) {
    return null;
  }
  return { format: value.format as ExportRunRequest['format'], handle, document, assets };
}

function parsePrintRun(args: readonly unknown[]): PrintRunRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['document', 'assets'])) {
    return null;
  }
  const document = parseDocument(value.document);
  const assets = parseAssets(value.assets);
  if (document === null || assets === null) {
    return null;
  }
  return { document, assets };
}

function parsePrefsGet(args: readonly unknown[]): PrefsGetRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['key'])) {
    return null;
  }
  if (typeof value.key !== 'string' || !PREFERENCE_KEY_SET.has(value.key)) {
    return null;
  }
  return { key: value.key as PreferenceKey };
}

function parsePreferenceEntry(value: Record<string, unknown>): PreferenceEntry | null {
  if (!hasExactKeys(value, ['key', 'value']) || typeof value.key !== 'string' || !PREFERENCE_KEY_SET.has(value.key)) {
    return null;
  }
  switch (value.key) {
    case 'theme':
      if (typeof value.value !== 'string' || !THEME_SET.has(value.value)) {
        return null;
      }
      return { key: 'theme', value: value.value as ThemePreference };
    case 'spelling':
      return typeof value.value === 'boolean' ? { key: 'spelling', value: value.value } : null;
    case 'defaultFont':
      if (
        typeof value.value !== 'string' ||
        value.value.length < 1 ||
        value.value.length > FONT_NAME_MAX ||
        hasControlChar(value.value) ||
        hasPathSeparator(value.value)
      ) {
        return null;
      }
      return { key: 'defaultFont', value: value.value };
    case 'defaultSize':
      if (typeof value.value !== 'number' || !FONT_SIZE_SET.has(value.value)) {
        return null;
      }
      return { key: 'defaultSize', value: value.value as FontSizePt };
    case 'restoreTabs':
      return typeof value.value === 'boolean' ? { key: 'restoreTabs', value: value.value } : null;
    case 'showPageEdges':
      return typeof value.value === 'boolean' ? { key: 'showPageEdges', value: value.value } : null;
    default:
      return null;
  }
}

function parsePrefsSet(args: readonly unknown[]): PreferenceEntry | null {
  const value = oneObject(args);
  if (value === null) {
    return null;
  }
  return parsePreferenceEntry(value);
}

function parseIdRequest(args: readonly unknown[]): SigGetRequest & SigDeleteRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['id'])) {
    return null;
  }
  const id = parseToken(value.id);
  return id === null ? null : { id };
}

function parseSigSave(args: readonly unknown[]): SigSaveRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['name', 'png'])) {
    return null;
  }
  if (
    typeof value.name !== 'string' ||
    value.name.length < 1 ||
    value.name.length > SIGNATURE_NAME_MAX ||
    hasControlChar(value.name) ||
    hasPathSeparator(value.name)
  ) {
    return null;
  }
  if (typeof value.png !== 'string' || value.png.length < 1 || value.png.length > PNG_BASE64_MAX_CHARS || value.png.includes('\0')) {
    return null;
  }
  return { name: value.name, png: value.png };
}

function parseRecoveryPut(args: readonly unknown[]): RecoveryPutRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['recoveryId', 'document', 'firstLine'])) {
    return null;
  }
  const recoveryId = parseNullableToken(value.recoveryId);
  const document = parseDocument(value.document);
  if (
    recoveryId === undefined ||
    document === null ||
    typeof value.firstLine !== 'string' ||
    value.firstLine.length > FIRST_LINE_MAX ||
    hasNullOrLineBreak(value.firstLine)
  ) {
    return null;
  }
  return { recoveryId, document, firstLine: value.firstLine };
}

function parseRecoveryId(args: readonly unknown[]): RecoveryRestoreRequest & RecoveryDropRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['recoveryId'])) {
    return null;
  }
  const recoveryId = parseToken(value.recoveryId);
  return recoveryId === null ? null : { recoveryId };
}

function parseLinkOpen(args: readonly unknown[]): LinkOpenRequest | null {
  const value = oneObject(args);
  if (value === null || !hasExactKeys(value, ['address'])) {
    return null;
  }
  if (
    typeof value.address !== 'string' ||
    value.address.length < 1 ||
    value.address.length > ADDRESS_MAX ||
    hasControlChar(value.address)
  ) {
    return null;
  }
  return { address: value.address };
}
