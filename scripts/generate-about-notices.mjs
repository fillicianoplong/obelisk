import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'resources', 'licenses', 'manifest.json'), 'utf8'));

const lines = [
  'export interface AboutNotice {',
  '  readonly id: string;',
  '  readonly name: string;',
  '  readonly summary: string;',
  '  readonly licenseId: string;',
  '  readonly noticePath: string;',
  '  readonly fullTextPath?: string;',
  '  readonly sourceUrl?: string;',
  '}',
  '',
  '/** Generated from resources/licenses/manifest.json. Do not edit by hand. */',
  'export const ABOUT_NOTICES: readonly AboutNotice[] = [',
];

for (const component of manifest.components) {
  const fields = [
    `    id: '${component.id}',`,
    `    name: ${JSON.stringify(component.name)},`,
    `    summary: ${JSON.stringify(component.summary ?? '')},`,
    `    licenseId: '${component.licenseId}',`,
    `    noticePath: '/licenses/${component.noticeFile}',`,
  ];
  if (component.fullTextFile !== undefined) {
    fields.push(`    fullTextPath: '/licenses/${component.fullTextFile}',`);
  }
  if (component.sourceUrl !== undefined) {
    fields.push(`    sourceUrl: ${JSON.stringify(component.sourceUrl)},`);
  }
  lines.push('  {', ...fields, '  },');
}

lines.push('];', '');
writeFileSync(path.join(root, 'src', 'renderer', 'shell', 'about', 'notices.ts'), lines.join('\n'));
console.log(`Wrote about notices (${manifest.components.length} components)`);