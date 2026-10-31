import type { IpcErrorResult, IpcTimeoutResult } from './errors.js';
import { DOCUMENT_VIEWS, FONT_SIZES_PT } from '../schema/limits.js';

export { DOCUMENT_VIEWS, FONT_SIZES_PT };

export type DocumentView = (typeof DOCUMENT_VIEWS)[number];

export const EXPORT_FORMATS = ['pdf', 'docx', 'markdown'] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const PREFERENCE_KEYS = [
  'theme',
  'spelling',
  'defaultFont',
  'defaultSize',
  'restoreTabs',
  'showPageEdges',
] as const;

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

export const THEME_VALUES = ['light', 'dark', 'match-windows'] as const;

export type ThemePreference = (typeof THEME_VALUES)[number];

export type FontSizePt = (typeof FONT_SIZES_PT)[number];

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface DocumentMessage {
  view: DocumentView;
  page: JsonObject;
  header: JsonObject;
  footer: JsonObject;
  blocks: JsonObject[];
}

export interface FileStat {
  size: number;
  modifiedMs: number;
}

export interface ExportAssets {
  mathml: string[];
  formulaPngs: string[];
  firstFramePngs: string[];
}

export type PreferenceEntry =
  | { key: 'theme'; value: ThemePreference }
  | { key: 'spelling'; value: boolean }
  | { key: 'defaultFont'; value: string }
  | { key: 'defaultSize'; value: FontSizePt }
  | { key: 'restoreTabs'; value: boolean }
  | { key: 'showPageEdges'; value: boolean };

export interface RefusedResult {
  status: 'refused';
  reason: string;
  message: string;
}

export type FileOpenResult =
  | {
      status: 'ok';
      handle: string;
      name: string;
      document: DocumentMessage;
      stat: FileStat;
    }
  | { status: 'cancelled' }
  | RefusedResult
  | { status: 'alreadyOpen'; tabId: string }
  | IpcErrorResult;

export interface FileSaveRequest {
  handle: string;
  document: DocumentMessage;
  revision: number;
  expectedStat: FileStat | null;
  // Architecture 6.1. The section 6.3 row names the other fields only.
  replaceConfirmed: boolean;
}

export type FileSaveResult =
  | { status: 'ok'; stat: FileStat; revision: number }
  | { status: 'conflict'; stat: FileStat }
  | { status: 'exists' }
  | IpcTimeoutResult
  | IpcErrorResult;

export interface FileSaveAsRequest {
  handle: string | null;
  document: DocumentMessage;
  revision: number;
}

export type FileSaveAsResult =
  | { status: 'ok'; handle: string; name: string; stat: FileStat; revision: number }
  | { status: 'conflict'; stat: FileStat }
  | { status: 'exists' }
  | { status: 'cancelled' }
  | IpcTimeoutResult
  | IpcErrorResult;

export interface SessionSetRequest {
  handles: string[];
  activeHandle: string | null;
}

export type SessionSetResult = { status: 'ok' } | IpcErrorResult;

export interface ExportRunRequest {
  format: ExportFormat;
  handle: string | null;
  document: DocumentMessage;
  assets: ExportAssets;
}

export type ExportRunResult =
  | { status: 'ok'; name: string; formulasAsImages: boolean }
  | { status: 'cancelled' }
  | IpcTimeoutResult
  | IpcErrorResult;

export interface PrintRunRequest {
  document: DocumentMessage;
  assets: ExportAssets;
}

export type PrintRunResult = { status: 'ok' } | { status: 'cancelled' } | IpcErrorResult;

export interface PrefsGetRequest {
  key: PreferenceKey;
}

export type PrefsGetResult = ({ status: 'ok' } & PreferenceEntry) | RefusedResult | IpcErrorResult;

export type PrefsSetRequest = PreferenceEntry;

export type PrefsSetResult = { status: 'ok' } | RefusedResult | IpcErrorResult;

export interface SignatureSummary {
  id: string;
  name: string;
}

export type SigListResult =
  | { status: 'ok'; signatures: SignatureSummary[] }
  | { status: 'unavailable'; message: string }
  | IpcErrorResult;

export interface SigGetRequest {
  id: string;
}

export type SigGetResult =
  | { status: 'ok'; png: string }
  | { status: 'unavailable'; message: string }
  | { status: 'notFound' }
  | IpcErrorResult;

export interface SigSaveRequest {
  name: string;
  png: string;
}

export type SigSaveResult =
  | { status: 'ok'; id: string }
  | { status: 'unavailable'; message: string }
  | { status: 'limitReached' }
  | RefusedResult
  | IpcErrorResult;

export interface SigDeleteRequest {
  id: string;
}

export type SigDeleteResult = { status: 'ok' } | { status: 'notFound' } | IpcErrorResult;

export interface RecoveryPutRequest {
  recoveryId: string | null;
  document: DocumentMessage;
  firstLine: string;
}

export type RecoveryPutResult = { status: 'ok'; recoveryId: string } | IpcErrorResult;

export interface RecoverySummary {
  id: string;
  firstLine: string;
  time: string;
}

export type RecoveryListResult = { status: 'ok'; entries: RecoverySummary[] } | IpcErrorResult;

export interface RecoveryRestoreRequest {
  recoveryId: string;
}

export type RecoveryRestoreResult = FileOpenResult;

export interface RecoveryDropRequest {
  recoveryId: string;
}

export type RecoveryDropResult = { status: 'ok' } | { status: 'notFound' } | IpcErrorResult;

export interface LinkOpenRequest {
  address: string;
}

export type LinkOpenResult = { status: 'ok' } | { status: 'cancelled' } | RefusedResult | IpcErrorResult;

export interface RequestMap {
  'file:open': void;
  'file:save': FileSaveRequest;
  'file:saveAs': FileSaveAsRequest;
  'session:set': SessionSetRequest;
  'export:run': ExportRunRequest;
  'print:run': PrintRunRequest;
  'prefs:get': PrefsGetRequest;
  'prefs:set': PrefsSetRequest;
  'sig:list': void;
  'sig:get': SigGetRequest;
  'sig:save': SigSaveRequest;
  'sig:delete': SigDeleteRequest;
  'recovery:put': RecoveryPutRequest;
  'recovery:list': void;
  'recovery:restore': RecoveryRestoreRequest;
  'recovery:drop': RecoveryDropRequest;
  'link:open': LinkOpenRequest;
}

export interface ResultMap {
  'file:open': FileOpenResult;
  'file:save': FileSaveResult;
  'file:saveAs': FileSaveAsResult;
  'session:set': SessionSetResult;
  'export:run': ExportRunResult;
  'print:run': PrintRunResult;
  'prefs:get': PrefsGetResult;
  'prefs:set': PrefsSetResult;
  'sig:list': SigListResult;
  'sig:get': SigGetResult;
  'sig:save': SigSaveResult;
  'sig:delete': SigDeleteResult;
  'recovery:put': RecoveryPutResult;
  'recovery:list': RecoveryListResult;
  'recovery:restore': RecoveryRestoreResult;
  'recovery:drop': RecoveryDropResult;
  'link:open': LinkOpenResult;
}

export type IpcDispatchResult = ResultMap[keyof ResultMap];
