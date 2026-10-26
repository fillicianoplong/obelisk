import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertFusesOff } from './fuses.mjs';
import { powershell } from './windows-shell.mjs';

function psString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function extractPackagedExecutable(packagePath, destPath) {
  if (process.platform !== 'win32') {
    throw new Error('Checking fuses inside an MSIX requires Windows.');
  }
  powershell(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead(${psString(packagePath)})
try {
  $entry = $null
  foreach ($item in $zip.Entries) {
    $name = $item.FullName.Replace('\\', '/')
    if ($name -eq 'Obelisk.exe') {
      $entry = $item
      break
    }
  }
  if (-not $entry) {
    throw 'Obelisk.exe is not at the root of the MSIX.'
  }
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, ${psString(destPath)}, $true)
} finally {
  $zip.Dispose()
}
`);
}

function isPackage(file) {
  const extension = path.extname(file).toLowerCase();
  return extension === '.msix' || extension === '.appx';
}

async function checkTarget(target) {
  const resolved = path.resolve(target);
  if (!isPackage(resolved)) {
    await assertFusesOff(resolved);
    console.log(`Electron fuses off: ${resolved}`);
    return;
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-fuses-'));
  const extracted = path.join(directory, 'Obelisk.exe');
  try {
    await extractPackagedExecutable(resolved, extracted);
    await assertFusesOff(extracted);
    console.log(`Electron fuses off: ${resolved}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/check-fuses.mjs <Obelisk.msix-or-electron-binary> [...]');
  process.exit(1);
}

try {
  for (const target of targets) {
    await checkTarget(target);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
