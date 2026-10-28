export type Phase = 'encrypt' | 'decrypt' | 'probe' | 'manual';

export function phaseFrom(env: NodeJS.ProcessEnv, argv: readonly string[]): Phase {
  const flagged = argv.indexOf('--phase');
  const fromArg = flagged >= 0 ? argv[flagged + 1] : undefined;
  const raw = (fromArg || env.OBELISK_S07_PHASE || '').toLowerCase();
  if (raw === 'encrypt' || raw === 'decrypt' || raw === 'probe') return raw;
  return 'manual';
}
