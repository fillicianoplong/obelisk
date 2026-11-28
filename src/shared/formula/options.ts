import type { KatexOptions, StrictFunction } from 'katex';

const strictHandler: StrictFunction = (errorCode) => (
  errorCode === 'htmlExtension' ? 'error' : 'ignore'
);

export function formulaKatexOptions(displayMode = true): KatexOptions {
  return {
    throwOnError: true,
    trust: false,
    displayMode,
    maxSize: 50,
    maxExpand: 1000,
    macros: {},
    output: 'html',
    strict: strictHandler,
  };
}