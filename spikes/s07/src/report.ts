export interface CheckRow {
  id: string;
  pass: boolean;
  detail: string;
}

export interface CaptureNote {
  ok: boolean;
  bytes?: number;
  error?: string;
}

export interface SpikeReport {
  spike: 'S-07';
  phase: string;
  ok: boolean;
  packaged: boolean;
  windowsStore: boolean;
  electron: { version: string; chrome: string; node: string };
  expectedElectron: string;
  userData: string;
  localState: string;
  localStateExists: boolean;
  localStateBytes: number;
  encryptionAvailable: boolean | null;
  asyncEncryptionAvailable: boolean | null;
  deprecationWarnings: string[];
  syncRoundTrip: boolean | null;
  syncError: string | null;
  sessionEncryption: boolean | null;
  plaintextMatch: boolean | null;
  shouldReEncrypt: boolean | null;
  secondShouldReEncrypt: boolean | null;
  encryptError: string | null;
  decryptError: string | null;
  temporarilyUnavailable: boolean;
  unencryptedDecryptError: string | null;
  leaks: string[];
  cipherSha256: string | null;
  userDataCipherSha256: string | null;
  plainSha256: string;
  restart: boolean | null;
  cipherUnchanged: boolean | null;
  checks: CheckRow[];
  walkthroughPng: CaptureNote | null;
  walkthroughPainted: boolean | null;
  reportPath: string;
  argv: string[];
  pageEvents: string[];
}
