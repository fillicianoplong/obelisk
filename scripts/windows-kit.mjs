import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ARCH_RANK = { x64: 3, arm64: 2, x86: 1 };

export function findKitTools(roots) {
  const hits = [];
  for (const root of roots) {
    if (!root || !existsSync(root)) {
      continue;
    }
    let versions;
    try {
      versions = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const version of versions) {
      if (!version.isDirectory() || !/^\d+\.\d+\.\d+\.\d+$/.test(version.name)) {
        continue;
      }
      for (const arch of ['x64', 'arm64', 'x86']) {
        for (const tool of ['makeappx.exe', 'signtool.exe', 'makepri.exe']) {
          const candidate = path.join(root, version.name, arch, tool);
          if (existsSync(candidate)) {
            hits.push({ tool, version: version.name, arch, candidate });
          }
        }
      }
    }
  }

  hits.sort((left, right) => {
    const byVersion = left.version.localeCompare(right.version, undefined, { numeric: true });
    if (byVersion !== 0) {
      return byVersion;
    }
    return (ARCH_RANK[left.arch] ?? 0) - (ARCH_RANK[right.arch] ?? 0);
  });

  const found = { makeappx: null, signtool: null, makepri: null };
  for (const hit of hits) {
    if (hit.tool === 'makeappx.exe') {
      found.makeappx = hit.candidate;
    }
    if (hit.tool === 'signtool.exe') {
      found.signtool = hit.candidate;
    }
    if (hit.tool === 'makepri.exe') {
      found.makepri = hit.candidate;
    }
  }
  return found;
}

export function windowsKitRoots() {
  return [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map((dir) => path.join(dir, 'Windows Kits', '10', 'bin'));
}
