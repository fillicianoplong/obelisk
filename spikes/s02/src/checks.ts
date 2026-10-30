import fs from 'node:fs';
import path from 'node:path';

export const PASS_RULE = "On a pass, keep the architecture's design.";
export const FAIL_RULE = 'On a fail, the fallback is to drop FR-18 or use the MSIX activation path the spike finds.';

const CASE_IDS = [
  'case-01-cold',
  'case-02-second',
  'case-03',
  'case-04',
  'case-05',
  'case-06',
  'case-07',
] as const;

export function manifestProblems(xml: string): string[] {
  const problems: string[] = [];
  if (!xml.includes('Name="Obelisk.SpikeS02"')) problems.push('identity is not Obelisk.SpikeS02');
  if (xml.includes('Name="Obelisk.Dev"')) problems.push('identity is Obelisk.Dev');
  if (!xml.includes('Category="windows.fileTypeAssociation"')) problems.push('no windows.fileTypeAssociation');
  if (!xml.includes('<uap:FileType>.s02obk</uap:FileType>')) problems.push('file type is not .s02obk');
  if (/<uap:FileType>\.obk<\/uap:FileType>/.test(xml)) problems.push('registers .obk');
  if (!xml.includes('Category="windows.appExecutionAlias"')) problems.push('no windows.appExecutionAlias');
  if (!xml.includes('Alias="ObeliskSpikeS02.exe"')) problems.push('alias is not ObeliskSpikeS02.exe');
  if (xml.includes('Alias="Obelisk.exe"')) problems.push('alias is Obelisk.exe');
  if (!xml.includes('Name="runFullTrust"')) problems.push('not full trust');
  return problems;
}

export function readmeProblems(text: string): string[] {
  const problems: string[] = [];
  if (!text.includes(PASS_RULE)) problems.push('missing the pass rule');
  if (!text.includes(FAIL_RULE)) problems.push('missing the fail rule');
  for (const id of CASE_IDS) {
    if (!text.includes(id)) problems.push(`missing ${id}`);
  }
  const manual = text.split('## Manual results')[1] ?? '';
  if (!manual) {
    problems.push('no manual results section');
    return problems;
  }
  if (!manual.includes('- [x] Pass')) problems.push('Pass box is not ticked');
  if (!manual.includes('- [ ] Fail')) problems.push('Fail box missing');
  if (manual.includes('- [x] Fail') || manual.includes('- [X] Fail')) problems.push('Fail is ticked');
  return problems;
}

export function rendererProblems(source: string): string[] {
  const pattern = /from\s+['"]electron['"]|from\s+['"]node:|require\s*\(\s*['"]electron['"]|require\s*\(\s*['"]node:/;
  if (pattern.test(source)) return ['The walkthrough page imports Node or Electron.'];
  return [];
}

export function readText(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

export function findExisting(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}
