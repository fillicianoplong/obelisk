import { flipFuses, FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';

export const CHECKED_FUSES = [
  { option: FuseV1Options.RunAsNode, name: 'runAsNode' },
  { option: FuseV1Options.EnableNodeCliInspectArguments, name: 'nodeCliInspect' },
];

export function describeFuseState(state) {
  if (state === FuseState.DISABLE) {
    return 'off';
  }
  if (state === FuseState.ENABLE) {
    return 'on';
  }
  if (state === FuseState.REMOVED) {
    return 'removed';
  }
  return 'missing';
}

export function disabledFuseProblems(wire) {
  const problems = [];
  for (const fuse of CHECKED_FUSES) {
    const state = wire[fuse.option];
    if (state !== FuseState.DISABLE && state !== FuseState.REMOVED) {
      problems.push(`${fuse.name} is ${describeFuseState(state)}`);
    }
  }
  return problems;
}

export async function flipRequiredFusesOff(binary) {
  await flipFuses(binary, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
}

export async function assertFusesOff(binary) {
  const wire = await getCurrentFuseWire(binary);
  const problems = disabledFuseProblems(wire);
  if (problems.length > 0) {
    throw new Error(
      `Electron fuses check failed: ${problems.join('; ')}. runAsNode and nodeCliInspect must be off.`,
    );
  }
  return wire;
}
