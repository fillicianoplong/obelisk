export interface AboutNotice {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly licenseId: string;
  readonly noticePath: string;
  readonly fullTextPath?: string;
  readonly sourceUrl?: string;
}

/** Generated from resources/licenses/manifest.json. Do not edit by hand. */
export const ABOUT_NOTICES: readonly AboutNotice[] = [
  {
    id: 'electron',
    name: "Electron and Chromium",
    summary: "MIT; Chromium notices ship with Electron.",
    licenseId: 'MIT',
    noticePath: '/licenses/electron.txt',
    fullTextPath: '/licenses/electron-full.txt',
  },
  {
    id: 'react',
    name: "React",
    summary: "UI library.",
    licenseId: 'MIT',
    noticePath: '/licenses/react.txt',
  },
  {
    id: 'prosemirror',
    name: "ProseMirror",
    summary: "Document editor core.",
    licenseId: 'MIT',
    noticePath: '/licenses/prosemirror.txt',
  },
  {
    id: 'katex',
    name: "KaTeX",
    summary: "Equation layout (equations feature).",
    licenseId: 'MIT',
    noticePath: '/licenses/katex.txt',
  },
  {
    id: 'mathml2omml',
    name: "mathml2omml",
    summary: "Word equation export; separate replaceable module.",
    licenseId: 'LGPL-3.0-or-later',
    noticePath: '/licenses/mathml2omml.txt',
    fullTextPath: '/licenses/mathml2omml-lgpl.txt',
    sourceUrl: "https://github.com/fiduswriter/mathml2omml",
  },
  {
    id: 'docx',
    name: "docx",
    summary: "Word export.",
    licenseId: 'MIT',
    noticePath: '/licenses/docx.txt',
  },
  {
    id: 'jszip',
    name: "JSZip (used by docx)",
    summary: "Used under the MIT terms of the MIT or GPLv3 dual license.",
    licenseId: 'MIT',
    noticePath: '/licenses/jszip.txt',
  },
  {
    id: 'yauzl',
    name: "yauzl",
    summary: ".obk archive reader.",
    licenseId: 'MIT',
    noticePath: '/licenses/yauzl.txt',
  },
  {
    id: 'yazl',
    name: "yazl",
    summary: ".obk archive writer.",
    licenseId: 'MIT',
    noticePath: '/licenses/yazl.txt',
  },
  {
    id: 'mermaid',
    name: "Mermaid",
    summary: "Diagram layout uses dagre (MIT); elkjs is not shipped.",
    licenseId: 'MIT',
    noticePath: '/licenses/mermaid.txt',
  },
  {
    id: 'bundled-fonts',
    name: "Bundled fonts",
    summary: "Per the fonts reference; full OFL text ships beside each family.",
    licenseId: 'SIL-OFL-1.1',
    noticePath: '/licenses/bundled-fonts.txt',
  },
];
