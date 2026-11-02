import { writeFileSync } from 'node:fs';
import { writeAtomic } from '../../../dist/main/file/writeAtomic.js';

const target = process.argv[2];
const readyFile = process.argv[3];
const doneFile = process.argv[4];
const length = Number(process.argv[5]);
const fill = Number(process.argv[6]);

const bytes = Buffer.alloc(length, fill);
writeFileSync(readyFile, 'ready');
try {
  const result = await writeAtomic(target, bytes);
  writeFileSync(doneFile, JSON.stringify(result));
} catch (error) {
  writeFileSync(doneFile, JSON.stringify({ status: 'thrown', message: String(error) }));
  process.exitCode = 1;
}
