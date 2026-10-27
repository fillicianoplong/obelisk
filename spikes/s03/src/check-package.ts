import JSZip from 'jszip';
import {
  attribute,
  childElements,
  contentTypesNamespace,
  descendants,
  mathNamespace,
  officeDocumentRelationship,
  parseXml,
  relationshipsNamespace,
  wordNamespace,
} from './xml';

const documentContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const relationshipsContentType = 'application/vnd.openxmlformats-package.relationships+xml';

export interface PackageCheck {
  file: string;
  pass: boolean;
  problems: string[];
  equationCount: number;
  equationsDirectlyInParagraphs: number;
  undefinedElements: number;
  pageWidth: string | null;
  pageHeight: string | null;
  margins: { top: string | null; right: string | null; bottom: string | null; left: string | null };
}

export async function checkPackage(file: string, bytes: Buffer, expectedEquations: number): Promise<PackageCheck> {
  const problems: string[] = [];
  const names = centralDirectoryNames(bytes, problems);
  let equationCount = 0;
  let equationsDirectlyInParagraphs = 0;
  let undefinedElements = 0;
  let pageWidth: string | null = null;
  let pageHeight: string | null = null;
  const margins = { top: null as string | null, right: null as string | null, bottom: null as string | null, left: null as string | null };

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch (error) {
    problems.push(`ZIP read failed: ${error instanceof Error ? error.message : String(error)}`);
    return { file, pass: false, problems, equationCount, equationsDirectlyInParagraphs, undefinedElements, pageWidth, pageHeight, margins };
  }

  const packedNames = Object.keys(zip.files).sort();
  const listed = [...names].sort();
  if (listed.join('\n') !== packedNames.join('\n')) {
    problems.push('Central-directory names do not match the names JSZip read');
  }

  const fileNames = packedNames.filter((name) => !zip.files[name]?.dir);
  const parts = new Map<string, Buffer>();
  for (const name of fileNames) {
    const entry = zip.file(name);
    if (!entry) {
      problems.push(`Missing ZIP entry ${name}`);
      continue;
    }
    parts.set(name, await entry.async('nodebuffer'));
  }

  const contentTypes = parts.get('[Content_Types].xml');
  const packageRels = parts.get('_rels/.rels');
  const documentXml = parts.get('word/document.xml');
  if (!contentTypes) {
    problems.push('Missing [Content_Types].xml');
  }
  if (!packageRels) {
    problems.push('Missing _rels/.rels');
  }
  if (!documentXml) {
    problems.push('Missing word/document.xml');
  }

  if (contentTypes && packageRels && documentXml) {
    const typed = contentTypeMap(contentTypes, problems);
    for (const name of parts.keys()) {
      if (name === '[Content_Types].xml') {
        continue;
      }
      const contentType = contentTypeFor(typed, name);
      if (!contentType) {
        problems.push(`No content type for ${name}`);
        continue;
      }
      if (contentType.endsWith('+xml') || contentType === 'application/xml' || contentType === 'text/xml') {
        try {
          parseXml(parts.get(name)?.toString('utf8') ?? '', name);
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    if (contentTypeFor(typed, 'word/document.xml') !== documentContentType) {
      problems.push(`word/document.xml content type is ${contentTypeFor(typed, 'word/document.xml')}`);
    }
    if (contentTypeFor(typed, '_rels/.rels') !== relationshipsContentType) {
      problems.push(`_rels/.rels content type is ${contentTypeFor(typed, '_rels/.rels')}`);
    }
    checkRelationships(parts, problems);
    const document = parseXml(documentXml.toString('utf8'), 'word/document.xml');
    const root = document.documentElement;
    if (!root || root.namespaceURI !== wordNamespace || root.localName !== 'document') {
      problems.push('word/document.xml root is not w:document');
    }
    undefinedElements = countUndefined(root);
    if (undefinedElements > 0) {
      problems.push(`document.xml has ${undefinedElements} element(s) named undefined`);
    }
    const equations = root ? descendants(root, mathNamespace, 'oMath') : [];
    equationCount = equations.length;
    if (equationCount !== expectedEquations) {
      problems.push(`Expected ${expectedEquations} m:oMath elements and found ${equationCount}`);
    }
    for (const equation of equations) {
      if (equation.prefix !== 'm' || equation.namespaceURI !== mathNamespace) {
        problems.push(`An equation is ${equation.prefix}:${equation.localName} in ${equation.namespaceURI}`);
      }
      const parent = equation.parentNode;
      if (parent && parent.nodeType === 1 && (parent as Element).namespaceURI === wordNamespace && (parent as Element).localName === 'p') {
        equationsDirectlyInParagraphs += 1;
      } else {
        const parentName = parent && parent.nodeType === 1 ? (parent as Element).nodeName : 'none';
        problems.push(`m:oMath parent is ${parentName}, not w:p`);
      }
    }
    if (equationsDirectlyInParagraphs !== expectedEquations) {
      problems.push(`${equationsDirectlyInParagraphs} of ${expectedEquations} equations are direct children of a paragraph`);
    }
    const page = root ? descendants(root, wordNamespace, 'pgSz')[0] : undefined;
    const margin = root ? descendants(root, wordNamespace, 'pgMar')[0] : undefined;
    pageWidth = page ? attribute(page, 'w:w') : null;
    pageHeight = page ? attribute(page, 'w:h') : null;
    margins.top = margin ? attribute(margin, 'w:top') : null;
    margins.right = margin ? attribute(margin, 'w:right') : null;
    margins.bottom = margin ? attribute(margin, 'w:bottom') : null;
    margins.left = margin ? attribute(margin, 'w:left') : null;
    if (pageWidth !== '12240' || pageHeight !== '15840') {
      problems.push(`Page size is ${pageWidth} by ${pageHeight}, not Letter`);
    }
    if (margins.top !== '1440' || margins.right !== '1440' || margins.bottom !== '1440' || margins.left !== '1440') {
      problems.push(`Margins are ${margins.top}, ${margins.right}, ${margins.bottom}, ${margins.left}`);
    }
  }

  return {
    file,
    pass: problems.length === 0,
    problems,
    equationCount,
    equationsDirectlyInParagraphs,
    undefinedElements,
    pageWidth,
    pageHeight,
    margins,
  };
}

export async function checkNaivePackage(file: string, bytes: Buffer): Promise<PackageCheck> {
  const checked = await checkPackage(file, bytes, 1);
  const problems = checked.problems.filter(
    (problem) =>
      !problem.includes('named undefined') &&
      !problem.includes('m:oMath parent') &&
      !problem.includes('direct children of a paragraph'),
  );
  if (checked.undefinedElements !== 1) {
    problems.push(`Expected the raw fromXmlString wrapper and found ${checked.undefinedElements} undefined elements`);
  }
  const documentXml = await documentText(bytes);
  if (!documentXml.includes('<undefined>')) {
    problems.push('The naive document does not contain an <undefined> element');
  }
  if (!documentXml.includes('a+b')) {
    problems.push('The naive document does not contain the fraction');
  }
  return { ...checked, pass: problems.length === 0, problems };
}

async function documentText(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return (await zip.file('word/document.xml')?.async('string')) ?? '';
}

interface ContentTypes {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
}

function contentTypeMap(xml: Buffer, problems: string[]): ContentTypes {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const document = parseXml(xml.toString('utf8'), '[Content_Types].xml');
  const root = document.documentElement;
  if (!root || root.namespaceURI !== contentTypesNamespace || root.localName !== 'Types') {
    problems.push('[Content_Types].xml root is not Types');
    return { defaults, overrides };
  }
  for (const child of childElements(root)) {
    if (child.localName === 'Default') {
      const extension = child.getAttribute('Extension');
      const contentType = child.getAttribute('ContentType');
      if (extension && contentType) {
        defaults.set(extension, contentType);
      }
    } else if (child.localName === 'Override') {
      const partName = child.getAttribute('PartName');
      const contentType = child.getAttribute('ContentType');
      if (partName && contentType) {
        overrides.set(partName, contentType);
      }
    }
  }
  return { defaults, overrides };
}

function contentTypeFor(types: ContentTypes, name: string): string | null {
  const override = types.overrides.get(`/${name}`);
  if (override) {
    return override;
  }
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return types.defaults.get(extension) ?? null;
}

function checkRelationships(parts: Map<string, Buffer>, problems: string[]): void {
  let sawOfficeDocument = false;
  for (const [name, bytes] of parts) {
    if (!name.endsWith('.rels')) {
      continue;
    }
    const document = parseXml(bytes.toString('utf8'), name);
    const root = document.documentElement;
    if (!root || root.namespaceURI !== relationshipsNamespace || root.localName !== 'Relationships') {
      problems.push(`${name} root is not Relationships`);
      continue;
    }
    for (const child of childElements(root)) {
      if (child.localName !== 'Relationship') {
        continue;
      }
      const id = child.getAttribute('Id');
      const type = child.getAttribute('Type');
      const target = child.getAttribute('Target');
      const mode = child.getAttribute('TargetMode');
      if (!id || !type || !target) {
        problems.push(`${name} has a relationship missing Id, Type, or Target`);
        continue;
      }
      if (mode === 'External') {
        problems.push(`${name} has an external relationship to ${target}`);
        continue;
      }
      let resolved: string;
      try {
        resolved = resolveTarget(name, target);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!parts.has(resolved)) {
        problems.push(`${name} target ${target} resolves to missing part ${resolved}`);
      }
      if (type === officeDocumentRelationship && resolved === 'word/document.xml') {
        sawOfficeDocument = true;
      }
    }
  }
  if (!sawOfficeDocument) {
    problems.push('The package relationships do not point at word/document.xml');
  }
}

function resolveTarget(relsPart: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1);
  }
  const relsDir = relsPart.split('/').slice(0, -1);
  const sourceDir = relsDir[relsDir.length - 1] === '_rels' ? relsDir.slice(0, -1) : relsDir;
  const out: string[] = [];
  for (const part of [...sourceDir, ...target.split('/')]) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (out.length === 0) {
        throw new Error(`${relsPart} target ${target} leaves the package`);
      }
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function countUndefined(root: Element | null): number {
  if (!root) {
    return 0;
  }
  let count = 0;
  const walk = (node: Element): void => {
    if (node.localName === 'undefined' || node.nodeName === 'undefined') {
      count += 1;
    }
    for (const child of childElements(node)) {
      walk(child);
    }
  };
  walk(root);
  return count;
}

function centralDirectoryNames(bytes: Buffer, problems: string[]): string[] {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) {
    problems.push('The file does not start with a ZIP local header');
    return [];
  }
  const eocd = findEocd(bytes);
  if (eocd < 0) {
    problems.push('No end of central directory');
    return [];
  }
  const entries = bytes.readUInt16LE(eocd + 10);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (entries === 0xffff || directoryOffset === 0xffffffff) {
    problems.push('ZIP64 is not expected for these files');
    return [];
  }
  const names: string[] = [];
  const seen = new Set<string>();
  let position = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (position + 46 > bytes.length || bytes.readUInt32LE(position) !== 0x02014b50) {
      problems.push('Central directory entry is truncated or has a bad signature');
      break;
    }
    const flags = bytes.readUInt16LE(position + 8);
    const method = bytes.readUInt16LE(position + 10);
    const nameLength = bytes.readUInt16LE(position + 28);
    const extraLength = bytes.readUInt16LE(position + 30);
    const commentLength = bytes.readUInt16LE(position + 32);
    const localOffset = bytes.readUInt32LE(position + 42);
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength);
    const name = (flags & 0x800) !== 0 ? nameBytes.toString('utf8') : nameBytes.toString('latin1');
    if (seen.has(name)) {
      problems.push(`Duplicate ZIP name ${name}`);
    }
    seen.add(name);
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      problems.push(`ZIP name is not a safe part path: ${name}`);
    }
    if ((flags & 0x1) !== 0) {
      problems.push(`${name} is encrypted`);
    }
    if (method !== 0 && method !== 8) {
      problems.push(`${name} uses compression method ${method}`);
    }
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      problems.push(`${name} local header is missing`);
    } else {
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
      if (!localName.equals(nameBytes)) {
        problems.push(`${name} local header name does not match the central directory`);
      }
    }
    names.push(name);
    position += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function findEocd(bytes: Buffer): number {
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= start; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) {
      const commentLength = bytes.readUInt16LE(index + 20);
      if (index + 22 + commentLength === bytes.length) {
        return index;
      }
    }
  }
  return -1;
}
