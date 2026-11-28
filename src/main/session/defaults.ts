import { SESSION_VERSION } from './constants.js';

export interface SessionRecord {
  version: number;
  paths: string[];
  activePath: string | null;
}

export function emptySession(): SessionRecord {
  return {
    version: SESSION_VERSION,
    paths: [],
    activePath: null,
  };
}