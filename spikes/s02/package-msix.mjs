// Follows scripts/package-msix.mjs: publisher CN=Obelisk Dev, certreq into CurrentUser\My,
// signtool by thumbprint, then makeappx. The identity is Obelisk.SpikeS02 so it does not replace Obelisk.Dev.
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { assertFusesOff, flipRequiredFusesOff } from '../../scripts/fuses.mjs';
import { chooseDevCertificate, MSIX_PUBLISHER } from '../../scripts/msix-plan.mjs';
import { findKitTools, windowsKitRoots } from '../../scripts/windows-kit.mjs';
import { powershell } from '../../scripts/windows-shell.mjs';

const spikeRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(spikeRoot, '..', '..');
const outputDir = path.join(spikeRoot, 'dist', 'msix');
const layout = path.join(outputDir, 'layout');
const stage = path.join(spikeRoot, 'dist', 'packaged');
const appDir = path.join(spikeRoot, 'dist', 'app');
const msixPath = path.join(outputDir, 'Obelisk-Spike-S02.msix');
const cerPath = path.join(outputDir, 'obelisk-spike-s02.cer');
const exeName = 'ObeliskSpikeS02.exe';

if (process.platform !== 'win32') {
  console.error('npm run package:msix must be run on Windows. It packs the spike as Obelisk.SpikeS02.');
  process.exit(1);
}

function psString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited ${result.status ?? 1}.`);
  }
}

function listDevCertificates() {
  const stdout = powershell(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', 'CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
try {
  foreach ($cert in $store.Certificates) {
    if ($cert.Subject -ne ${psString(MSIX_PUBLISHER)}) { continue }
    $codeSigning = $false
    foreach ($ext in $cert.Extensions) {
      $eku = $ext -as [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]
      if (-not $eku) { continue }
      foreach ($oid in $eku.EnhancedKeyUsages) {
        if ($oid.Value -eq '1.3.6.1.5.5.7.3.3') { $codeSigning = $true }
      }
    }
    $row = [pscustomobject]@{
      subject = $cert.Subject
      thumbprint = $cert.Thumbprint
      notAfter = $cert.NotAfter.ToUniversalTime().ToString('o')
      codeSigning = $codeSigning
      hasPrivateKey = [bool]$cert.HasPrivateKey
    }
    Write-Output ($row | ConvertTo-Json -Compress)
  }
} finally {
  $store.Close()
}
`);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

function exportDevCertificate(thumbprint) {
  powershell(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', 'CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
try {
  $found = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, ${psString(thumbprint)}, $false)
  if ($found.Count -lt 1) { throw 'The reused dev certificate is not in CurrentUser\\My.' }
  $bytes = $found[0].Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
  [System.IO.File]::WriteAllBytes(${psString(cerPath)}, $bytes)
} finally {
  $store.Close()
}
`);
}

function devCertificateInf() {
  return [
    '[Version]',
    'Signature = "$Windows NT$"',
    '',
    '[NewRequest]',
    `Subject = "${MSIX_PUBLISHER}"`,
    'KeySpec = 2',
    'KeyLength = 2048',
    'Exportable = FALSE',
    'MachineKeySet = FALSE',
    'ProviderName = "Microsoft Enhanced RSA and AES Cryptographic Provider"',
    'ProviderType = 24',
    'HashAlgorithm = SHA256',
    'RequestType = Cert',
    'KeyUsage = 0x80',
    'ValidityPeriod = Years',
    'ValidityPeriodUnits = 1',
    '',
    '[EnhancedKeyUsageExtension]',
    'OID=1.3.6.1.5.5.7.3.3',
    '',
  ].join('\r\n');
}

async function ensureDevCertificate() {
  const infPath = path.join(outputDir, 'obelisk-spike-s02.inf');
  await rm(cerPath, { force: true });
  await rm(infPath, { force: true });
  const chosen = chooseDevCertificate(listDevCertificates(), new Date());
  if (chosen) {
    const thumbprint = String(chosen.thumbprint).toUpperCase();
    exportDevCertificate(thumbprint);
    console.log('Dev certificate: reused');
    return thumbprint;
  }
  const certreq = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'certreq.exe');
  try {
    await writeFile(infPath, devCertificateInf());
    run(certreq, ['-q', '-new', infPath, cerPath]);
  } finally {
    await rm(infPath, { force: true });
  }
  const loaded = powershell(`
$ErrorActionPreference = 'Stop'
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 ${psString(cerPath)}
Write-Output $cert.Thumbprint
Write-Output $cert.Subject
$cert.Dispose()
`);
  const lines = loaded.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const thumbprint = lines.find((line) => /^[0-9A-Fa-f]{40}$/.test(line))?.toUpperCase();
  const subject = lines.find((line) => line.startsWith('CN='));
  if (!thumbprint || subject !== MSIX_PUBLISHER) {
    throw new Error(`Certificate subject '${subject ?? ''}' does not match '${MSIX_PUBLISHER}'.`);
  }
  console.log('Dev certificate: created');
  return thumbprint;
}

function signFile(signtool, thumbprint, target) {
  const args = ['sign', '/fd', 'SHA256', '/sha1', thumbprint, '/s', 'My', target];
  try {
    run(signtool, args);
  } catch (error) {
    if (path.basename(target) !== exeName) throw error;
    run(signtool, ['remove', '/s', target]);
    run(signtool, args);
  }
}

async function electronVersion() {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const version = pkg.devDependencies?.electron;
  if (!version) throw new Error('The app package.json has no electron devDependency.');
  return version;
}

function commitHash() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

async function stageApp(version) {
  await rm(appDir, { recursive: true, force: true });
  await mkdir(appDir, { recursive: true });
  const built = await readdir(path.join(spikeRoot, 'dist'));
  for (const name of built) {
    if (!name.endsWith('.js') || name === 'run-spike.js') continue;
    await cp(path.join(spikeRoot, 'dist', name), path.join(appDir, name));
  }
  for (const name of ['renderer.html', 'renderer.css']) {
    await cp(path.join(spikeRoot, 'src', name), path.join(appDir, name));
  }
  await writeFile(path.join(appDir, 'build.json'), `${JSON.stringify({
    commit: commitHash(),
    electron: version,
    identity: 'Obelisk.SpikeS02',
    version: '0.0.1.0',
    fileType: '.s02obk',
  }, null, 2)}\n`);
  await writeFile(path.join(appDir, 'package.json'), `${JSON.stringify({
    name: 'obelisk-spike-s02',
    productName: 'Obelisk Spike S-02',
    version: '0.0.1',
    private: true,
    main: 'host.js',
  }, null, 2)}\n`);
}

function buildSpike() {
  const tsc = path.join(spikeRoot, 'node_modules', 'typescript', 'lib', 'tsc.js');
  run(process.execPath, [tsc, '-p', 'tsconfig.json'], spikeRoot);
  run(process.execPath, [tsc, '-p', 'tsconfig.renderer.json'], spikeRoot);
}

function assertManifest(manifest) {
  if (!manifest.includes('Name="Obelisk.SpikeS02"')) throw new Error('The spike manifest name is not Obelisk.SpikeS02.');
  if (!manifest.includes(`Publisher="${MSIX_PUBLISHER}"`)) throw new Error('The spike manifest publisher is not CN=Obelisk Dev.');
  if (manifest.includes('Name="Obelisk.Dev"')) throw new Error('The spike manifest must not use the Obelisk.Dev identity.');
  if (!manifest.includes('<uap:FileType>.s02obk</uap:FileType>')) throw new Error('The spike manifest does not register .s02obk.');
  if (/<uap:FileType>\.obk<\/uap:FileType>/.test(manifest)) throw new Error('The spike manifest must not register .obk.');
  if (!manifest.includes('Alias="ObeliskSpikeS02.exe"')) throw new Error('The spike manifest alias is not ObeliskSpikeS02.exe.');
}

async function main() {
  buildSpike();
  const manifest = await readFile(path.join(spikeRoot, 'AppxManifest.xml'), 'utf8');
  assertManifest(manifest);
  const tools = findKitTools(windowsKitRoots());
  if (!tools.makeappx || !tools.signtool) {
    throw new Error('makeappx.exe and signtool.exe were not found. Install the Windows 10 SDK, then run this script again.');
  }
  console.log(`makeappx: ${tools.makeappx}`);
  console.log(`signtool: ${tools.signtool}`);
  const version = await electronVersion();
  await stageApp(version);
  await rm(stage, { recursive: true, force: true });
  const icon = path.join(repoRoot, 'packaging', 'icons', 'obelisk.ico');
  const appPaths = await packager({
    dir: appDir,
    name: 'ObeliskSpikeS02',
    executableName: 'ObeliskSpikeS02',
    platform: 'win32',
    arch: 'x64',
    out: stage,
    overwrite: true,
    asar: false,
    prune: true,
    junk: true,
    derefSymlinks: true,
    icon,
    electronVersion: version,
  });
  if (!Array.isArray(appPaths) || appPaths.length !== 1) {
    throw new Error('Electron packager did not return the spike app directory.');
  }
  await rm(layout, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(appPaths[0], layout, { recursive: true, dereference: true });
  await cp(path.join(spikeRoot, 'AppxManifest.xml'), path.join(layout, 'AppxManifest.xml'));
  await mkdir(path.join(layout, 'assets'), { recursive: true });
  for (const name of ['StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png']) {
    await cp(path.join(repoRoot, 'packaging', 'msix', 'assets', name), path.join(layout, 'assets', name));
  }
  const executable = path.join(layout, exeName);
  const exeInfo = await stat(executable);
  if (!exeInfo.isFile()) throw new Error(`The packaged executable is missing: ${executable}`);
  await flipRequiredFusesOff(executable);
  await assertFusesOff(executable);
  const thumbprint = await ensureDevCertificate();
  console.log(`Dev certificate thumbprint: ${thumbprint}`);
  signFile(tools.signtool, thumbprint, executable);
  await rm(msixPath, { force: true });
  try {
    run(tools.makeappx, ['pack', '/d', layout, '/p', msixPath, '/o']);
    signFile(tools.signtool, thumbprint, msixPath);
  } catch (error) {
    await rm(msixPath, { force: true });
    throw error;
  }
  console.log(`Spike MSIX: ${msixPath}`);
  console.log(`Dev certificate: ${cerPath}`);
  console.log('This package is Obelisk.SpikeS02. It does not replace Obelisk.Dev and it does not register .obk.');
  console.log('The publisher is CN=Obelisk Dev, the same certificate already trusted in LocalMachine\\TrustedPeople.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
