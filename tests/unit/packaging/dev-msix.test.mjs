import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SMOKE_MARKER_FILE } from '../../../dist/main/security/app-data.js';
import {
  APP_ICON_PNG,
  APP_ICON_RELATIVE,
  APP_ICON_SIZES,
  applicationAttributes,
  assertDevManifest,
  assertNoDevPackageFiles,
  assertPriDumpMatchesManifest,
  buildResourceIndex,
  chooseDevCertificate,
  dumpResourceIndex,
  DEV_CERT_INF_FILE,
  DEV_PACKAGE_FILES,
  devFilesInDirectory,
  identityAttributes,
  ignoredByPackager,
  MSIX_APP_ID,
  MSIX_ASSETS,
  MSIX_CERTIFICATE_FILE,
  MSIX_PACKAGE_ASSETS,
  MSIX_PACKAGE_FILE,
  MSIX_PUBLISHER,
  manifestAssetPaths,
  PRI_CONFIG_FILE,
  PRI_INDEX_EXCLUDES,
  PRI_RESOURCE_FILE,
  preparePriConfigText,
  priResourceUri,
  resourceIndexPlan,
  stalePackagePaths,
  toAppxVersion,
  withAppxVersion,
} from '../../../scripts/msix-plan.mjs';
import { findKitTools, windowsKitRoots } from '../../../scripts/windows-kit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function pngSize(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function icoFrames(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4);
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 16;
    const width = buffer.readUInt8(at) || 256;
    const height = buffer.readUInt8(at + 1) || 256;
    assert.equal(width, height, `ico ${width}x${height}`);
    assert.equal(buffer.readUInt16LE(at + 4), 1);
    assert.equal(buffer.readUInt16LE(at + 6), 32);
    const bytes = buffer.readUInt32LE(at + 8);
    const offset = buffer.readUInt32LE(at + 12);
    const image = buffer.subarray(offset, offset + bytes);
    const png = image.length >= 8 && image.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    if (width >= 256) {
      assert.equal(png, true, `ico ${width} is not PNG`);
      assert.deepEqual(pngSize(image), { width, height });
    } else {
      assert.equal(png, false, `ico ${width} is PNG; sizes below 256 must be BMP`);
      assert.equal(image.readUInt32LE(0), 40, `ico ${width} header`);
      assert.equal(image.readInt32LE(4), width);
      assert.equal(image.readInt32LE(8), width * 2);
      assert.equal(image.readUInt16LE(12), 1);
      assert.equal(image.readUInt16LE(14), 32);
      assert.equal(image.readUInt32LE(16), 0, `ico ${width} is compressed`);
      const pixels = width * width * 4;
      assert.equal(image.length >= 40 + pixels, true, `ico ${width} bitmap`);
    }
    frames.push({ width, image, png });
  }
  return frames;
}

function icoSizes(buffer) {
  return icoFrames(buffer).map((frame) => frame.width);
}

function dibPixel(image, size, x, y) {
  const row = size - 1 - y;
  const at = 40 + (row * size + x) * 4;
  return [image.readUInt8(at + 2), image.readUInt8(at + 1), image.readUInt8(at), image.readUInt8(at + 3)];
}

function near(actual, expected) {
  return actual.every((channel, index) => Math.abs(channel - expected[index]) <= 8);
}

function priConfigPath(args) {
  return args[args.indexOf('/cf') + 1];
}

const SAMPLE_PRI_CONFIG = [
  '<resources>',
  '<packaging><autoResourcePackage qualifier="Scale"/></packaging>',
  '<index root="\\" startIndexAt="\\"></index>',
  '</resources>',
].join('');

function runTool(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited ${result.status ?? 1}.`);
  }
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
  for (const asset of assets) {
    assert.equal(/\.(?:scale|targetsize)-|altform/.test(asset), false, asset);
  }
  assert.match(xml, /<uap:Logo>assets\\Square44x44Logo\.png<\/uap:Logo>/);
  assert.match(xml, /BackgroundColor="transparent"/);
  for (const [relative, size] of Object.entries(MSIX_ASSETS)) {
    const file = path.join(root, 'packaging', 'msix', ...relative.split('\\'));
    const image = await readFile(file);
    assert.deepEqual(pngSize(image), size, relative);
  }
});

test('qualified icon names and the exe icon match their pixel sizes', async () => {
  const directory = path.join(root, 'packaging', 'msix', 'assets');
  const names = (await readdir(directory)).sort();
  const expected = Object.keys(MSIX_PACKAGE_ASSETS)
    .map((relative) => relative.slice(relative.lastIndexOf('\\') + 1))
    .sort();
  assert.deepEqual(names, expected);
  const platedTarget = names.filter((name) => /^Square44x44Logo\.targetsize-\d+\.png$/.test(name));
  assert.deepEqual(platedTarget, []);
  for (const [relative, size] of Object.entries(MSIX_PACKAGE_ASSETS)) {
    const image = await readFile(path.join(root, 'packaging', 'msix', ...relative.split('\\')));
    assert.deepEqual(pngSize(image), size, relative);
    assert.equal(Object.hasOwn(MSIX_ASSETS, relative) || /\.(?:scale|targetsize)-/.test(relative), true, relative);
  }

  const ico = await readFile(path.join(root, APP_ICON_RELATIVE));
  assert.deepEqual(icoSizes(ico), APP_ICON_SIZES);
  const frames = icoFrames(ico);
  const small = frames.find((frame) => frame.width === 16);
  assert.ok(small);
  assert.equal(dibPixel(small.image, 16, 0, 0)[3], 0);
  assert.equal(near(dibPixel(small.image, 16, 4, 6), [59, 70, 84, 255]), true);
  assert.equal(near(dibPixel(small.image, 16, 8, 6), [230, 234, 240, 255]), true);
  const preview = await readFile(path.join(root, APP_ICON_PNG));
  assert.deepEqual(pngSize(preview), { width: 256, height: 256 });
  assert.equal(existsSync(path.join(root, 'packaging', 'icons', 'taskbar-dark.ico')), false);
  assert.equal(existsSync(path.join(root, 'packaging', 'icons', 'taskbar-light.ico')), false);
  for (const name of names) {
    if (!name.endsWith('_altform-unplated.png')) {
      continue;
    }
    const sibling = name.replace('_altform-unplated.png', '_altform-lightunplated.png');
    const unplated = await readFile(path.join(directory, name));
    const lightUnplated = await readFile(path.join(directory, sibling));
    assert.deepEqual(unplated, lightUnplated, name);
  }
  const indexSource = await readFile(path.join(root, 'src', 'main', 'index.ts'), 'utf8');
  assert.match(indexSource, /icon: windowIcon/);
  assert.equal(indexSource.includes('setIcon'), false);
  assert.equal(indexSource.includes('nativeTheme.themeSource'), false);
  assert.match(indexSource, /nativeTheme\.shouldUseDarkColors/);
  assert.equal(indexSource.includes('nativeImage'), false);
  assert.equal(indexSource.includes('SystemUsesLightTheme'), false);
  assert.equal(indexSource.includes('taskbar-icon'), false);
});

test('makepri indexes the layout and priconfig.xml is removed', async () => {
  const layout = path.join('dist', 'msix', 'layout');
  const plan = resourceIndexPlan(layout);
  assert.deepEqual(plan.createConfig, [
    'createconfig',
    '/cf',
    path.join(layout, PRI_CONFIG_FILE),
    '/dq',
    'en-US',
    '/pv',
    '10.0.0',
    '/o',
  ]);
  assert.deepEqual(plan.createIndex, [
    'new',
    '/pr',
    layout,
    '/cf',
    path.join(layout, PRI_CONFIG_FILE),
    '/mn',
    path.join(layout, 'AppxManifest.xml'),
    '/of',
    path.join(layout, PRI_RESOURCE_FILE),
    '/o',
  ]);
  assert.equal(plan.createIndex[plan.createIndex.indexOf('/pr') + 1], layout);
  assert.equal(plan.createIndex.includes(path.join(layout, 'assets')), false);

  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-pri-'));
  const calls = [];
  try {
    await assert.rejects(
      () =>
        buildResourceIndex('makepri.exe', directory, (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === 'createconfig') {
            writeFileSync(priConfigPath(args), SAMPLE_PRI_CONFIG);
            return;
          }
          const prepared = readFileSync(priConfigPath(args), 'utf8');
          assert.match(prepared, /startIndexAt="\\"/);
          assert.equal(prepared.includes('startIndexAt="assets"'), false);
          assert.equal(prepared.includes('<packaging>'), false);
          assert.equal(prepared.includes('autoResourcePackage'), false);
          assert.match(prepared, /foldernameAsQualifier="true"/);
          assert.match(prepared, /filenameAsQualifier="true"/);
          for (const [kind, value] of PRI_INDEX_EXCLUDES) {
            assert.match(prepared, new RegExp(`type="${kind}" value="${value.replace('.', '\\.')}"`));
          }
          throw new Error('makepri new failed');
        }),
      /makepri new failed/,
    );
    assert.equal(existsSync(path.join(directory, PRI_CONFIG_FILE)), false);
    const failedPlan = resourceIndexPlan(directory);
    assert.deepEqual(calls[0], ['makepri.exe', ...failedPlan.createConfig]);
    assert.deepEqual(calls[1], ['makepri.exe', ...failedPlan.createIndex]);

    await buildResourceIndex('makepri.exe', directory, (command, args) => {
      if (args[0] === 'createconfig') {
        writeFileSync(priConfigPath(args), SAMPLE_PRI_CONFIG);
        return;
      }
      writeFileSync(path.join(directory, PRI_RESOURCE_FILE), 'pri');
    });
    assert.equal(existsSync(path.join(directory, PRI_CONFIG_FILE)), false);
    assert.equal(await readFile(path.join(directory, PRI_RESOURCE_FILE), 'utf8'), 'pri');

    await assert.rejects(
      () =>
        buildResourceIndex('makepri.exe', directory, (command, args) => {
          if (args[0] === 'createconfig') {
            const encoded = Buffer.concat([
              Buffer.from([0xff, 0xfe]),
              Buffer.from(SAMPLE_PRI_CONFIG, 'utf16le'),
            ]);
            writeFileSync(priConfigPath(args), encoded);
            return;
          }
          const prepared = readFileSync(priConfigPath(args));
          assert.equal(prepared[0], 0xff);
          assert.equal(prepared[1], 0xfe);
          assert.match(prepared.toString('utf16le', 2), /startIndexAt="\\"/);
          assert.equal(prepared.toString('utf16le', 2).includes('startIndexAt="assets"'), false);
          throw new Error('utf16 makepri new failed');
        }),
      /utf16 makepri new failed/,
    );
    assert.equal(existsSync(path.join(directory, PRI_CONFIG_FILE)), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pri resource names follow the manifest logo paths', async () => {
  const xml = await readFile(path.join(root, 'packaging/msix/AppxManifest.xml'), 'utf8');
  const paths = manifestAssetPaths(xml);
  assert.equal(priResourceUri('assets\\Square44x44Logo.png'), 'Files/assets/Square44x44Logo.png');
  const blocks = paths.map((asset) => {
    const uri = `ms-resource://Obelisk.Dev/${priResourceUri(asset)}`;
    const file = asset.slice(asset.lastIndexOf('\\') + 1);
    const extra = asset.endsWith('Square44x44Logo.png')
      ? '<Candidate qualifiers="TargetSize-24, AlternateForm-UNPLATED" type="Path"></Candidate><Candidate qualifiers="TargetSize-24, AlternateForm-LIGHTUNPLATED" type="Path"></Candidate>'
      : '<Candidate type="Path"></Candidate>';
    return `<NamedResource name="${file}" uri="${uri}">${extra}</NamedResource>`;
  });
  const good = blocks.join('');
  assertPriDumpMatchesManifest(good, xml);

  const bare = good.replace(
    'uri="ms-resource://Obelisk.Dev/Files/assets/Square44x44Logo.png"',
    'uri="ms-resource://Obelisk.Dev/Files/Square44x44Logo.png"',
  );
  assert.throws(() => assertPriDumpMatchesManifest(bare, xml), /without the assets folder/);

  const noUnplated = good.replace('AlternateForm-UNPLATED', 'AlternateForm-OTHER');
  assert.throws(() => assertPriDumpMatchesManifest(noUnplated, xml), /altform-unplated/);

  const noLight = good.replace('LIGHTUNPLATED', 'OTHER');
  assert.throws(() => assertPriDumpMatchesManifest(noLight, xml), /lightunplated/);

  const missingTile = good.replace('Files/assets/Square150x150Logo.png', 'Files/Square150x150Logo.png');
  assert.throws(() => assertPriDumpMatchesManifest(missingTile, xml), /Square150x150Logo/);

  const rooted = preparePriConfigText(
    '<resources><index root="\\" startIndexAt="assets"><indexer-config type="folder" foldernameAsQualifier="true" filenameAsQualifier="true" qualifierDelimiter="."/></index></resources>',
  );
  assert.match(rooted, /startIndexAt="\\"/);
  assert.equal(rooted.includes('startIndexAt="assets"'), false);
  assert.match(rooted, /<indexer-config\b[^>]*type="folder"[^>]*>/);
  assert.match(rooted, /value="locales"/);
  assert.equal(rooted.includes('<indexer-config type="folder"'), true);
  assert.equal((rooted.match(/<indexer-config\b/g) ?? []).length, 1);

  const open = preparePriConfigText(
    '<index root="\\" startIndexAt="\\"><indexer-config type="folder" foldernameAsQualifier="true" filenameAsQualifier="true" qualifierDelimiter="."><exclude type="extension" value=".pri" doNotTraverse="true" doNotIndex="true"/></indexer-config></index>',
  );
  assert.match(open, /value="resources"/);
  assert.match(open, /value="\.pri"/);
  assert.equal((open.match(/type="folder"/g) ?? []).length, 1);
  assert.throws(() => preparePriConfigText('<index></index>'), /startIndexAt/);
});

test('makepri writes resources.pri for the icon set when the Windows SDK is installed', async () => {
  const tools = findKitTools(windowsKitRoots());
  if (!tools.makepri) {
    assert.equal(process.platform === 'win32' && process.env.CI === 'true', false);
    return;
  }

  const layout = await mkdtemp(path.join(tmpdir(), 'obelisk-makepri-'));
  try {
    const manifestPath = path.join(layout, 'AppxManifest.xml');
    await cp(path.join(root, 'packaging', 'msix', 'AppxManifest.xml'), manifestPath);
    await cp(path.join(root, 'packaging', 'msix', 'assets'), path.join(layout, 'assets'), { recursive: true });
    await mkdir(path.join(layout, 'locales'), { recursive: true });
    await writeFile(path.join(layout, 'locales', 'en-US.pak'), 'pak');
    await writeFile(path.join(layout, 'Obelisk.exe'), 'MZ');
    await mkdir(path.join(layout, 'resources'), { recursive: true });
    await writeFile(path.join(layout, 'resources', 'obelisk.ico'), 'ico');
    await writeFile(path.join(layout, 'LICENSE'), 'license');
    const plan = resourceIndexPlan(layout);
    console.log(`makepri ${JSON.stringify([tools.makepri, ...plan.createIndex])}`);
    await buildResourceIndex(tools.makepri, layout, runTool);
    const pri = await readFile(path.join(layout, PRI_RESOURCE_FILE));
    assert.equal(pri.length > 0, true);
    const dump = await dumpResourceIndex(tools.makepri, layout, runTool);
    assertPriDumpMatchesManifest(dump, await readFile(manifestPath, 'utf8'));
    assert.match(dump, /scale-?200/i);
    assert.match(dump, /targetsize-?16/i);
    assert.equal(/<NamedResource\b[^>]*(?:en-US\.pak|Obelisk\.exe|obelisk\.ico|LICENSE)/.test(dump), false);
    assert.equal(dump.toLowerCase().includes('priconfig.xml'), false);
    await assert.rejects(() => stat(path.join(layout, PRI_CONFIG_FILE)));
    await assert.rejects(() => stat(path.join(layout, 'resources.pri.xml')));
  } finally {
    await rm(layout, { recursive: true, force: true });
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
  assert.match(packageScript, /makepri\.exe/);
  assert.match(packageScript, /signtool/);
  assert.match(packageScript, /path\.join\(root, APP_ICON_RELATIVE\)/);
  assert.match(packageScript, /icon: iconPath/);
  assert.match(packageScript, /extraResource: \[iconPath\]/);
  assert.equal(packageScript.includes('taskbar-dark.ico'), false);
  assert.equal(packageScript.includes('taskbar-light.ico'), false);
  const indexCall = packageScript.indexOf('await buildResourceIndex(tools.makepri, layout, run)');
  const packCall = packageScript.indexOf("run(tools.makeappx, ['pack', '/d', layout, '/p', msixPath, '/o'])");
  assert.equal(indexCall !== -1 && packCall !== -1 && indexCall < packCall, true);
  assert.match(readme, /makepri\.exe/);
  assert.match(readme, /resources\.pri/);
  assert.match(readme, /obelisk\.ico/);
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
