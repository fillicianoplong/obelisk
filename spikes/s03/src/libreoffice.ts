import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface LibreOfficeFile {
  file: string;
  fodt: string | null;
  fodtBytes: number;
  textsFound: string[];
  textsMissing: string[];
  starMath: string[];
}

export interface LibreOfficeResult {
  available: boolean;
  command: string | null;
  version: string | null;
  pass: boolean;
  skipped: boolean;
  error: string | null;
  files: LibreOfficeFile[];
}

export async function loadInLibreOffice(
  docxPaths: readonly { file: string; docxPath: string; texts: readonly string[] }[],
  outputDir: string,
): Promise<LibreOfficeResult> {
  const command = findSoffice();
  if (!command) {
    return {
      available: false,
      command: null,
      version: null,
      pass: true,
      skipped: true,
      error: null,
      files: [],
    };
  }
  const version = await sofficeVersion(command);
  const profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s03-lo-'));
  const fodtDir = path.join(outputDir, 'libreoffice');
  await fs.promises.mkdir(fodtDir, { recursive: true });
  try {
    const run = await runSoffice(command, profile, fodtDir, docxPaths.map((item) => item.docxPath));
    if (run.code !== 0) {
      return {
        available: true,
        command,
        version,
        pass: false,
        skipped: false,
        error: `soffice exited ${run.code}: ${trim(run.stderr || run.stdout)}`,
        files: [],
      };
    }
    const files: LibreOfficeFile[] = [];
    for (const item of docxPaths) {
      const fodtName = `${path.basename(item.file, '.docx')}.fodt`;
      const fodtPath = path.join(fodtDir, fodtName);
      if (!fs.existsSync(fodtPath)) {
        files.push({
          file: item.file,
          fodt: null,
          fodtBytes: 0,
          textsFound: [],
          textsMissing: [...item.texts],
          starMath: [],
        });
        continue;
      }
      const fodt = await fs.promises.readFile(fodtPath, 'utf8');
      const textsFound = item.texts.filter((text) => fodt.includes(text));
      const textsMissing = item.texts.filter((text) => !fodt.includes(text));
      files.push({
        file: item.file,
        fodt: fodtName,
        fodtBytes: Buffer.byteLength(fodt),
        textsFound,
        textsMissing,
        starMath: starMathFormulas(fodt),
      });
    }
    const missingOutput = files.some((file) => file.fodt === null || file.fodtBytes === 0);
    return {
      available: true,
      command,
      version,
      pass: !missingOutput,
      skipped: false,
      error: missingOutput ? 'LibreOffice did not write a Flat ODF file for every document' : null,
      files,
    };
  } finally {
    await fs.promises.rm(profile, { recursive: true, force: true });
  }
}

function findSoffice(): string | null {
  const candidates = [
    process.env.SOFFICE,
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files\\LibreOffice\\program\\soffice.com',
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      continue;
    }
    const located = lookUp(candidate);
    if (located) {
      return located;
    }
  }
  return null;
}

function lookUp(command: string): string | null {
  const pathValue = process.env.PATH ?? '';
  const parts = pathValue.split(path.delimiter);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of parts) {
    for (const extension of extensions) {
      const full = path.join(dir, command + extension);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  }
  return null;
}

function sofficeVersion(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      stopProcess(child);
      resolve(null);
    }, 30_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(output.trim() || null);
    });
  });
}

function runSoffice(
  command: string,
  profile: string,
  outDir: string,
  docxPaths: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const args = [
    '--headless',
    '--norestore',
    '--nolockcheck',
    '--nologo',
    '--nofirststartwizard',
    `-env:UserInstallation=${pathToFileURL(profile).href}`,
    '--convert-to',
    'fodt',
    '--outdir',
    outDir,
    ...docxPaths,
  ];
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      stopProcess(child);
    }, 120_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function stopProcess(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGKILL');
}

function starMathFormulas(fodt: string): string[] {
  const formulas: string[] = [];
  const marker = 'encoding="StarMath 5.0">';
  let from = 0;
  while (from < fodt.length) {
    const start = fodt.indexOf(marker, from);
    if (start < 0) {
      break;
    }
    const textStart = start + marker.length;
    const end = fodt.indexOf('</annotation>', textStart);
    if (end < 0) {
      break;
    }
    formulas.push(fodt.slice(textStart, end).replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    from = end + '</annotation>'.length;
  }
  return formulas;
}

function trim(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}…` : compact;
}
