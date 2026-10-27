import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { caseInfo } from './cases';
import type { RunMode } from './mode';
import {
  CLAIM_FILE,
  delay,
  FOLDER_NAME,
  GO_DOCUMENTS,
  GO_SECOND,
  PACKAGE_NAME,
  STOP_DOCUMENTS,
  STOP_SECOND,
  WATCH_CHILD_DOCUMENTS,
  WATCH_CHILD_SECOND,
  WATCH_OUTSIDE_DOCUMENTS,
  WATCH_OUTSIDE_SECOND,
  type CaseId,
} from './paths';
import {
  readOnlyFlag,
  readSummary,
  startHolder,
  startWatcher,
  summaryPass,
  waitExit,
  type WatchSummary,
} from './watch';
import {
  buildPayload,
  describePayload,
  FILL_A,
  FILL_B,
  markerText,
  REPLACE_COUNT,
  REPLACE_GAP_MS,
  sha256,
  writeAtomic,
  type WriteResult,
} from './write-atomic';

export interface PathSnapshot {
  userData: string;
  documents: string;
  desktop: string;
  appData: string;
  temp: string;
  exe: string;
  home: string;
  localAppData: string;
}

export interface CaseLog {
  id: CaseId;
  title: string;
  ran: boolean;
  pass: boolean | null;
  needsOutside: boolean;
  scope: 'packaged' | 'unpackaged';
  detail: string;
  path: string | null;
  sha256: string | null;
  bytes: number | null;
  errorCode: string | null;
  errorErrno: number | null;
  errorSyscall: string | null;
  errorMessage: string | null;
  targetUnchanged: boolean | null;
  tempLeft: boolean | null;
  attempts: number | null;
  replacedAfterRelease: boolean | null;
  watch: WatchSummary | null;
}

export interface ClaimFile {
  packageName: string;
  packaged: boolean;
  runId: string;
  paths: PathSnapshot;
  documentsFile: string | null;
  documentsSha256: string | null;
  secondFile: string | null;
  secondSha256: string | null;
  secondFolder: string | null;
  userDataFile: string | null;
  userDataSha256: string | null;
  roamingFile: string | null;
  roamingSha256: string | null;
  localFile: string | null;
  localSha256: string | null;
  renameDocuments: string | null;
  renameSecond: string | null;
}

export interface RunHooks {
  show(caseId: string, doing: string): Promise<void>;
  finish(log: CaseLog): Promise<void>;
}

export interface RunInput {
  mode: RunMode;
  packaged: boolean;
  outputDir: string;
  scriptDir: string;
  paths: PathSnapshot;
  secondFolder: string | null;
  hooks: RunHooks;
}

export interface RunOutput {
  cases: CaseLog[];
  claim: ClaimFile;
}

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function emptyWatch(): WatchSummary {
  return { samples: 0, seenA: 0, seenB: 0, missing: 0, partial: 0, locked: 0, error: null };
}

function baseLog(id: CaseId, scope: CaseLog['scope']): CaseLog {
  const info = caseInfo(id);
  return {
    id,
    title: info?.title ?? id,
    ran: false,
    pass: null,
    needsOutside: false,
    scope,
    detail: '',
    path: null,
    sha256: null,
    bytes: null,
    errorCode: null,
    errorErrno: null,
    errorSyscall: null,
    errorMessage: null,
    targetUnchanged: null,
    tempLeft: null,
    attempts: null,
    replacedAfterRelease: null,
    watch: null,
  };
}

function applyError(log: CaseLog, result: WriteResult): void {
  log.errorCode = result.code;
  log.errorErrno = result.errno;
  log.errorSyscall = result.syscall;
  log.errorMessage = result.message;
  log.tempLeft = result.tempLeft;
}

async function hashFile(file: string): Promise<string | null> {
  try {
    return sha256(await readFile(file));
  } catch {
    return null;
  }
}

const STRESS_ATTEMPTS = 12;

async function writeAtomicRetry(target: string, bytes: Buffer): Promise<{ result: WriteResult; attempts: number }> {
  let result = await writeAtomic(target, bytes);
  let attempts = 1;
  while (!result.ok && result.code && RETRY_CODES.has(result.code) && attempts < STRESS_ATTEMPTS) {
    await delay(40);
    attempts += 1;
    result = await writeAtomic(target, bytes);
  }
  return { result, attempts };
}

async function runRename(
  id: CaseId,
  dir: string,
  goFile: string,
  stopFile: string,
  summaryFile: string,
  input: RunInput,
  scope: CaseLog['scope'],
): Promise<CaseLog> {
  const log = baseLog(id, scope);
  log.ran = true;
  await input.hooks.show(id, 'Writing the first complete file, then replacing it from a temp file in the same folder.');
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, 'rename-target.bin');
  log.path = target;
  await rm(target, { force: true });
  await rm(goFile, { force: true });
  await rm(stopFile, { force: true });
  await rm(summaryFile, { force: true });
  const readyFile = `${summaryFile}.ready`;
  await rm(readyFile, { force: true });
  const created = await writeAtomic(target, buildPayload(0, FILL_A));
  if (!created.ok) {
    log.pass = false;
    applyError(log, created);
    log.detail = `The first write failed (${created.code ?? created.message}).`;
    return log;
  }
  const watcher = startWatcher(input.scriptDir, goFile, summaryFile);
  const goPartial = `${goFile}.partial`;
  await writeFile(goPartial, JSON.stringify({ target, stop: stopFile }));
  await rename(goPartial, goFile);
  const ready = await waitForFile(readyFile, 30000);
  if (!ready) {
    await writeFile(stopFile, 'stop').catch(() => undefined);
    const exitCode = await waitExit(watcher, 5000);
    const watch = readSummary(summaryFile) ?? {
      ...emptyWatch(),
      error: watcher.output().slice(-500) || `Watcher exited ${exitCode}.`,
    };
    log.watch = watch;
    log.pass = false;
    log.detail = `The watcher did not start. ${watch.error ?? `exit ${exitCode}`}`;
    return log;
  }
  if (input.packaged) {
    const outsideReady = path.join(
      input.outputDir,
      `${id === 'rename-replace-documents' ? WATCH_OUTSIDE_DOCUMENTS : WATCH_OUTSIDE_SECOND}.ready`,
    );
    await waitForFile(outsideReady, 5000);
  }
  await delay(400);
  let attempts = 1;
  let failed: WriteResult | null = null;
  let lastPayload = buildPayload(0, FILL_A);
  for (let index = 0; index < REPLACE_COUNT; index += 1) {
    const fill = index % 2 === 0 ? FILL_B : FILL_A;
    lastPayload = buildPayload(index + 1, fill);
    const wrote = await writeAtomicRetry(target, lastPayload);
    attempts = Math.max(attempts, wrote.attempts);
    if (!wrote.result.ok) {
      failed = wrote.result;
      break;
    }
    await delay(REPLACE_GAP_MS);
  }
  await writeFile(stopFile, 'stop');
  const exitCode = await waitExit(watcher, 20000);
  const watch = readSummary(summaryFile) ?? {
    ...emptyWatch(),
    error: exitCode === 0 ? 'The watcher wrote no summary.' : watcher.output().slice(-500) || `Watcher exited ${exitCode}.`,
  };
  log.watch = watch;
  log.attempts = attempts;
  const finalBytes = await readFile(target).catch(() => null);
  const finalOk = finalBytes ? describePayload(finalBytes).ok : false;
  const hashOk = finalBytes ? sha256(finalBytes) === sha256(lastPayload) : false;
  log.sha256 = finalBytes ? sha256(finalBytes) : null;
  log.bytes = finalBytes?.length ?? null;
  if (failed) applyError(log, failed);
  const watched = summaryPass(watch);
  log.pass = !failed && finalOk && hashOk && watched && log.tempLeft !== true;
  const retryNote = attempts > 1 ? ` A rename was retried (${attempts} attempts on the busiest replace).` : '';
  log.detail = log.pass
    ? `The target stayed a complete file across ${watch.samples} reads (${watch.seenA} of fill A, ${watch.seenB} of fill B, ${watch.locked} sharing errors).${retryNote}`
    : `Replace did not stay whole. missing=${watch.missing} partial=${watch.partial} seenA=${watch.seenA} seenB=${watch.seenB} samples=${watch.samples} final=${finalOk ? 'complete' : 'not complete'}${failed ? ` error=${failed.code ?? failed.message}` : ''}.${watch.error ? ` ${watch.error}` : ''}${retryNote}`;
  return log;
}

async function runReadOnly(dir: string, input: RunInput, scope: CaseLog['scope']): Promise<CaseLog> {
  const log = baseLog('rename-readonly', scope);
  log.ran = true;
  await input.hooks.show(log.id, 'Setting the read-only attribute, then renaming a temp file over that target.');
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, 'readonly-target.bin');
  log.path = target;
  const original = buildPayload(1, FILL_A);
  const created = await writeAtomic(target, original);
  if (!created.ok) {
    log.pass = false;
    applyError(log, created);
    log.detail = `Could not create the read-only target (${created.code ?? created.message}).`;
    return log;
  }
  const flagged = await readOnlyFlag(input.scriptDir, target, 'on');
  const seen = await readOnlyFlag(input.scriptDir, target, 'get');
  const before = await hashFile(target);
  const attempt = await writeAtomic(target, buildPayload(2, FILL_B));
  const after = await hashFile(target);
  log.targetUnchanged = before !== null && before === after;
  log.attempts = 1;
  applyError(log, attempt);
  await readOnlyFlag(input.scriptDir, target, 'off');
  let replacedAfter = false;
  if (!attempt.ok) {
    const retry = await writeAtomic(target, buildPayload(3, FILL_B));
    replacedAfter = retry.ok;
  }
  log.replacedAfterRelease = replacedAfter;
  const recorded = !attempt.ok && attempt.code !== null;
  log.pass = seen === 'yes' && recorded && log.targetUnchanged === true && attempt.tempLeft === false && replacedAfter;
  log.detail = log.pass
    ? `fs.rename failed with ${attempt.code} while the file was read-only. The old bytes stayed. After the attribute was cleared, the replace finished. ${attempt.message}`
    : `Read-only result was not the expected hold. attribute=${seen} set=${flagged} code=${attempt.code ?? 'none'} unchanged=${String(log.targetUnchanged)} tempLeft=${String(attempt.tempLeft)} afterClear=${String(replacedAfter)}. ${attempt.message}`;
  return log;
}

async function runOpen(dir: string, input: RunInput, scope: CaseLog['scope']): Promise<CaseLog> {
  const log = baseLog('rename-open', scope);
  log.ran = true;
  await input.hooks.show(log.id, 'Holding the target open without sharing delete, then renaming a temp file over it.');
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, 'open-target.bin');
  const held = path.join(dir, 'open-target.held');
  const release = path.join(dir, 'open-target.release');
  log.path = target;
  await rm(held, { force: true });
  await rm(release, { force: true });
  const original = buildPayload(1, FILL_A);
  const created = await writeAtomic(target, original);
  if (!created.ok) {
    log.pass = false;
    applyError(log, created);
    log.detail = `Could not create the open target (${created.code ?? created.message}).`;
    return log;
  }
  const holder = startHolder(input.scriptDir, target, held, release);
  const signaled = await waitForFile(held, 15000);
  const before = await hashFile(target);
  const attempt = await writeAtomic(target, buildPayload(2, FILL_B));
  const during = await hashFile(target);
  log.targetUnchanged = before !== null && before === during;
  log.attempts = 1;
  applyError(log, attempt);
  await writeFile(release, 'release');
  await waitExit(holder, 15000);
  let replacedAfter = false;
  if (!attempt.ok) {
    const retry = await writeAtomic(target, buildPayload(3, FILL_B));
    replacedAfter = retry.ok;
  }
  log.replacedAfterRelease = replacedAfter;
  const recorded = !attempt.ok && attempt.code !== null;
  log.pass = signaled && recorded && log.targetUnchanged === true && attempt.tempLeft === false && replacedAfter;
  log.detail = log.pass
    ? `fs.rename failed with ${attempt.code} while the file was open. The old bytes stayed. After the handle closed, the replace finished. ${attempt.message}`
    : `Open-file result was not the expected hold. held=${String(signaled)} code=${attempt.code ?? 'none'} unchanged=${String(log.targetUnchanged)} tempLeft=${String(attempt.tempLeft)} afterClose=${String(replacedAfter)}. ${attempt.message} ${holder.output().slice(-300)}`;
  return log;
}

async function waitForFile(file: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await readFile(file);
      return true;
    } catch {
      await delay(30);
    }
  }
  return false;
}

async function runNewFile(
  id: CaseId,
  dir: string,
  fileName: string,
  input: RunInput,
  scope: CaseLog['scope'],
): Promise<CaseLog> {
  const log = baseLog(id, scope);
  log.ran = true;
  log.needsOutside = scope === 'packaged';
  await input.hooks.show(id, `Writing a new file in ${dir}.`);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, fileName);
  const body = markerText(id, randomBytes(16).toString('hex'));
  const wrote = await writeAtomic(target, body);
  log.path = target;
  log.bytes = body.length;
  log.sha256 = sha256(body);
  log.attempts = 1;
  if (!wrote.ok) {
    log.pass = false;
    applyError(log, wrote);
    log.detail = `The new file was not written (${wrote.code ?? wrote.message}).`;
    return log;
  }
  const onDisk = await hashFile(target);
  const stored = onDisk === log.sha256;
  log.pass = scope === 'packaged' ? null : stored;
  log.detail = stored
    ? `Wrote ${body.length} bytes at ${target}. sha256 ${log.sha256}. ${scope === 'packaged' ? 'This process cannot see MSIX redirection. Get-Item from outside the package decides whether this path is real.' : 'This process is not the MSIX package.'}`
    : `The file at ${target} does not match the bytes just written.`;
  if (!stored) log.pass = false;
  return log;
}

async function runAppData(input: RunInput, scope: CaseLog['scope']): Promise<CaseLog> {
  const log = baseLog('appdata-contrast', scope);
  log.ran = true;
  log.needsOutside = true;
  await input.hooks.show(log.id, 'Writing under userData, Roaming, and Local so the outside check can see redirection.');
  const userFile = path.join(input.paths.userData, 's01-userdata.txt');
  const roamingFile = path.join(input.paths.appData, FOLDER_NAME, 's01-roaming.txt');
  const localFile = path.join(input.paths.localAppData, FOLDER_NAME, 's01-local.txt');
  const pieces = [
    { file: userFile, label: 'userData' },
    { file: roamingFile, label: 'roaming' },
    { file: localFile, label: 'local' },
  ];
  const hashes: string[] = [];
  for (const piece of pieces) {
    await mkdir(path.dirname(piece.file), { recursive: true });
    const body = markerText(piece.label, randomBytes(16).toString('hex'));
    const wrote = await writeAtomic(piece.file, body);
    if (!wrote.ok) {
      log.pass = false;
      applyError(log, wrote);
      log.detail = `The ${piece.label} write failed (${wrote.code ?? wrote.message}) at ${piece.file}.`;
      log.path = piece.file;
      return log;
    }
    hashes.push(`${piece.label} ${sha256(body)} ${piece.file}`);
  }
  log.path = userFile;
  log.pass = null;
  log.detail = `Wrote three AppData files from inside this process. userData is ${input.paths.userData}. Get-Item from outside decides whether those paths are redirected. ${hashes.join(' | ')}`;
  return log;
}

function skipped(id: CaseId, scope: CaseLog['scope'], detail: string): CaseLog {
  const log = baseLog(id, scope);
  log.detail = detail;
  return log;
}

export async function runCases(input: RunInput, ids: readonly CaseId[]): Promise<RunOutput> {
  const scope: CaseLog['scope'] = input.packaged ? 'packaged' : 'unpackaged';
  const work = input.packaged
    ? path.join(input.paths.documents, FOLDER_NAME)
    : path.join(input.outputDir, 'work');
  const secondRoot = input.secondFolder ? path.join(input.secondFolder, FOLDER_NAME) : null;
  const logs: CaseLog[] = [];
  const keep = async (log: CaseLog): Promise<void> => {
    logs.push(log);
    await input.hooks.finish(log);
  };
  const claim: ClaimFile = {
    packageName: PACKAGE_NAME,
    packaged: input.packaged,
    runId: randomBytes(8).toString('hex'),
    paths: input.paths,
    documentsFile: null,
    documentsSha256: null,
    secondFile: null,
    secondSha256: null,
    secondFolder: input.secondFolder,
    userDataFile: null,
    userDataSha256: null,
    roamingFile: null,
    roamingSha256: null,
    localFile: null,
    localSha256: null,
    renameDocuments: null,
    renameSecond: null,
  };

  for (const id of ids) {
    if (id === 'documents-new') {
      const log = await runNewFile(id, work, 'documents-new.txt', input, scope);
      claim.documentsFile = log.path;
      claim.documentsSha256 = log.sha256;
      await keep(log);
      continue;
    }
    if (id === 'second-folder-new') {
      if (!secondRoot) {
        await keep(skipped(id, scope, 'No second folder was chosen.'));
        continue;
      }
      const log = await runNewFile(id, secondRoot, 'second-new.txt', input, scope);
      claim.secondFile = log.path;
      claim.secondSha256 = log.sha256;
      await keep(log);
      continue;
    }
    if (id === 'rename-replace-documents') {
      const log = await runRename(
        id,
        work,
        path.join(input.outputDir, GO_DOCUMENTS),
        path.join(input.outputDir, STOP_DOCUMENTS),
        path.join(input.outputDir, WATCH_CHILD_DOCUMENTS),
        input,
        scope,
      );
      claim.renameDocuments = log.path;
      await keep(log);
      continue;
    }
    if (id === 'rename-replace-second') {
      if (!secondRoot) {
        await keep(skipped(id, scope, 'No second folder was chosen.'));
        continue;
      }
      const log = await runRename(
        id,
        secondRoot,
        path.join(input.outputDir, GO_SECOND),
        path.join(input.outputDir, STOP_SECOND),
        path.join(input.outputDir, WATCH_CHILD_SECOND),
        input,
        scope,
      );
      claim.renameSecond = log.path;
      await keep(log);
      continue;
    }
    if (id === 'rename-readonly') {
      await keep(await runReadOnly(work, input, scope));
      continue;
    }
    if (id === 'rename-open') {
      await keep(await runOpen(work, input, scope));
      continue;
    }
    if (id !== 'appdata-contrast') {
      await keep(skipped(id, scope, 'No runner for this case.'));
      continue;
    }
    const log = await runAppData(input, scope);
    claim.userDataFile = path.join(input.paths.userData, 's01-userdata.txt');
    claim.roamingFile = path.join(input.paths.appData, FOLDER_NAME, 's01-roaming.txt');
    claim.localFile = path.join(input.paths.localAppData, FOLDER_NAME, 's01-local.txt');
    const userBody = await readFile(claim.userDataFile).catch(() => null);
    const roamingBody = await readFile(claim.roamingFile).catch(() => null);
    const localBody = await readFile(claim.localFile).catch(() => null);
    claim.userDataSha256 = userBody ? sha256(userBody) : null;
    claim.roamingSha256 = roamingBody ? sha256(roamingBody) : null;
    claim.localSha256 = localBody ? sha256(localBody) : null;
    await keep(log);
  }

  await mkdir(input.outputDir, { recursive: true });
  await writeFile(path.join(input.outputDir, CLAIM_FILE), `${JSON.stringify(claim, null, 2)}\n`);
  return { cases: logs, claim };
}

export function casesDecideOk(cases: readonly CaseLog[]): boolean {
  return cases.every((item) => item.pass !== false);
}
