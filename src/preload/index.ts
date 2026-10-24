declare function require(moduleName: string): unknown;

interface PreloadProcess {
  sandboxed?: boolean;
  contextIsolated?: boolean;
}

function nodeFileSystemAvailable(): boolean {
  try {
    require('fs');
    return true;
  } catch {
    return false;
  }
}

const preloadProcess = process as NodeJS.Process & PreloadProcess;

console.info(
  `OBELISK_PRELOAD ${JSON.stringify({
    sandboxed: preloadProcess.sandboxed === true,
    contextIsolated: preloadProcess.contextIsolated === true,
    nodeRequireFs: nodeFileSystemAvailable(),
  })}`,
);
