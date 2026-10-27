import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { equationParagraphs, insertedMath, naiveParagraphs, packDocument } from './build-docx';
import { checkNaivePackage, checkPackage, type PackageCheck } from './check-package';
import { convertFormula, probeLessThan, type ConvertedFormula } from './convert';
import { loadInLibreOffice, type LibreOfficeResult } from './libreoffice';
import { allSamplesFile, naiveFile, samples, type FormulaSample } from './samples';
import { assertSampleStructure, readStructure, type OmmlStructure } from './structure';

interface BuiltSample {
  sample: FormulaSample;
  display: ConvertedFormula;
  inline: ConvertedFormula;
  displayStructure: OmmlStructure;
  inlineStructure: OmmlStructure;
  identicalOmml: boolean;
  returnedRootKey: string | null;
  problems: string[];
}

async function main(): Promise<void> {
  const spikeRoot = path.resolve(__dirname, '..');
  const output = path.join(spikeRoot, 'output');
  await fs.promises.rm(output, { recursive: true, force: true });
  await fs.promises.mkdir(output, { recursive: true });

  const built = samples.map((sample) => buildSample(sample));
  const lessThan = probeLessThan();
  const lessThanProblems: string[] = [];
  if (lessThan.defaultWellFormed) {
    lessThanProblems.push('The default conversion of a<0 was well-formed XML');
  }
  if (!lessThan.disabledDecodeWellFormed) {
    lessThanProblems.push('disableDecode did not make a<0 well-formed');
  }

  const written: { file: string; bytes: Buffer; equations: number; naive: boolean; texts: string[] }[] = [];
  for (const item of built) {
    const display = insertedMath(item.display.omml);
    const inline = insertedMath(item.inline.omml);
    item.returnedRootKey = display.returnedRootKey === undefined ? null : display.returnedRootKey;
    if (display.returnedRootKey !== undefined || inline.returnedRootKey !== undefined) {
      item.problems.push(`fromXmlString root key was ${String(display.returnedRootKey)}`);
    }
    const bytes = await packDocument(
      equationParagraphs(`${item.sample.name} — ${item.sample.latex}`, display.math, inline.math),
    );
    written.push({
      file: item.sample.file,
      bytes,
      equations: 2,
      naive: false,
      texts: [item.sample.name, ...item.displayStructure.texts],
    });
  }

  const allParagraphs = built.flatMap((item) => {
    const display = insertedMath(item.display.omml);
    const inline = insertedMath(item.inline.omml);
    return equationParagraphs(`${item.sample.name} — ${item.sample.latex}`, display.math, inline.math);
  });
  written.push({
    file: allSamplesFile,
    bytes: await packDocument(allParagraphs),
    equations: samples.length * 2,
    naive: false,
    texts: samples.map((sample) => sample.name),
  });

  const fraction = built[0];
  if (!fraction) {
    throw new Error('The fraction sample is missing');
  }
  written.push({
    file: naiveFile,
    bytes: await packDocument(naiveParagraphs(fraction.display.omml)),
    equations: 1,
    naive: true,
    texts: ['fraction', 'a+b'],
  });

  const packageChecks: PackageCheck[] = [];
  for (const file of written) {
    await fs.promises.writeFile(path.join(output, file.file), file.bytes);
    packageChecks.push(
      file.naive
        ? await checkNaivePackage(file.file, file.bytes)
        : await checkPackage(file.file, file.bytes, file.equations),
    );
  }

  const libreOffice = await loadInLibreOffice(
    written
      .filter((file) => !file.naive)
      .map((file) => ({ file: file.file, docxPath: path.join(output, file.file), texts: file.texts })),
    output,
  );
  const naiveOffice = await loadInLibreOffice(
    written
      .filter((file) => file.naive)
      .map((file) => ({ file: file.file, docxPath: path.join(output, file.file), texts: file.texts })),
    output,
  );

  const structureProblems = built.flatMap((item) => item.problems);
  const packageProblems = packageChecks.filter((item) => !item.pass);
  const automatedPass =
    structureProblems.length === 0 &&
    lessThanProblems.length === 0 &&
    packageProblems.length === 0 &&
    (libreOffice.skipped || libreOffice.pass);

  const report = {
    question: 'Does mathml2omml output of the SRS equation samples open as editable equations in Word for Windows?',
    word: 'not-run',
    automatedPass,
    passFail: 'open',
    environment: environment(),
    packages: {
      docx: readPackage('docx'),
      mathml2omml: readPackage('mathml2omml'),
      katex: readPackage('katex'),
      jszip: readPackage('jszip'),
      xmldom: readPackage('@xmldom/xmldom'),
    },
    samples: built.map(summarizeSample),
    lessThan: {
      defaultWellFormed: lessThan.defaultWellFormed,
      disabledDecodeWellFormed: lessThan.disabledDecodeWellFormed,
      defaultError: lessThan.defaultError,
      problems: lessThanProblems,
    },
    packagesChecked: packageChecks,
    libreOffice,
    naiveLibreOffice: naiveOffice,
    files: written.map((file) => ({
      file: file.file,
      bytes: file.bytes.length,
      equations: file.equations,
      naive: file.naive,
    })),
  };

  await fs.promises.writeFile(path.join(output, 'spike-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.promises.writeFile(path.join(output, 'FILES.txt'), filesList(built));
  await copyArtifacts(output);

  printSummary(report.automatedPass, built, packageChecks, libreOffice, naiveOffice);
  if (!automatedPass) {
    console.log('Structure problems:');
    for (const problem of structureProblems) {
      console.log(`  ${problem}`);
    }
    console.log('Package problems:');
    for (const item of packageProblems) {
      console.log(`  ${item.file}: ${item.problems.join('; ')}`);
    }
    if (lessThanProblems.length > 0) {
      console.log(`Less-than probe: ${lessThanProblems.join('; ')}`);
    }
    process.exitCode = 1;
  }
}

function buildSample(sample: FormulaSample): BuiltSample {
  const display = convertFormula(sample.latex, true);
  const inline = convertFormula(sample.latex, false);
  const displayStructure = readStructure(display.omml, sample.latex);
  const inlineStructure = readStructure(inline.omml, sample.latex);
  const problems = assertSampleStructure(sample.id, displayStructure, inlineStructure);
  const identicalOmml = display.omml === inline.omml;
  if (sample.id === 'sum' && identicalOmml) {
    problems.push('Display and inline OMML for the sum were the same string');
  }
  if (sample.id !== 'sum' && !identicalOmml) {
    problems.push('Display and inline OMML differed');
  }
  if (!display.sameWithDisableDecode || !inline.sameWithDisableDecode) {
    problems.push('disableDecode changed the OMML');
  }
  const warningText = [...display.warnings, ...inline.warnings].join('\n');
  if (!warningText.includes('Type not supported: annotation')) {
    problems.push('The annotation warning was missing');
  }
  return {
    sample,
    display,
    inline,
    displayStructure,
    inlineStructure,
    identicalOmml,
    returnedRootKey: null,
    problems,
  };
}

function summarizeSample(item: BuiltSample): Record<string, unknown> {
  return {
    id: item.sample.id,
    name: item.sample.name,
    file: item.sample.file,
    latex: item.sample.latex,
    identicalOmml: item.identicalOmml,
    returnedRootKey: item.returnedRootKey,
    warnings: item.display.warnings,
    problems: item.problems,
    display: {
      omml: item.display.omml,
      structure: item.displayStructure,
    },
    inline: {
      omml: item.inline.omml,
      limitLocation: item.inlineStructure.nary?.limitLocation ?? null,
    },
  };
}

function filesList(built: readonly BuiltSample[]): string {
  const lines = [
    'SRS formula reference samples in the generated Word files.',
    'Each sample file has the formula centered on its own paragraph, then the same formula inline after the word Inline.',
    '',
  ];
  for (const item of built) {
    lines.push(`${item.sample.file} — ${item.sample.name}: ${item.sample.latex}`);
  }
  lines.push(`${allSamplesFile} — all six samples, in the formula-reference order, display then inline.`);
  lines.push(
    `${naiveFile} — not a sample. The fraction as the raw ImportedXmlComponent.fromXmlString() return value.`,
  );
  lines.push('');
  return lines.join('\n');
}

function environment(): Record<string, string | null> {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
    githubSha: process.env.GITHUB_SHA ?? null,
    runnerOs: process.env.RUNNER_OS ?? null,
    runnerName: process.env.RUNNER_NAME ?? null,
    imageOs: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
  };
}

function readPackage(name: string): { version: string; license: string | null } {
  const file = path.join(__dirname, '..', 'node_modules', name, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string; license?: string | { type?: string } };
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? null);
  return { version: pkg.version ?? 'unknown', license };
}

async function copyArtifacts(output: string): Promise<void> {
  const root = process.env.CURSOR_ARTIFACTS ?? '/opt/cursor/artifacts';
  if (!fs.existsSync(root)) {
    return;
  }
  const destination = path.join(root, 's03');
  await fs.promises.mkdir(destination, { recursive: true });
  for (const name of await fs.promises.readdir(output)) {
    if (name.endsWith('.docx') || name === 'FILES.txt' || name === 'spike-report.json') {
      await fs.promises.copyFile(path.join(output, name), path.join(destination, name));
    }
  }
}

function printSummary(
  automatedPass: boolean,
  built: readonly BuiltSample[],
  packageChecks: readonly PackageCheck[],
  libreOffice: LibreOfficeResult,
  naiveOffice: LibreOfficeResult,
): void {
  console.log(automatedPass ? 'Automated checks passed.' : 'Automated checks failed.');
  console.log('Word for Windows was not opened. The pass/fail for editable equations is open.');
  for (const item of built) {
    console.log(
      `${item.sample.file}: ${item.problems.length === 0 ? 'structure ok' : item.problems.join('; ')}`,
    );
  }
  for (const item of packageChecks) {
    console.log(`${item.file}: ${item.pass ? 'package ok' : item.problems.join('; ')}`);
  }
  if (libreOffice.skipped) {
    console.log('LibreOffice: not installed, load check skipped.');
  } else {
    console.log(`LibreOffice: ${libreOffice.version ?? 'unknown'} ${libreOffice.pass ? 'wrote Flat ODF' : libreOffice.error}`);
    for (const file of libreOffice.files) {
      if (file.textsMissing.length > 0) {
        console.log(`  ${file.file} missing in Flat ODF: ${file.textsMissing.join(', ')}`);
      }
    }
  }
  if (!naiveOffice.skipped) {
    console.log(`Naive file in LibreOffice: ${naiveOffice.pass ? 'wrote Flat ODF' : naiveOffice.error}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
