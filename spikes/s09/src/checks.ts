import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { ALT_DESCRIPTION, CONTROLS, LINK_URL, SURROGATES } from './documents';
import { FORMULA_SAMPLES, wrapperRootKey } from './omml';
import { xmlWellFormed } from './xml-check';

export interface PartCheck {
  part: string;
  ok: boolean;
  reason: string;
  python: string;
}

export interface FileCheck {
  name: string;
  parts: PartCheck[];
  notes: string[];
}

function pythonParse(xml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's09-xml-'));
  const file = path.join(dir, 'part.xml');
  try {
    fs.writeFileSync(file, xml);
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const script = 'import sys, xml.etree.ElementTree as ET\ntry:\n ET.parse(sys.argv[1])\n print("ok")\nexcept Exception as exc:\n print(type(exc).__name__ + ": " + str(exc))\n';
    const run = spawnSync(py, ['-c', script, file], { encoding: 'utf8' });
    if (run.error) {
      return `not run: ${run.error.message}`;
    }
    return (run.stdout || run.stderr || `exit ${run.status}`).trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function partsOf(bytes: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, string>();
  const names = Object.keys(zip.files).filter((name) => name.endsWith('.xml') || name.endsWith('.rels'));
  for (const name of names) {
    const file = zip.file(name);
    if (file) {
      out.set(name, await file.async('string'));
    }
  }
  return out;
}

export async function checkFile(name: string, bytes: Buffer): Promise<FileCheck> {
  const parts = await partsOf(bytes);
  const checked: PartCheck[] = [];
  for (const [part, xml] of parts) {
    const result = xmlWellFormed(xml);
    checked.push({ part, ok: result.ok, reason: result.reason, python: pythonParse(xml) });
  }
  const document = parts.get('word/document.xml') ?? '';
  const notes: string[] = [];
  if (!document.includes('w:w="12240"') || !document.includes('w:h="15840"')) {
    notes.push('page size is not Letter 12240 by 15840');
  }
  if (!document.includes('w:top="1440"') || !document.includes('w:left="1440"')) {
    notes.push('margins are not 1 inch');
  }
  notes.push(...expect(name, document, parts));
  return { name, parts: checked, notes };
}

function expect(name: string, document: string, parts: Map<string, string>): string[] {
  const notes: string[] = [];
  const rels = [...parts.entries()].filter(([part]) => part.endsWith('.rels')).map(([, xml]) => xml).join('\n');
  if (name === 'export-reference.docx') {
    for (const token of ['Heading1', 'Heading2', 'Heading3', 'Quote', 'Consolas', 'Calibri', 'March 4, 2027', 'w:pageBreakBefore', 'm:oMath', 'w:drawing', 'mailto:s09@example.invalid', 'Segoe UI Symbol', 'w14:checkbox']) {
      if (!document.includes(token) && !parts.get('word/styles.xml')?.includes(token) && !rels.includes(token)) {
        notes.push(`missing ${token}`);
      }
    }
    if (document.includes('w:w="6240"')) {
      notes.push('a table is still 6240 twips wide');
    }
    const tableWidths = document.match(/w:tblW[^>]*w:w="(\d+)"/g) ?? [];
    if (!tableWidths.every((width) => width.includes('9360'))) {
      notes.push(`table widths are not all 9360: ${tableWidths.join(', ')}`);
    }
    if (!document.includes('w:val="nil"')) {
      notes.push('column row has no nil border');
    }
    for (const alt of ['Photograph sample', 'Flattened drawing', 'First frame of an animation', 'Drawing sample', 'Signature sample', 'Diagram sample']) {
      if (!document.includes(`descr="${alt}"`)) {
        notes.push(`missing alt text ${alt}`);
      }
    }
  }
  if (name === 'equations-on.docx') {
    const count = document.split('<m:oMath').length - 1;
    if (count !== FORMULA_SAMPLES.length) {
      notes.push(`expected ${FORMULA_SAMPLES.length} equations, found ${count}`);
    }
    if (document.includes('<undefined')) {
      notes.push('equations-on still contains an undefined element');
    }
    if (document.includes('<w:drawing')) {
      notes.push('equations-on contains a drawing');
    }
    for (const token of ['m:f', 'm:rad', 'm:nary', 'm:m', 'm:acc']) {
      if (!document.includes(`<${token}`)) {
        notes.push(`missing ${token}`);
      }
    }
  }
  if (name === 'equations-off.docx') {
    if (document.includes('<m:oMath')) {
      notes.push('equations-off contains OMML');
    }
    const drawings = document.split('<w:drawing').length - 1;
    if (drawings !== FORMULA_SAMPLES.length) {
      notes.push(`expected ${FORMULA_SAMPLES.length} images, found ${drawings}`);
    }
  }
  if (name === 'equations-raw-wrapper.docx') {
    if (!document.includes('<undefined')) {
      notes.push('raw wrapper file does not contain an undefined element');
    }
    const key = wrapperRootKey(FORMULA_SAMPLES[0].omml);
    if (key !== undefined) {
      notes.push(`fromXmlString rootKey is ${String(key)}, expected undefined`);
    }
  }
  if (name === 'alt-text.docx') {
    if (!document.includes(`descr="${ALT_DESCRIPTION}"`)) {
      notes.push('docPr descr does not contain the FR-52 alt text');
    }
  }
  if (name === 'hostile-text.docx') {
    notes.push(...hostileNotes(document, rels));
  }
  if (name === 'fifty-pages.docx') {
    const breaks = document.split('w:type="page"').length - 1;
    if (breaks !== 49) {
      notes.push(`expected 49 page breaks, found ${breaks}`);
    }
  }
  return notes;
}

function hostileNotes(document: string, rels: string): string[] {
  const notes: string[] = [];
  if (!document.includes('&lt;') || !document.includes('&amp;') || !document.includes(']]&gt;')) {
    notes.push('markup was not escaped as &lt; &amp; and ]]&gt;');
  }
  if (document.includes(']]>')) {
    notes.push('a raw ]]> survived in the part');
  }
  const illegal = [...CONTROLS].filter((ch) => {
    const code = ch.charCodeAt(0);
    return code !== 9 && code !== 10 && code !== 13;
  });
  const present = illegal.filter((ch) => document.includes(ch));
  if (present.length !== illegal.length) {
    notes.push(`control characters kept: ${present.length} of ${illegal.length}`);
  } else {
    notes.push(`control characters were written through (${present.length}), so the part is not well-formed XML`);
  }
  if (!document.includes('\uFFFD')) {
    notes.push('unpaired surrogates were not replaced with U+FFFD');
  } else {
    notes.push('unpaired surrogates were replaced with U+FFFD');
  }
  if (document.includes(SURROGATES)) {
    notes.push('the original unpaired surrogate string is still in the XML');
  }
  const targets = [...rels.matchAll(/Target="([^"]*)"/g)].map((match) => match[1]);
  const links = targets.filter((target) => target.startsWith('http') || target.startsWith('mailto:'));
  if (!links.includes(LINK_URL)) {
    notes.push('link target is missing from the relationships');
  }
  if (links.some((target) => target !== LINK_URL)) {
    notes.push(`hyperlink target is not the fixed address: ${links.join(', ')}`);
  }
  const descr = document.match(/descr="[^"]*"/g) ?? [];
  if (!descr.some((value) => value.includes('&lt;') && value.includes('ALT'))) {
    notes.push('alt text descr does not contain the escaped markup');
  }
  return notes;
}

const LIBREOFFICE_SECONDS = 45;

export function libreOffice(docxPath: string, outDir: string): { found: boolean; command: string; ok: boolean; detail: string } {
  const command = findSoffice();
  if (!command) {
    return { found: false, command: '', ok: false, detail: 'soffice is not on PATH' };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 's09-lo-'));
  const args = [
    '--headless',
    '--norestore',
    '--nolockcheck',
    '--nologo',
    '--nofirststartwizard',
    `-env:UserInstallation=file://${profile}`,
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    docxPath,
  ];
  const env = { ...process.env, SAL_USE_VCLPLUGIN: 'svp' };
  const useTimeout = process.platform !== 'win32';
  const run = spawnSync(
    useTimeout ? 'timeout' : command,
    useTimeout ? ['-k', '5', String(LIBREOFFICE_SECONDS), command, ...args] : args,
    { encoding: 'utf8', timeout: (LIBREOFFICE_SECONDS + 15) * 1000, killSignal: 'SIGKILL', env },
  );
  const pdf = path.join(outDir, `${path.basename(docxPath, '.docx')}.pdf`);
  const errorCode = run.error && 'code' in run.error ? String(run.error.code) : '';
  const timedOut = errorCode === 'ETIMEDOUT' || run.status === 124;
  const ok = !timedOut && run.status === 0 && fs.existsSync(pdf) && fs.statSync(pdf).size > 0;
  const detail = timedOut
    ? `timed out after ${LIBREOFFICE_SECONDS}s`
    : [run.stdout, run.stderr, run.error?.message].filter(Boolean).join('\n').trim() || `exit ${run.status}`;
  fs.rmSync(profile, { recursive: true, force: true });
  return { found: true, command, ok, detail };
}

function findSoffice(): string | null {
  const names = process.platform === 'win32' ? ['soffice.com', 'soffice.exe', 'soffice'] : ['soffice', 'libreoffice'];
  for (const name of names) {
    const run = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    const found = run.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
    if (run.status === 0 && found) {
      return found;
    }
  }
  return null;
}
