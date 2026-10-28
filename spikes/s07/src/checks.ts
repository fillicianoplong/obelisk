export const PASS_RULE = "On a pass, the dependent item keeps the architecture's design.";
export const FAIL_RULE = 'On a fail, the fallback is: keep signatures unsaved when encryption is unavailable (NFR-09).';

export function manifestProblems(xml: string): string[] {
  const problems: string[] = [];
  if (!xml.includes('Name="Obelisk.SpikeS07"')) problems.push('identity is not Obelisk.SpikeS07');
  if (xml.includes('Name="Obelisk.Dev"')) problems.push('identity is Obelisk.Dev');
  if (!xml.includes('Publisher="CN=Obelisk Dev"')) problems.push('publisher is not CN=Obelisk Dev');
  if (xml.includes('.obk')) problems.push('mentions .obk');
  if (xml.includes('windows.fileTypeAssociation')) problems.push('registers a file type');
  if (!xml.includes('Name="runFullTrust"')) problems.push('not full trust');
  if (!xml.includes('ObeliskSpikeS07.exe')) problems.push('executable is not ObeliskSpikeS07.exe');
  if (!xml.includes('Category="windows.appExecutionAlias"')) problems.push('no windows.appExecutionAlias');
  if (!xml.includes('Alias="ObeliskSpikeS07.exe"')) problems.push('alias is not ObeliskSpikeS07.exe');
  return problems;
}

export function readmeProblems(text: string): string[] {
  const problems: string[] = [];
  if (!text.includes(PASS_RULE)) problems.push('missing the pass rule');
  if (!text.includes(FAIL_RULE)) problems.push('missing the fail rule');
  if (!text.includes('encryptStringAsync')) problems.push('missing encryptStringAsync');
  if (!text.includes('decryptStringAsync')) problems.push('missing decryptStringAsync');
  if (!text.includes('isAsyncEncryptionAvailable')) problems.push('missing isAsyncEncryptionAvailable');
  if (!text.includes('shouldReEncrypt')) problems.push('missing shouldReEncrypt');
  if (!text.includes('a dev-signed MSIX can\'t be started at all on a PC with Smart App Control enforcing')) {
    problems.push('missing the Smart App Control finding');
  }
  if (!text.includes('treat any decrypt failure as signature unavailable')) {
    problems.push('missing the generic decrypt failure rule');
  }
  if (!text.includes('### If this is a pass')) problems.push('missing the pass note');
  if (!text.includes('### If this is a fail')) problems.push('missing the fail note');
  const manual = text.split('## Manual results')[1] ?? '';
  if (!manual) {
    problems.push('no manual results section');
    return problems;
  }
  if (!manual.includes('- [x] Pass.')) problems.push('Pass is not ticked');
  if (!manual.includes('- [ ] Fail.')) problems.push('Fail box is missing');
  if (manual.includes('Not run on this PC yet.')) problems.push('manual results are still empty');
  if (manual.includes('- [x] Fail') || manual.includes('- [X] Fail')) problems.push('Fail is ticked');
  if (!manual.includes('a9f81193dc9a9e668a11510128986084c26bb1cb')) problems.push('missing the PC run commit');
  return problems;
}

export function rendererProblems(source: string): string[] {
  const pattern = /from\s+['"]electron['"]|from\s+['"]node:|require\s*\(\s*['"]electron['"]|require\s*\(\s*['"]node:/;
  if (pattern.test(source)) return ['The walkthrough page imports Node or Electron.'];
  return [];
}

export function packageScriptProblems(source: string): string[] {
  const problems: string[] = [];
  if (!source.includes("console.log('Dev certificate: reused')")) problems.push('does not log Dev certificate: reused');
  if (!source.includes('would create a new')) problems.push('does not stop when it would create a certificate');
  if (source.includes('certreq')) problems.push('calls certreq');
  if (source.includes('Dev certificate: created')) problems.push('can create a certificate');
  return problems;
}
