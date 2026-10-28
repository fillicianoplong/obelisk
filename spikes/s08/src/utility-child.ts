import fs from 'node:fs';
import { runChecks } from './checks';

function flag(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const result = await runChecks(flag('--samples'));
  await fs.promises.writeFile(flag('--report'), `${JSON.stringify(result, null, 2)}\n`);
  // The host keeps a pipe open for the life of the utility process, so the
  // event loop does not drain on its own once the report is on disk.
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
