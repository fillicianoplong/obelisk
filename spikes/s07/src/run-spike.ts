import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { manifestProblems, packageScriptProblems, readmeProblems, rendererProblems } from './checks';
import type { SpikeReport } from './report';

function electronBinary(repoRoot: string): string {
  const pathFile = path.join(repoRoot, 'node_modules', 'electron', 'path.txt');
  const relative = fs.readFileSync(pathFile, 'utf8').trim();
  const binary = path.join(repoRoot, 'node_modules', 'electron', 'dist', relative);
  if (!fs.existsSync(binary)) {
    throw new Error(`The Electron binary is missing at ${binary}. Run node node_modules/electron/install.js.`);
  }
  return binary;
}

function spawnElectron(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code });
    };
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      console.error(error.message);
      finish(1);
    });
    child.on('exit', (code) => finish(code ?? 1));
  });
}

function readReport(file: string): SpikeReport | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SpikeReport;
  } catch {
    return null;
  }
}

function assertText(label: string, problems: string[]): void {
  if (problems.length === 0) return;
  throw new Error(`${label}: ${problems.join('; ')}`);
}

function assertReports(output: string): void {
  const encrypt = readReport(path.join(output, 'report-encrypt.json'));
  const decrypt = readReport(path.join(output, 'report-decrypt.json'));
  if (!encrypt) throw new Error('Electron did not write report-encrypt.json.');
  if (!decrypt) throw new Error('Electron did not write report-decrypt.json.');
  if (encrypt.ok !== true) throw new Error(`encrypt report is not ok. ${encrypt.checks.filter((item) => !item.pass).map((item) => item.detail).join(' ')}`);
  if (decrypt.ok !== true) throw new Error(`decrypt report is not ok. ${decrypt.checks.filter((item) => !item.pass).map((item) => item.detail).join(' ')}`);
  if (encrypt.packaged !== false || decrypt.packaged !== false) throw new Error('The check run was packaged.');
  if (encrypt.electron.version !== encrypt.expectedElectron) {
    throw new Error(`Electron ${encrypt.electron.version} did not match ${encrypt.expectedElectron}.`);
  }
  const png = path.join(output, 'walkthrough.png');
  if (!fs.existsSync(png) || fs.statSync(png).size < 100) throw new Error('walkthrough.png is missing.');
  if (encrypt.sessionEncryption === true) {
    if (encrypt.plaintextMatch !== true) throw new Error('The encrypt launch did not match the plaintext.');
    if (encrypt.leaks.length > 0) throw new Error(`Ciphertext leaks ${encrypt.leaks.join(', ')}.`);
    if (decrypt.plaintextMatch !== true || decrypt.restart !== true) throw new Error('The restart decrypt did not match.');
    if (!fs.existsSync(path.join(output, 'cipher.bin'))) throw new Error('cipher.bin is missing.');
    console.log(`S07 unpackaged round trip passed. shouldReEncrypt=${String(decrypt.shouldReEncrypt)}`);
    return;
  }
  const reason = encrypt.encryptError || encrypt.decryptError;
  if (!reason) throw new Error('Encryption did not complete and the report has no error text.');
  console.log(`S07 session did not encrypt. ${reason}`);
}

function assertKeyOnDisk(report: SpikeReport): void {
  if (report.sessionEncryption !== true) return;
  const file = report.localState;
  if (!file) throw new Error('The encrypt report has no Local State path.');
  if (fs.existsSync(file)) return;
  let listing: string;
  try {
    listing = fs.readdirSync(path.dirname(file)).join(', ') || 'empty';
  } catch (error) {
    listing = error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Local State was not written at ${file}. Folder: ${listing}`);
}

async function launch(binary: string, phaseName: string, output: string, expected: string, cwd: string): Promise<void> {
  const env = {
    ...process.env,
    OBELISK_S07_PHASE: phaseName,
    OBELISK_S07_OUTPUT: output,
    OBELISK_S07_EXPECT_ELECTRON: expected,
  };
  const host = path.resolve(__dirname, 'host.js');
  const first = await spawnElectron(binary, [host], env, cwd, 4 * 60 * 1000);
  if (first.code !== 0) throw new Error(`The ${phaseName} launch exited ${first.code}.`);
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.error('S-07 runs on Windows. safeStorage DPAPI inside an MSIX package is a Windows question.');
    process.exitCode = 1;
    return;
  }
  const spikeRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(spikeRoot, '..', '..');
  const manifest = fs.readFileSync(path.join(spikeRoot, 'AppxManifest.xml'), 'utf8');
  const readme = fs.readFileSync(path.join(spikeRoot, 'README.md'), 'utf8');
  const renderer = fs.readFileSync(path.join(spikeRoot, 'src', 'renderer.ts'), 'utf8');
  const packager = fs.readFileSync(path.join(spikeRoot, 'package-msix.mjs'), 'utf8');
  assertText('manifest', manifestProblems(manifest));
  assertText('readme', readmeProblems(readme));
  assertText('renderer', rendererProblems(renderer));
  assertText('package script', packageScriptProblems(packager));
  for (const name of ['renderer.html', 'renderer.css']) {
    fs.copyFileSync(path.join(spikeRoot, 'src', name), path.join(spikeRoot, 'dist', name));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { devDependencies?: { electron?: string } };
  const expected = pkg.devDependencies?.electron;
  if (!expected) throw new Error('The app package.json has no electron devDependency.');
  const output = path.join(spikeRoot, 'output', 'check');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const binary = electronBinary(repoRoot);
  await launch(binary, 'encrypt', output, expected, repoRoot);
  const encrypt = readReport(path.join(output, 'report-encrypt.json'));
  if (!encrypt) throw new Error('Electron did not write report-encrypt.json.');
  assertKeyOnDisk(encrypt);
  await launch(binary, 'decrypt', output, expected, repoRoot);
  assertReports(output);
  console.log('S07 unpackaged check finished.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
