import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SMOKE_MARKER_FILE } from '../../../dist/main/security/app-data.js';
import {
  applicationAttributes,
  assertDevManifest,
  assertNoDevPackageFiles,
  chooseDevCertificate,
  DEV_CERT_INF_FILE,
  DEV_PACKAGE_FILES,
  devFilesInDirectory,
  identityAttributes,
  ignoredByPackager,
  MSIX_APP_ID,
  MSIX_ASSETS,
  MSIX_CERTIFICATE_FILE,
  MSIX_PACKAGE_FILE,
  MSIX_PUBLISHER,
  manifestAssetPaths,
  stalePackagePaths,
  toAppxVersion,
  withAppxVersion,
} from '../../../scripts/msix-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function pngSize(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('an Appx version is four numbers from the package version', () => {
  assert.equal(toAppxVersion('0.1.0'), '0.1.0.0');
  assert.equal(toAppxVersion('0.1.0.0'), '0.1.0.0');
  assert.equal(toAppxVersion('65535.0.1.2'), '65535.0.1.2');
  assert.throws(() => toAppxVersion('1.2'), /Appx version/);
  assert.throws(() => toAppxVersion('0.1.0-dev'), /Appx version/);
  assert.throws(() => toAppxVersion('1.2.3.65536'), /65535/);
});

test('the dev manifest associates .obk and stays a per-user full-trust app', async () => {
  const xml = await readFile(path.join(root, 'packaging/msix/AppxManifest.xml'), 'utf8');
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const identity = assertDevManifest(xml);
  assert.equal(identity.Version, toAppxVersion(packageJson.version));
  assert.equal(identityAttributes(withAppxVersion(xml, '0.2.0')).Version, '0.2.0.0');
  assert.match(xml, /Category="windows.fileTypeAssociation"/);
  assert.match(xml, /<uap:FileType>\.obk<\/uap:FileType>/);
  assert.match(xml, /Obelisk Document/);
  assert.equal(applicationAttributes(xml).Id, MSIX_APP_ID);
  assert.match(xml, /windows.appExecutionAlias/);
  assert.equal(xml.includes('requireAdministrator'), false);
  assert.equal(xml.includes('internetClient'), false);

  const assets = manifestAssetPaths(xml);
  assert.deepEqual(assets.sort(), Object.keys(MSIX_ASSETS).sort());
  for (const [relative, size] of Object.entries(MSIX_ASSETS)) {
    const file = path.join(root, 'packaging', 'msix', ...relative.split('\\'));
    const image = await readFile(file);
    assert.deepEqual(pngSize(image), size, relative);
  }
});

test('the packager ignores source and tools but keeps the built app', () => {
  assert.equal(ignoredByPackager('/repo/src/main/index.ts'), true);
  assert.equal(ignoredByPackager('D:\\repo\\src\\main\\index.ts'), true);
  assert.equal(ignoredByPackager('/repo/node_modules/react/index.js'), true);
  assert.equal(ignoredByPackager('/repo/packaging/msix/AppxManifest.xml'), true);
  assert.equal(ignoredByPackager('/repo/dist/msix/layout/Obelisk.exe'), true);
  assert.equal(ignoredByPackager('/repo/dist/packaged/Obelisk-win32-x64/Obelisk.exe'), true);
  assert.equal(ignoredByPackager('/repo/dist/main/index.js'), false);
  assert.equal(ignoredByPackager('/repo/dist/renderer/index.html'), false);
  assert.equal(ignoredByPackager('/repo/package.json'), false);
  for (const name of DEV_PACKAGE_FILES) {
    assert.equal(ignoredByPackager(`/repo/${name}`), true, name);
    assert.equal(ignoredByPackager(`D:\\repo\\${name}`), true, name);
  }
  assert.equal(ignoredByPackager('/repo/dist/main/index.js.map'), true);
  assert.equal(ignoredByPackager('/repo/dist/renderer/assets/index.css.map'), true);
});

test('the packaged app layout rejects dev files and source maps', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-layout-'));
  try {
    await mkdir(path.join(directory, 'dist', 'main'), { recursive: true });
    await writeFile(path.join(directory, 'package.json'), '{}\n');
    await writeFile(path.join(directory, 'dist', 'main', 'index.js'), 'export {}\n');
    await writeFile(path.join(directory, 'dist', 'main', 'index.js.map'), '{}\n');
    for (const name of DEV_PACKAGE_FILES) {
      await writeFile(path.join(directory, name), 'dev\n');
    }
    const found = devFilesInDirectory(directory);
    for (const name of DEV_PACKAGE_FILES) {
      assert.equal(found.includes(name), true, name);
    }
    assert.equal(found.includes(path.join('dist', 'main', 'index.js.map')), true);
    assert.equal(found.includes('package.json'), false);
    assert.equal(found.includes(path.join('dist', 'main', 'index.js')), false);
    assert.throws(() => assertNoDevPackageFiles(directory), /dev files/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a valid dev certificate is reused and stale package outputs are the msix, cer, and inf', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  const valid = {
    subject: MSIX_PUBLISHER,
    thumbprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    notAfter: '2027-06-01T00:00:00.000Z',
    codeSigning: true,
    hasPrivateKey: true,
  };
  assert.equal(chooseDevCertificate([], now), null);
  assert.equal(chooseDevCertificate(null, now), null);
  assert.equal(chooseDevCertificate([{ ...valid, notAfter: now.toISOString() }], now), null);
  assert.equal(chooseDevCertificate([{ ...valid, notAfter: '2026-05-01T00:00:00.000Z' }], now), null);
  assert.equal(chooseDevCertificate([{ ...valid, subject: 'CN=Other' }], now), null);
  assert.equal(chooseDevCertificate([{ ...valid, codeSigning: false }], now), null);
  assert.equal(chooseDevCertificate([{ ...valid, hasPrivateKey: false }], now), null);
  assert.equal(chooseDevCertificate([{ ...valid, notAfter: 'not-a-date' }], now), null);
  assert.equal(chooseDevCertificate([{ ...valid, thumbprint: 'abcd' }], now), null);
  assert.equal(chooseDevCertificate([valid], now), valid);

  const sooner = {
    ...valid,
    thumbprint: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    notAfter: '2026-12-01T00:00:00.000Z',
  };
  const later = {
    ...valid,
    thumbprint: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    notAfter: '2027-12-01T00:00:00.000Z',
  };
  assert.equal(chooseDevCertificate([sooner, later, { ...valid, hasPrivateKey: false }], now), later);

  const low = { ...valid, thumbprint: '1111111111111111111111111111111111111111' };
  const high = { ...valid, thumbprint: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF' };
  assert.equal(chooseDevCertificate([low, high], now), high);

  const directory = path.join('dist', 'msix');
  assert.deepEqual(stalePackagePaths(directory), [
    path.join(directory, MSIX_PACKAGE_FILE),
    path.join(directory, MSIX_CERTIFICATE_FILE),
    path.join(directory, DEV_CERT_INF_FILE),
  ]);
});

test('CI builds the dev MSIX, checks fuses, and uploads the package and certificate', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['package:msix'], 'node scripts/package-msix.mjs');
  assert.equal(packageJson.scripts['check:fuses'], 'node scripts/check-fuses.mjs');
  assert.match(workflow, /name: Dev MSIX/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.equal((workflow.match(/npm run package:msix/g) ?? []).length, 2);
  assert.match(workflow, /OBELISK_DEV_CERT_THUMBPRINT/);
  assert.match(workflow, /thumbprints differ/);
  assert.match(workflow, /Dev certificate: reused/);
  assert.match(workflow, new RegExp(`check:fuses -- dist/msix/${MSIX_PACKAGE_FILE}`));
  assert.match(workflow, new RegExp(MSIX_CERTIFICATE_FILE));
  assert.match(workflow, /upload-artifact@v4/);
  assert.match(workflow, /smoke-msix\.ps1/);

  const smoke = await readFile(path.join(root, 'scripts/smoke-msix.ps1'), 'utf8');
  const packageScript = await readFile(path.join(root, 'scripts/package-msix.mjs'), 'utf8');
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(smoke, new RegExp(SMOKE_MARKER_FILE.replace('.', '\\.')));
  assert.match(smoke, /Add-AppxPackage/);
  assert.match(smoke, /Remove-AppxPackage/);
  assert.match(smoke, /Import-PublicCert \$Certificate 'TrustedPeople' 'LocalMachine'/);
  assert.match(smoke, /Cert:\\LocalMachine\\TrustedPeople/);
  assert.match(smoke, /Start-menu app id is Obelisk/);
  assert.equal(smoke.includes('CurrentUser\\Root'), false);
  assert.match(readme, /Cert:\\LocalMachine\\TrustedPeople/);
  assert.match(readme, /!Obelisk/);
  assert.equal(readme.includes('CurrentUser\\Root'), false);
  assert.match(packageScript, /Cert:\\\\LocalMachine\\\\TrustedPeople/);
  assert.match(packageScript, /Start-menu app id is Obelisk/);
  assert.match(smoke, /leftover dev certificate/);
  assert.match(smoke, /X509Store/);
  assert.match(smoke, /Get-InstallStamp/);
  assert.match(packageScript, /flipRequiredFusesOff/);
  assert.match(packageScript, /RunAsNode|flipRequiredFusesOff/);
  assert.match(packageScript, /makeappx/);
  assert.match(packageScript, /signtool/);
  assert.match(packageScript, /certreq\.exe/);
  assert.match(packageScript, /RequestType = Cert/);
  assert.match(packageScript, /MachineKeySet = FALSE/);
  assert.match(packageScript, /X509Store\('My', 'CurrentUser'\)/);
  assert.match(packageScript, /chooseDevCertificate/);
  assert.match(packageScript, /clearStalePackageOutputs/);
  assert.match(packageScript, /Dev certificate: reused/);
  assert.match(packageScript, /Dev certificate thumbprint:/);
  assert.equal(packageScript.includes('/sm'), false);
  assert.equal(packageScript.includes('removeDevCertificate'), false);
  const clearAt = packageScript.indexOf('await clearStalePackageOutputs(outputDir)');
  const buildAt = packageScript.indexOf("path.join(root, 'scripts', 'build.mjs')");
  assert.equal(clearAt !== -1 && clearAt < buildAt, true);
  assert.equal(packageScript.includes('.pfx'), false);
  assert.equal(packageScript.includes('New-SelfSignedCertificate'), false);
});
