import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { packager } from '@electron/packager';
import { assertFusesOff, flipRequiredFusesOff } from './fuses.mjs';
import {
  APP_ICON_RELATIVE,
  bundledPageFontLayoutPaths,
  assertDevManifest,
  assertNoDevPackageFiles,
  assertPriDumpMatchesManifest,
  buildResourceIndex,
  dumpResourceIndex,
  chooseDevCertificate,
  copyZipRuntime,
  DEV_CERT_INF_FILE,
  filesInDirectory,
  MSIX_CERTIFICATE_FILE,
  MSIX_EXECUTABLE,
  MSIX_PACKAGE_FILE,
  MSIX_PUBLISHER,
  PACKAGER_IGNORE,
  PRI_CONFIG_FILE,
  PRI_RESOURCE_FILE,
  stalePackagePaths,
  withAppxVersion,
} from './msix-plan.mjs';
import { root } from './tools.mjs';
import { findKitTools, windowsKitRoots } from './windows-kit.mjs';
import { powershell } from './windows-shell.mjs';

if (process.platform !== 'win32') {
  console.error('npm run package:msix must be run on Windows. It packs an x64 MSIX with makeappx and signs it with signtool.');
  process.exit(1);
}

function psString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function certreqPath() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'certreq.exe');
}

// powershell.exe -NoProfile on the current Windows runner images does not load
// the Certificate provider, so the Cert: drive is unusable. The reusable dev
// certificate lives in CurrentUser\My. certreq creates one only when none is
// valid, and always with the key in the current-user store.
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

function exportDevCertificate(thumbprint, cerPath) {
  powershell(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', 'CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
try {
  $found = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, ${psString(thumbprint)}, $false)
  if ($found.Count -lt 1) {
    throw 'The reused dev certificate is not in CurrentUser\\My.'
  }
  $bytes = $found[0].Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
  [System.IO.File]::WriteAllBytes(${psString(cerPath)}, $bytes)
} finally {
  $store.Close()
}
`);
}

function removeCertificates(storeName, location, findType, findValue) {
  powershell(`
$ErrorActionPreference = 'Stop'
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store(${psString(storeName)}, ${psString(location)})
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try {
  $found = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::${findType}, ${psString(findValue)}, $false)
  foreach ($item in @($found)) {
    $store.Remove($item)
  }
} finally {
  $store.Close()
}
`);
}

function readCertificate(cerPath) {
  const stdout = powershell(`
$ErrorActionPreference = 'Stop'
$loaded = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 ${psString(cerPath)}
Write-Output $loaded.Thumbprint
Write-Output $loaded.Subject
$loaded.Dispose()
`);
  const lines = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const thumbprint = lines.find((item) => /^[0-9A-Fa-f]{40}$/.test(item))?.toUpperCase();
  const subject = lines.find((item) => item.startsWith('CN='));
  if (!thumbprint || !subject) {
    throw new Error(`The dev certificate could not be read.\n${stdout}`);
  }
  return { thumbprint, subject };
}

async function ensureDevCertificate(cerPath) {
  const infPath = path.join(path.dirname(cerPath), DEV_CERT_INF_FILE);
  await rm(cerPath, { force: true });
  await rm(infPath, { force: true });
  const inventory = listDevCertificates();
  const chosen = chooseDevCertificate(inventory, new Date());
  const kept = chosen ? String(chosen.thumbprint).toUpperCase() : '';
  for (const cert of inventory) {
    if (String(cert.thumbprint).toUpperCase() !== kept) {
      removeCertificates('My', 'CurrentUser', 'FindByThumbprint', String(cert.thumbprint));
    }
  }
  if (chosen) {
    exportDevCertificate(kept, cerPath);
    console.log('Dev certificate: reused');
    return kept;
  }
  try {
    await writeFile(infPath, devCertificateInf());
    run(certreqPath(), ['-q', '-new', infPath, cerPath]);
  } finally {
    await rm(infPath, { force: true });
  }
  const loaded = readCertificate(cerPath);
  if (loaded.subject !== MSIX_PUBLISHER) {
    removeCertificates('My', 'CurrentUser', 'FindByThumbprint', loaded.thumbprint);
    throw new Error(`Certificate subject '${loaded.subject}' does not match '${MSIX_PUBLISHER}'.`);
  }
  console.log('Dev certificate: created');
  return loaded.thumbprint;
}

async function clearStalePackageOutputs(directory) {
  await mkdir(directory, { recursive: true });
  for (const target of stalePackagePaths(directory)) {
    await rm(target, { force: true });
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited ${result.status ?? 1}.`);
  }
}

function signFile(signtool, thumbprint, target) {
  const args = ['sign', '/fd', 'SHA256', '/sha1', thumbprint, '/s', 'My', target];
  try {
    run(signtool, args);
  } catch (error) {
    if (path.basename(target) !== MSIX_EXECUTABLE) {
      throw error;
    }
    // Flipping fuses invalidates Electron's signature. A broken signature can
    // stop Windows from starting the exe, so strip it and sign with the dev cert.
    run(signtool, ['remove', '/s', target]);
    run(signtool, args);
  }
}

async function assertLayout(layout, { indexed = false } = {}) {
  const required = [
    MSIX_EXECUTABLE,
    'AppxManifest.xml',
    path.join('assets', 'StoreLogo.png'),
    path.join('resources', 'app', 'package.json'),
    path.join('resources', 'app', 'dist', 'main', 'index.js'),
    path.join('resources', 'app', 'dist', 'preload', 'index.js'),
    path.join('resources', 'app', 'dist', 'renderer', 'index.html'),
    path.join('resources', path.basename(APP_ICON_RELATIVE)),
    ...bundledPageFontLayoutPaths(),
  ];
  if (indexed) {
    required.push(PRI_RESOURCE_FILE);
  }
  for (const relative of required) {
    const full = path.join(layout, relative);
    let info;
    try {
      info = await stat(full);
    } catch {
      throw new Error(`The MSIX layout is missing ${relative}.`);
    }
    if (!info.isFile()) {
      throw new Error(`The MSIX layout is missing ${relative}.`);
    }
  }
  if (!indexed) {
    return;
  }
  let configInfo;
  try {
    configInfo = await stat(path.join(layout, PRI_CONFIG_FILE));
  } catch {
    configInfo = null;
  }
  if (configInfo) {
    throw new Error('priconfig.xml must not be packed. makepri already consumed it.');
  }
}

const outputDir = path.join(root, 'dist', 'msix');
const layout = path.join(outputDir, 'layout');
const stage = path.join(root, 'dist', 'packaged');
const msixPath = path.join(outputDir, MSIX_PACKAGE_FILE);
const cerPath = path.join(outputDir, MSIX_CERTIFICATE_FILE);

try {
  await clearStalePackageOutputs(outputDir);
  run(process.execPath, [path.join(root, 'scripts', 'build.mjs')]);

  const tools = findKitTools(windowsKitRoots());
  if (!tools.makeappx || !tools.makepri || !tools.signtool) {
    throw new Error(
      'makeappx.exe, makepri.exe, and signtool.exe were not found. Install the Windows 10 SDK (Windows Kits 10), then run this script again.',
    );
  }
  console.log(`makeappx: ${tools.makeappx}`);
  console.log(`makepri: ${tools.makepri}`);
  console.log(`signtool: ${tools.signtool}`);

  const iconPath = path.join(root, APP_ICON_RELATIVE);
  let iconInfo;
  try {
    iconInfo = await stat(iconPath);
  } catch {
    iconInfo = null;
  }
  if (!iconInfo?.isFile()) {
    throw new Error(`The app icon is missing: ${iconPath}`);
  }

  await rm(stage, { recursive: true, force: true });
  const appPaths = await packager({
    dir: root,
    name: 'Obelisk',
    executableName: 'Obelisk',
    platform: 'win32',
    arch: 'x64',
    out: stage,
    overwrite: true,
    asar: false,
    prune: true,
    junk: true,
    derefSymlinks: true,
    icon: iconPath,
    extraResource: [iconPath],
    ignore: PACKAGER_IGNORE,
  });
  if (!Array.isArray(appPaths) || appPaths.length !== 1) {
    throw new Error('Electron packager did not return the Windows app directory.');
  }

  await rm(layout, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(appPaths[0], layout, { recursive: true, dereference: true });

  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = await readFile(path.join(root, 'packaging', 'msix', 'AppxManifest.xml'), 'utf8');
  assertDevManifest(manifest);
  const versioned = withAppxVersion(manifest, packageJson.version);
  assertDevManifest(versioned);
  await writeFile(path.join(layout, 'AppxManifest.xml'), versioned);
  await cp(path.join(root, 'packaging', 'msix', 'assets'), path.join(layout, 'assets'), {
    recursive: true,
    dereference: true,
  });
  await assertLayout(layout);
  const appDir = path.join(layout, 'resources', 'app');
  const zipModules = await copyZipRuntime(
    path.join(root, 'node_modules'),
    path.join(appDir, 'node_modules'),
  );
  console.log(`Zip runtime: ${zipModules.join(', ')}`);
  assertNoDevPackageFiles(appDir);
  console.log('Packaged app files:');
  for (const relative of filesInDirectory(appDir)) {
    console.log(`  ${relative}`);
  }

  const executable = path.join(layout, MSIX_EXECUTABLE);
  await flipRequiredFusesOff(executable);
  await assertFusesOff(executable);

  const thumbprint = await ensureDevCertificate(cerPath);
  console.log(`Dev certificate thumbprint: ${thumbprint}`);
  signFile(tools.signtool, thumbprint, executable);
  // Qualified names (scale-200, targetsize, altform) are used only when
  // resources.pri indexes them under Files/assets/, matching the manifest.
  // buildResourceIndex removes priconfig.xml.
  await buildResourceIndex(tools.makepri, layout, run);
  assertPriDumpMatchesManifest(await dumpResourceIndex(tools.makepri, layout, run), versioned);
  await assertLayout(layout, { indexed: true });
  await rm(msixPath, { force: true });
  run(tools.makeappx, ['pack', '/d', layout, '/p', msixPath, '/o']);
  try {
    signFile(tools.signtool, thumbprint, msixPath);
  } catch (error) {
    await rm(msixPath, { force: true });
    throw error;
  }

  console.log(`Dev MSIX: ${msixPath}`);
  console.log(`Dev certificate: ${cerPath}`);
  console.log('Trust the dev certificate once as administrator:');
  console.log(`Import-Certificate -FilePath ${cerPath} -CertStoreLocation Cert:\\LocalMachine\\TrustedPeople`);
  console.log('Then Add-AppxPackage and launch run as a standard user. The Start-menu app id is Obelisk.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
