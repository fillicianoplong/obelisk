import path from 'node:path';
import { isInsideDirectory } from '../security/app-data.js';
import { RECOVERY_DIR } from './constants.js';

const RECOVERY_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function recoveryDirectory(userDataDir: string): string {
  return path.join(userDataDir, RECOVERY_DIR);
}

export function isRecoveryId(value: string): boolean {
  return RECOVERY_ID.test(value);
}

export function recoveryRecordPaths(userDataDir: string, recoveryId: string): { obk: string; meta: string } | null {
  if (!isRecoveryId(recoveryId)) {
    return null;
  }
  const dir = recoveryDirectory(userDataDir);
  const obk = path.join(dir, `${recoveryId}.obk`);
  const meta = path.join(dir, `${recoveryId}.json`);
  if (!isInsideDirectory(dir, obk) || !isInsideDirectory(dir, meta)) {
    return null;
  }
  return { obk, meta };
}