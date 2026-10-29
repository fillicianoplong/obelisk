import type { KatexOptions } from 'katex';
import type { MermaidConfig } from 'mermaid';
import type katex from 'katex';
import type mermaid from 'mermaid';

type KatexApi = typeof katex;
type MermaidApi = typeof mermaid;

let katexApi: KatexApi;
let mermaidApi: MermaidApi;

interface S04Call {
  kind: string;
  body: string;
}

interface StyleBlock {
  length: number;
  sha256: string;
  hasDiagramId: boolean;
  head: string;
  text: string | null;
}

interface DiagramResult {
  id: string;
  ok: boolean;
  error: string | null;
  width: number;
  height: number;
  texts: string[];
  foreignObject: number;
  scriptElements: number;
  imageElements: number;
  hrefs: string[];
  eventHandlers: string[];
  shapeFill: string | null;
  textFill: string | null;
  styleElements: StyleBlock[];
  styleAttributeCount: number;
  rewrittenAttributes: number;
  declaredMaxWidth: number | null;
  remoteStyleUrls: string[];
}

interface FormulaResult {
  id: string;
  output: 'html' | 'mathml' | 'htmlAndMathml';
  ok: boolean;
  error: string | null;
  fontFamily: string | null;
  stacked: boolean | null;
  numeratorTop: number | null;
  denominatorTop: number | null;
  lineWidth: number | null;
  width: number;
  height: number;
  hrefs: string[];
  hasImage: boolean;
  styleAttributes: string[];
  mathml: boolean;
}

interface PageReport {
  fatal: string | null;
  mode: string;
  config: Record<string, unknown> | null;
  diagrams: DiagramResult[];
  formulas: FormulaResult[];
  security: {
    afterHostileInit: Record<string, unknown> | null;
    sentinelBackground: string | null;
    pwned: boolean;
    macroLeaked: boolean | null;
    hrefBlocked: boolean | null;
    htmlExtensionRefused: boolean | null;
  };
  calls: S04Call[];
  violations: Array<{
    effectiveDirective: string;
    violatedDirective: string;
    blockedURI: string;
    sample: string;
    disposition: string;
    sourceFile: string;
    lineNumber: number;
  }>;
  fonts: { katexMain: boolean; ready: boolean };
  decision: DecisionCheck | null;
}

interface DecisionCheck {
  ok: boolean;
  flowchartWidth: number;
  flowchartHeight: number;
  flowchartFill: string | null;
  flowchartAttributes: number;
  hostileOk: boolean;
  hostileError: string | null;
  forbiddenAbsent: boolean;
  selectorsScoped: boolean;
  sentinelColor: string | null;
  sentinelDisplay: string | null;
  outsideColor: string | null;
}

declare global {
  var __s04Calls: S04Call[] | undefined;
  var __s04Report: PageReport | undefined;
  var __s04Pwned: number | undefined;
}

const SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'themeCSS',
  'themeVariables',
  'fontFamily',
  'htmlLabels',
  'dompurifyConfig',
  'theme',
];

const DIAGRAMS: ReadonlyArray<{ id: string; source: string; security?: boolean }> = [
  {
    id: 'flowchart',
    source: `flowchart TD
  Start([Start]) --> Decide{Ready?}
  Decide -->|Yes| Done([Done])
  Decide -->|No| Start`,
  },
  {
    id: 'sequence',
    source: `sequenceDiagram
  Alice->>Bob: Hello
  Bob-->>Alice: Hi`,
  },
  {
    id: 'class',
    source: `classDiagram
  class Animal {
    +name
  }
  class Dog
  Animal <|-- Dog`,
  },
  {
    id: 'state',
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Busy: start
  Busy --> Idle: stop`,
  },
  {
    id: 'er',
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINEITEM : contains`,
  },
  {
    id: 'pie',
    source: `pie showData
  title Pets
  "Dogs" : 40
  "Cats" : 35
  "Birds" : 25`,
  },
  {
    id: 'gantt',
    source: `gantt
  title A plan
  dateFormat YYYY-MM-DD
  section Work
  Draft :a1, 2026-01-01, 3d
  Review :after a1, 2d`,
  },
  {
    id: 'mindmap',
    source: `mindmap
  root((Topic))
    Branch
      Leaf`,
  },
  {
    id: 'timeline',
    source: `timeline
  title History
  2024 : Start
  2025 : Build
  2026 : Ship`,
  },
  {
    id: 'git',
    source: `gitGraph
  commit
  branch feature
  checkout feature
  commit
  checkout main
  merge feature`,
  },
  {
    id: 'journey',
    source: `journey
  title A day
  section Morning
    Wake: 5: Me
    Code: 3: Me`,
  },
  {
    id: 'quadrant',
    source: `quadrantChart
  title Reach
  x-axis Low --> High
  y-axis Low --> High
  quadrant-1 Keep
  quadrant-2 Grow
  quadrant-3 Drop
  quadrant-4 Watch
  Item: [0.3, 0.6]`,
  },
  {
    id: 'block',
    source: `block-beta
  columns 2
  A B
  C`,
  },
  {
    id: 'xy',
    source: `xychart-beta
  title Sales
  x-axis [jan, feb, mar]
  y-axis "Revenue" 0 --> 100
  bar [20, 50, 80]
  line [15, 40, 70]`,
  },
  {
    id: 'requirement',
    source: `requirementDiagram
  requirement req1 {
    id: 1
    text: the system renders
    risk: low
    verifymethod: test
  }
  element editor {
    type: module
  }
  editor - satisfies -> req1`,
  },
  {
    id: 'html-label',
    security: true,
    source: `flowchart TD
  A["<img src='https://example.invalid/pixel.png' onerror='__s04Pwned=1'><script>__s04Pwned=1</script><b>Bold</b>"]`,
  },
  {
    id: 'click',
    security: true,
    source: `flowchart TD
  A[Node]
  click A call __s04Pwned() "tip"
  click A "https://example.invalid/clicked" "open"`,
  },
  {
    id: 'init-directive',
    security: true,
    source: `%%{init: {"securityLevel":"loose","htmlLabels":true,"theme":"dark","themeCSS":"body{background:red}","fontFamily":"https://evil.example/f.woff2","altFontFamily":"https://evil.example/alt.woff2","dompurifyConfig":{"ADD_TAGS":["img"]},"startOnLoad":true}}%%
flowchart TD
  A["<img src='https://example.invalid/from-init.png' onerror='__s04Pwned=1'>"]`,
  },
  {
    id: 'classdef',
    security: true,
    source: `flowchart TD
  A[One]
  classDef evil fill:#fff;} #s04-sentinel { background: rgb(255, 0, 0) !important; } .y { color: black
  class A evil`,
  },
  {
    id: 'style-hostile',
    security: true,
    source: `flowchart TD
  A[Keep]
  classDef leak fill:#333,stroke:#333,position:fixed,content:pwn,display:none
  class A leak
  style A fill:#333,stroke-width:2px,position:fixed,display:none,content:pwn`,
  },
];

const FORMULAS: ReadonlyArray<{ id: string; tex: string; output: 'html' | 'mathml' | 'htmlAndMathml' }> = [
  { id: 'fraction', tex: '\\frac{a+b}{c}', output: 'html' },
  { id: 'fraction-mathml', tex: '\\frac{a+b}{c}', output: 'mathml' },
  { id: 'fraction-both', tex: '\\frac{a+b}{c}', output: 'htmlAndMathml' },
  { id: 'root', tex: '\\sqrt{x^2+y^2}', output: 'html' },
  { id: 'sum', tex: '\\sum_{i=1}^{n} i^2', output: 'html' },
  { id: 'integral', tex: '\\int_0^1 x\\,dx', output: 'html' },
  { id: 'matrix', tex: '\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}', output: 'html' },
  { id: 'greek', tex: '\\hat{\\theta} = \\alpha + \\beta', output: 'html' },
];

const CANARY_DIAGRAMS = new Set(['flowchart', 'sequence', 'pie', 'html-label', 'click', 'init-directive', 'classdef']);
const CANARY_FORMULAS = new Set(['fraction', 'fraction-mathml', 'fraction-both', 'root', 'sum']);
const GALLERY_DIAGRAMS = new Set(['flowchart']);
const GALLERY_FORMULAS = new Set(['fraction-both']);

function katexOptions(output: 'html' | 'mathml' | 'htmlAndMathml'): KatexOptions {
  return {
    throwOnError: true,
    trust: false,
    displayMode: true,
    maxSize: 50,
    maxExpand: 1000,
    macros: {},
    output,
    strict(code) {
      return code === 'htmlExtension' ? 'error' : 'ignore';
    },
  };
}

function configure(layout: string | null): void {
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    fontFamily: 'sans-serif',
    theme: 'default',
    maxTextSize: 50_000,
    suppressErrorRendering: true,
    secure: SECURE_KEYS,
  };
  if (layout) {
    config.layout = layout;
  }
  mermaidApi.initialize(config);
}

function configSnapshot(): Record<string, unknown> {
  const config = mermaidApi.mermaidAPI.getConfig();
  return {
    securityLevel: config.securityLevel ?? null,
    htmlLabels: config.htmlLabels ?? null,
    fontFamily: config.fontFamily ?? null,
    altFontFamily: config.altFontFamily ?? null,
    theme: config.theme ?? null,
    themeCSS: config.themeCSS ?? null,
    startOnLoad: config.startOnLoad ?? null,
    maxTextSize: config.maxTextSize ?? null,
    maxEdges: config.maxEdges ?? null,
    layout: config.layout ?? null,
    suppressErrorRendering: config.suppressErrorRendering ?? null,
    secure: config.secure ?? null,
    dompurifyConfig: config.dompurifyConfig ?? null,
  };
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let binary = '';
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function remoteUrls(css: string): string[] {
  const found = new Set<string>();
  for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
    const url = match[1];
    if (/^[a-z]+:/i.test(url) && !url.startsWith('data:') && !url.startsWith('app:')) {
      found.add(url);
    }
  }
  return [...found];
}

async function styleBlocks(svg: SVGSVGElement, diagramId: string, keepText: boolean): Promise<StyleBlock[]> {
  const blocks: StyleBlock[] = [];
  for (const style of svg.querySelectorAll('style')) {
    const text = style.textContent ?? '';
    blocks.push({
      length: text.length,
      sha256: await sha256(text),
      hasDiagramId: text.includes(diagramId),
      head: text.slice(0, 180),
      text: keepText ? text : null,
    });
  }
  return blocks;
}

function measureBox(element: Element | null): { width: number; height: number } {
  if (!element) {
    return { width: 0, height: 0 };
  }
  const box = element.getBoundingClientRect();
  return { width: box.width, height: box.height };
}

function textTop(root: ParentNode | null, needle: string): number | null {
  if (!root) {
    return null;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.textContent ?? '').includes(needle) && node.parentElement) {
      return node.parentElement.getBoundingClientRect().top;
    }
    node = walker.nextNode();
  }
  return null;
}

async function renderDiagram(
  sample: (typeof DIAGRAMS)[number],
  slot: HTMLElement,
  insert: 'html' | 'nonce-attr' | 'nonce-reattach' | 'rewrite' | 'rewrite-blob' | 'rewrite-nonce',
  nonce: string,
): Promise<DiagramResult> {
  const domId = `s04-${sample.id}`;
  try {
    const rendered = await mermaidApi.render(domId, sample.source);
    const svgText = rendered.svg;
    let keptMaxWidth: number | null = null;
    let rewrittenAttributes = 0;
    if (insert === 'nonce-attr') {
      slot.innerHTML = svgText.replace(/<style\b/g, `<style nonce="${nonce}"`);
    } else if (insert === 'nonce-reattach') {
      const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const parsedSvg = parsed.querySelector('svg');
      const texts = [...(parsedSvg?.querySelectorAll('style') ?? [])].map((style) => style.textContent ?? '');
      parsedSvg?.querySelectorAll('style').forEach((style) => style.remove());
      slot.replaceChildren();
      if (parsedSvg) {
        const live = document.importNode(parsedSvg, true);
        slot.appendChild(live);
        for (const text of texts) {
          const style = document.createElement('style');
          style.nonce = nonce;
          style.textContent = text;
          live.appendChild(style);
        }
      }
    } else if (insert === 'rewrite' || insert === 'rewrite-blob' || insert === 'rewrite-nonce') {
      const placed = placeRewrittenSvg(svgText, sample.id, slot, insert, nonce);
      keptMaxWidth = placed.declaredMaxWidth;
      rewrittenAttributes = placed.moved;
    } else {
      slot.innerHTML = svgText;
    }
    const svg = slot.querySelector('svg');
    const box = measureBox(svg);
    const shape = svg?.querySelector('rect, polygon, circle, ellipse, path');
    const text = svg?.querySelector('text');
    const hrefs = [...(svg?.querySelectorAll('[href], a') ?? [])]
      .map((element) => element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '')
      .filter((href) => href.length > 0);
    const handlers = new Set<string>();
    if (svg) {
      for (const element of svg.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
          if (attribute.name.toLowerCase().startsWith('on')) {
            handlers.add(attribute.name);
          }
        }
      }
    }
    const styleText = [...(svg?.querySelectorAll('style') ?? [])].map((style) => style.textContent ?? '').join('\n');
    return {
      id: sample.id,
      ok: svg !== null && box.width > 0 && box.height > 0,
      error: null,
      width: box.width,
      height: box.height,
      texts: [...(svg?.querySelectorAll('text, span, p, td, th') ?? [])]
        .map((element) => (element.textContent ?? '').trim())
        .filter((value) => value.length > 0)
        .slice(0, 24),
      foreignObject: svg?.querySelectorAll('foreignObject').length ?? 0,
      scriptElements: svg?.querySelectorAll('script').length ?? 0,
      imageElements: svg?.querySelectorAll('image, img').length ?? 0,
      hrefs,
      eventHandlers: [...handlers],
      shapeFill: shape ? getComputedStyle(shape).fill : null,
      textFill: text ? getComputedStyle(text).fill : null,
      styleElements: svg ? await styleBlocks(svg, domId, sample.id === 'flowchart' || sample.id === 'style-hostile') : [],
      styleAttributeCount: svg?.querySelectorAll('[style]').length ?? 0,
      rewrittenAttributes,
      declaredMaxWidth: keptMaxWidth ?? declaredSvgMaxWidth(svg),
      remoteStyleUrls: remoteUrls(styleText),
    };
  } catch (error) {
    return {
      id: sample.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      width: 0,
      height: 0,
      texts: [],
      foreignObject: 0,
      scriptElements: 0,
      imageElements: 0,
      hrefs: [],
      eventHandlers: [],
      shapeFill: null,
      textFill: null,
      styleElements: [],
      styleAttributeCount: 0,
      rewrittenAttributes: 0,
      declaredMaxWidth: null,
      remoteStyleUrls: [],
    };
  }
}

const DRAWING_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'width',
  'height',
  'max-width',
  'min-width',
  'max-height',
  'min-height',
]);

// Fed through the same filter as Mermaid's sheet. A classDef that closes its own rule
// does not parse on 12.2.0, so this is the outer-selector text that filter has to stop.
const HOSTILE_BREAKOUT = [
  '#s04-sentinel{display:none;position:fixed;color:rgb(255, 0, 0);background:url(https://example.invalid/x.png);content:"x"}',
  '.s04-outside{color:rgb(255, 0, 0);position:fixed;fill:rgb(255, 0, 0)}',
  '@import "https://example.invalid/hostile.css";',
  '#s04-sentinel{fill:rgb(255, 0, 0)}',
].join('\n');

function skipComment(css: string, index: number): number {
  const end = css.indexOf('*/', index + 2);
  return end === -1 ? css.length : end + 2;
}

function readQuoted(css: string, index: number): number {
  const quote = css[index];
  let cursor = index + 1;
  while (cursor < css.length) {
    if (css[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (css[cursor] === quote) {
      return cursor + 1;
    }
    cursor += 1;
  }
  return css.length;
}

function indexOfToken(css: string, index: number, token: string): number {
  let cursor = index;
  while (cursor < css.length) {
    const ch = css[cursor];
    if (ch === '"' || ch === "'") {
      cursor = readQuoted(css, cursor);
      continue;
    }
    if (ch === '/' && css[cursor + 1] === '*') {
      cursor = skipComment(css, cursor);
      continue;
    }
    if (css.startsWith(token, cursor)) {
      return cursor;
    }
    cursor += 1;
  }
  return -1;
}

function skipBlock(css: string, openBrace: number): number {
  let depth = 0;
  let cursor = openBrace;
  while (cursor < css.length) {
    const ch = css[cursor];
    if (ch === '"' || ch === "'") {
      cursor = readQuoted(css, cursor);
      continue;
    }
    if (ch === '/' && css[cursor + 1] === '*') {
      cursor = skipComment(css, cursor);
      continue;
    }
    if (ch === '{') {
      depth += 1;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }
  return css.length;
}

function splitList(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === '"' || ch === "'") {
      cursor = readQuoted(text, cursor);
      continue;
    }
    if (text.startsWith(separator, cursor)) {
      parts.push(text.slice(start, cursor));
      cursor += separator.length;
      start = cursor;
      continue;
    }
    cursor += 1;
  }
  parts.push(text.slice(start));
  return parts;
}

function filterDeclarations(body: string): string[] {
  const kept: string[] = [];
  for (const part of splitList(body, ';')) {
    const text = part.trim();
    if (text.length === 0) {
      continue;
    }
    const colon = text.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const property = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (!/^[a-z-]+$/.test(property) || !DRAWING_PROPERTIES.has(property)) {
      continue;
    }
    if (/[{}<]/.test(value) || /url\s*\(/i.test(value) || /@import/i.test(value)) {
      continue;
    }
    kept.push(`${property}:${value}`);
  }
  return kept;
}

function isScopedTo(selector: string, prefix: string): boolean {
  if (!selector.startsWith(prefix)) {
    return false;
  }
  const next = selector.charAt(prefix.length);
  return next.length === 0 || ' .#:[\t\n\r>+~'.includes(next);
}

function scopeSelectorList(selector: string, diagramId: string): string | null {
  if (/[{}<]/.test(selector)) {
    return null;
  }
  const prefix = `#${diagramId}`;
  const scoped = splitList(selector, ',')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0 && !piece.startsWith('@'))
    .map((piece) => (isScopedTo(piece, prefix) ? piece : `${prefix} ${piece}`));
  return scoped.length > 0 ? scoped.join(',') : null;
}

function sanitizeDiagramCss(css: string, diagramId: string): string {
  const rules: string[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    while (cursor < css.length) {
      if (css[cursor] !== undefined && css[cursor] <= ' ') {
        cursor += 1;
        continue;
      }
      if (css[cursor] === '/' && css[cursor + 1] === '*') {
        cursor = skipComment(css, cursor);
        continue;
      }
      break;
    }
    if (cursor >= css.length) {
      break;
    }
    if (css[cursor] === '@') {
      const semi = indexOfToken(css, cursor, ';');
      const brace = indexOfToken(css, cursor, '{');
      if (brace !== -1 && (semi === -1 || brace < semi)) {
        cursor = skipBlock(css, brace);
      } else if (semi !== -1) {
        cursor = semi + 1;
      } else {
        break;
      }
      continue;
    }
    const brace = indexOfToken(css, cursor, '{');
    if (brace === -1) {
      break;
    }
    const selector = css.slice(cursor, brace).trim();
    const end = skipBlock(css, brace);
    const body = css.slice(brace + 1, end - 1);
    cursor = end;
    if (body.includes('{') || /[<>]/.test(selector) || body.includes('<')) {
      continue;
    }
    const declarations = filterDeclarations(body);
    if (declarations.length === 0) {
      continue;
    }
    const scoped = scopeSelectorList(selector, diagramId);
    if (!scoped) {
      continue;
    }
    rules.push(`${scoped}{${declarations.join(';')}}`);
  }
  return rules.join('\n');
}

function sheetIsScoped(css: string, diagramId: string): boolean {
  const prefix = `#${diagramId}`;
  for (const line of css.split('\n')) {
    const brace = line.indexOf('{');
    if (brace === -1) {
      return false;
    }
    const selectors = line.slice(0, brace).split(',');
    if (selectors.some((selector) => !isScopedTo(selector.trim(), prefix))) {
      return false;
    }
  }
  return css.length > 0;
}

function sheetForbidsEscape(css: string): boolean {
  return !/(?:^|[;{\s])(?:position|display|content|background(?:-color)?|animation|z-index)\s*:|url\s*\(|@import|</i.test(css);
}

function placeRewrittenSvg(
  svgText: string,
  diagramId: string,
  slot: HTMLElement,
  insert: 'rewrite' | 'rewrite-blob' | 'rewrite-nonce',
  nonce: string,
): { declaredMaxWidth: number | null; moved: number } {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const parsedSvg = parsed.querySelector('svg');
  if (!parsedSvg) {
    throw new Error('Mermaid returned no svg element.');
  }
  const declaredMaxWidth = declaredSvgMaxWidth(parsedSvg);
  const parts: string[] = [];
  for (const style of parsedSvg.querySelectorAll('style')) {
    parts.push(style.textContent ?? '');
    style.remove();
  }
  let moved = 0;
  let index = 0;
  // querySelectorAll does not include the svg root. Mermaid puts max-width on that root style attribute.
  const styled = parsedSvg.hasAttribute('style') ? [parsedSvg, ...parsedSvg.querySelectorAll('[style]')] : [...parsedSvg.querySelectorAll('[style]')];
  for (const element of styled) {
    const body = element.getAttribute('style') ?? '';
    if (body.includes('{') || body.includes('}') || body.includes('<')) {
      continue;
    }
    const token = `s04rw-${diagramId}-${index}`;
    index += 1;
    if (element === parsedSvg && element.id) {
      // An id rule beats a page rule such as `.slot svg { max-width: 720px }`. A class does not.
      parts.push(`#${element.id}{${body}}`);
    } else {
      const existing = element.getAttribute('class');
      element.setAttribute('class', existing ? `${existing} ${token}` : token);
      parts.push(`.${token}{${body}}`);
    }
    element.removeAttribute('style');
    moved += 1;
  }
  if (insert === 'rewrite-nonce' && diagramId === 'style-hostile') {
    parts.push(HOSTILE_BREAKOUT);
  }
  const joined = parts.join('\n');
  const scopeId = parsedSvg.id || `s04-${diagramId}`;
  const css = insert === 'rewrite-nonce' ? sanitizeDiagramCss(joined, scopeId) : joined;
  if (insert === 'rewrite-blob') {
    const live = document.importNode(parsedSvg, true);
    slot.replaceChildren(live);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    const blob = new Blob([css], { type: 'text/css' });
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);
  } else if (insert === 'rewrite-nonce') {
    const live = document.importNode(parsedSvg, true);
    slot.replaceChildren(live);
    const style = document.createElement('style');
    style.nonce = nonce;
    style.textContent = css;
    live.appendChild(style);
  } else {
    const style = parsed.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = css;
    parsedSvg.insertBefore(style, parsedSvg.firstChild);
    slot.innerHTML = new XMLSerializer().serializeToString(parsedSvg);
  }
  return { declaredMaxWidth, moved };
}

function declaredSvgMaxWidth(svg: Element | null): number | null {
  const style = svg?.getAttribute('style') ?? '';
  const match = /max-width:\s*([0-9.]+)px/i.exec(style);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function renderFormula(
  id: string,
  tex: string,
  output: FormulaResult['output'],
  slot: HTMLElement,
): FormulaResult {
  try {
    katexApi.render(tex, slot, katexOptions(output));
    const htmlRoot = slot.querySelector('.katex-html');
    const mathRoot = slot.querySelector('math');
    const visible = output === 'mathml' ? mathRoot : htmlRoot;
    const box = measureBox(visible ?? slot.querySelector('.katex'));
    const numeratorTop = textTop(visible, 'a');
    const denominatorTop = textTop(visible, 'c');
    const line = slot.querySelector('.frac-line');
    const fontElement = slot.querySelector('.katex');
    return {
      id,
      output,
      ok: box.width > 0 && box.height > 0,
      error: null,
      fontFamily: fontElement ? getComputedStyle(fontElement).fontFamily : null,
      stacked:
        numeratorTop !== null && denominatorTop !== null
          ? denominatorTop - numeratorTop > 4
          : null,
      numeratorTop,
      denominatorTop,
      lineWidth: line ? line.getBoundingClientRect().width : null,
      width: box.width,
      height: box.height,
      hrefs: [...slot.querySelectorAll('a')].map((anchor) => anchor.href),
      hasImage: slot.querySelector('img') !== null,
      styleAttributes: [...slot.querySelectorAll('[style]')]
        .map((element) => element.getAttribute('style') ?? '')
        .filter((value) => value.length > 0),
      mathml: mathRoot !== null,
    };
  } catch (error) {
    return {
      id,
      output,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      fontFamily: null,
      stacked: null,
      numeratorTop: null,
      denominatorTop: null,
      lineWidth: null,
      width: 0,
      height: 0,
      hrefs: [],
      hasImage: false,
      styleAttributes: [],
      mathml: false,
    };
  }
}

function selectedDiagrams(mode: string): Array<(typeof DIAGRAMS)[number]> {
  if (mode === 'gallery' || mode === 'nonce-inner' || mode === 'nonce-reattach') {
    return DIAGRAMS.filter((sample) => GALLERY_DIAGRAMS.has(sample.id));
  }
  if (mode === 'rewrite-nonce') {
    return DIAGRAMS.filter((sample) => CANARY_DIAGRAMS.has(sample.id) || sample.id === 'style-hostile');
  }
  if (mode === 'canary' || mode.startsWith('rewrite')) {
    return DIAGRAMS.filter((sample) => CANARY_DIAGRAMS.has(sample.id));
  }
  return [...DIAGRAMS];
}

function selectedFormulas(mode: string): Array<(typeof FORMULAS)[number]> {
  if (mode === 'gallery') {
    return FORMULAS.filter((sample) => GALLERY_FORMULAS.has(sample.id));
  }
  if (mode === 'nonce-inner' || mode === 'nonce-reattach') {
    return FORMULAS.filter((sample) => sample.id === 'fraction');
  }
  if (mode === 'canary' || mode.startsWith('rewrite')) {
    return FORMULAS.filter((sample) => CANARY_FORMULAS.has(sample.id));
  }
  return [...FORMULAS];
}

function layoutPage(mode: string, policyLabel: string): HTMLElement {
  const root = document.getElementById('s04-root');
  if (!root) {
    throw new Error('missing #s04-root');
  }
  root.replaceChildren();
  if (mode === 'gallery') {
    const heading = document.createElement('h1');
    heading.textContent = 'Mermaid and KaTeX';
    const policy = document.createElement('p');
    policy.className = 'policy';
    policy.textContent = policyLabel;
    const diagramTitle = document.createElement('h2');
    diagramTitle.textContent = 'Diagram';
    const formulaTitle = document.createElement('h2');
    formulaTitle.textContent = 'Equation';
    root.append(heading, policy, diagramTitle);
    const diagramSlot = document.createElement('div');
    diagramSlot.id = 'diagram-slot';
    diagramSlot.className = 'slot';
    root.append(diagramSlot, formulaTitle);
    const formulaSlot = document.createElement('div');
    formulaSlot.id = 'formula-slot';
    formulaSlot.className = 'slot';
    root.append(formulaSlot);
  }
  if (mode !== 'gallery') {
    const sentinel = document.createElement('div');
    sentinel.id = 's04-sentinel';
    sentinel.textContent = 'sentinel';
    const outside = document.createElement('div');
    outside.id = 's04-outside';
    outside.className = 's04-outside';
    outside.textContent = 'outside';
    root.append(sentinel, outside);
  }
  return root;
}

function hostileFormulaChecks(): { hrefBlocked: boolean; htmlExtensionRefused: boolean; macroLeaked: boolean } {
  let hrefBlocked: boolean;
  try {
    const html = katexApi.renderToString('\\href{https://example.invalid/h}{link}', katexOptions('html'));
    hrefBlocked = !html.includes('example.invalid') && !html.includes('<a ');
  } catch {
    hrefBlocked = true;
  }
  let htmlExtensionRefused = false;
  try {
    katexApi.renderToString('\\htmlStyle{color:red}{x}', katexOptions('html'));
  } catch (error) {
    htmlExtensionRefused = error instanceof Error && /html/i.test(error.message);
  }
  let macroLeaked = true;
  katexApi.renderToString('\\gdef\\zz{9}\\zz', katexOptions('html'));
  try {
    katexApi.renderToString('\\zz', katexOptions('html'));
  } catch {
    macroLeaked = false;
  }
  return { hrefBlocked, htmlExtensionRefused, macroLeaked };
}

function sheetText(diagram: DiagramResult | undefined): string {
  return (diagram?.styleElements ?? []).map((style) => style.text ?? '').join('\n');
}

function isRed(color: string | null): boolean {
  return color !== null && /255,\s*0,\s*0/.test(color.replace(/\s/g, ''));
}

function decisionCheck(diagrams: DiagramResult[]): DecisionCheck {
  const flow = diagrams.find((diagram) => diagram.id === 'flowchart');
  const hostile = diagrams.find((diagram) => diagram.id === 'style-hostile');
  const flowCss = sheetText(flow);
  const hostileCss = sheetText(hostile);
  const sentinel = document.getElementById('s04-sentinel');
  const outside = document.getElementById('s04-outside');
  const sentinelStyle = sentinel ? getComputedStyle(sentinel) : null;
  const outsideStyle = outside ? getComputedStyle(outside) : null;
  const fill = flow?.shapeFill ?? null;
  const tinted = fill !== null && fill.replace(/\s/g, '') === 'rgb(51,51,51)';
  const sized = (flow?.width ?? 0) > 160 && (flow?.width ?? 0) < 230 && (flow?.height ?? 0) > 420 && (flow?.height ?? 0) < 520;
  const forbiddenAbsent = sheetForbidsEscape(flowCss) && sheetForbidsEscape(hostileCss);
  const selectorsScoped = sheetIsScoped(flowCss, 's04-flowchart') && sheetIsScoped(hostileCss, 's04-style-hostile');
  const sentinelColor = sentinelStyle?.color ?? null;
  const sentinelDisplay = sentinelStyle?.display ?? null;
  const outsideColor = outsideStyle?.color ?? null;
  const outsideDisplay = outside ? getComputedStyle(outside).display : null;
  const outsideClean = outsideColor !== null && !isRed(outsideColor) && outsideDisplay !== 'none';
  const sentinelClean = sentinelColor !== null && !isRed(sentinelColor) && sentinelDisplay !== 'none';
  const hostileOk = hostile?.ok === true && hostile.error === null;
  const attributesGone = flow?.styleAttributeCount === 0;
  return {
    ok: sized && tinted && attributesGone && hostileOk && forbiddenAbsent && selectorsScoped && sentinelClean && outsideClean,
    flowchartWidth: flow?.width ?? 0,
    flowchartHeight: flow?.height ?? 0,
    flowchartFill: fill,
    flowchartAttributes: flow?.styleAttributeCount ?? -1,
    hostileOk,
    hostileError: hostile?.error ?? (hostile ? null : 'missing style-hostile diagram'),
    forbiddenAbsent,
    selectorsScoped,
    sentinelColor,
    sentinelDisplay,
    outsideColor,
  };
}

function mark(stage: string): void {
  console.log(stage);
}

mark('S04_BOOT');

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') ?? 'full';
  const nonce = params.get('nonce') ?? '';
  const layout = params.get('layout');
  const policyLabel = params.get('policyLabel') ?? '';
  const violations: PageReport['violations'] = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push({
      effectiveDirective: event.effectiveDirective,
      violatedDirective: event.violatedDirective,
      blockedURI: event.blockedURI,
      sample: event.sample,
      disposition: event.disposition,
      sourceFile: event.sourceFile,
      lineNumber: event.lineNumber,
    });
  });
  globalThis.__s04Pwned = 0;
  mark('S04_LOAD_LIBS');
  katexApi = (await import('katex')).default;
  mark('S04_KATEX');
  mermaidApi = (await import('mermaid')).default;
  mark('S04_MERMAID');
  configure(layout);
  mark('S04_CONFIG');
  const root = layoutPage(mode, policyLabel);
  const insert =
    mode === 'nonce-inner'
      ? 'nonce-attr'
      : mode === 'nonce-reattach'
        ? 'nonce-reattach'
        : mode === 'rewrite' || mode === 'rewrite-blob' || mode === 'rewrite-nonce'
          ? mode
          : 'html';
  const diagrams: DiagramResult[] = [];
  let afterHostileInit: Record<string, unknown> | null = null;
  for (const sample of selectedDiagrams(mode)) {
    const slot =
      mode === 'gallery' && sample.id === 'flowchart'
        ? (document.getElementById('diagram-slot') ?? root)
        : document.createElement('div');
    if (slot !== root && !slot.parentElement) {
      slot.className = 'slot';
      root.appendChild(slot);
    }
    mark(`S04_DIAGRAM ${sample.id}`);
    diagrams.push(await renderDiagram(sample, slot, insert, nonce));
    mark(`S04_DIAGRAM_DONE ${sample.id}`);
    if (sample.id === 'init-directive') {
      afterHostileInit = configSnapshot();
    }
  }
  const formulas: FormulaResult[] = [];
  for (const sample of selectedFormulas(mode)) {
    const gallerySlot = mode === 'gallery' ? document.getElementById('formula-slot') : null;
    const slot = gallerySlot ?? document.createElement('div');
    if (!slot.parentElement) {
      slot.className = 'slot';
      root.appendChild(slot);
    }
    formulas.push(renderFormula(sample.id, sample.tex, sample.output, slot));
  }
  const hostile = mode === 'nonce-inner' || mode === 'nonce-reattach' ? null : hostileFormulaChecks();
  await document.fonts.ready;
  const sentinel = document.getElementById('s04-sentinel');
  const report: PageReport = {
    fatal: null,
    mode,
    config: configSnapshot(),
    diagrams,
    formulas,
    security: {
      afterHostileInit,
      sentinelBackground: sentinel ? getComputedStyle(sentinel).backgroundColor : null,
      pwned: (globalThis.__s04Pwned ?? 0) !== 0,
      macroLeaked: hostile?.macroLeaked ?? null,
      hrefBlocked: hostile?.hrefBlocked ?? null,
      htmlExtensionRefused: hostile?.htmlExtensionRefused ?? null,
    },
    calls: globalThis.__s04Calls ?? [],
    violations,
    fonts: {
      katexMain: document.fonts.check('16px KaTeX_Main'),
      ready: document.fonts.status === 'loaded',
    },
    decision: mode === 'rewrite-nonce' ? decisionCheck(diagrams) : null,
  };
  globalThis.__s04Report = report;
  console.log(`S04_DONE ${mode}`);
}

main().catch((error: unknown) => {
  globalThis.__s04Report = {
    fatal: error instanceof Error ? (error.stack ?? error.message) : String(error),
    mode: 'fatal',
    config: null,
    diagrams: [],
    formulas: [],
    security: {
      afterHostileInit: null,
      sentinelBackground: null,
      pwned: false,
      macroLeaked: null,
      hrefBlocked: null,
      htmlExtensionRefused: null,
    },
    calls: globalThis.__s04Calls ?? [],
    violations: [],
    fonts: { katexMain: false, ready: false },
    decision: null,
  };
  console.log('S04_DONE fatal');
});
