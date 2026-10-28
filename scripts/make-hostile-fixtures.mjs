import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHostileFixtures, pendingText } from './make-hostile-fixtures/generate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.resolve(root, process.argv[2] ?? path.join('tests', 'fixtures', 'hostile'));
const { cases } = await generateHostileFixtures(directory, root);

for (const item of cases) {
  const state = item.pending.length > 0 ? pendingText(item.pending) : item.outcome;
  console.log(`${item.key}\t${state}\t${item.expected}`);
}
console.log(`${cases.length} fixtures in ${directory}`);
