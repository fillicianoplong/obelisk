import { DOMParser } from '@xmldom/xmldom';

export const mathNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
export const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const contentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const relationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const officeDocumentRelationship =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

export function parseXml(xml: string, label: string): Document {
  const errors: string[] = [];
  const parser = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (message: unknown) => {
        errors.push(String(message));
      },
      fatalError: (message: unknown) => {
        errors.push(String(message));
      },
    },
  });
  const document = parser.parseFromString(xml, 'text/xml');
  if (errors.length > 0) {
    throw new Error(`${label} is not well-formed XML: ${errors.join('; ')}`);
  }
  const root = document.documentElement;
  if (!root) {
    throw new Error(`${label} has no root element`);
  }
  if (root.localName === 'parsererror') {
    throw new Error(`${label} is not well-formed XML`);
  }
  return document;
}

export function childElements(node: Node): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes[index];
    if (child?.nodeType === 1) {
      children.push(child as Element);
    }
  }
  return children;
}

export function descendants(root: Element, namespace: string, localName: string): Element[] {
  const found: Element[] = [];
  const walk = (node: Element): void => {
    for (const child of childElements(node)) {
      if (child.namespaceURI === namespace && child.localName === localName) {
        found.push(child);
      }
      walk(child);
    }
  };
  walk(root);
  return found;
}

export function textContent(node: Node): string {
  let text = '';
  if (node.nodeType === 3) {
    return node.nodeValue ?? '';
  }
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes[index];
    if (child) {
      text += textContent(child);
    }
  }
  return text;
}

export function attribute(element: Element, name: string): string | null {
  const direct = element.getAttribute(name);
  if (direct !== null && direct !== '') {
    return direct;
  }
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  const namespaced = element.getAttributeNS(mathNamespace, local) ?? element.getAttributeNS(wordNamespace, local);
  return namespaced === '' ? null : namespaced;
}
