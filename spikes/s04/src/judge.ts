export interface DiagramResult {
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
  styleElements: Array<{
    length: number;
    sha256: string;
    hasDiagramId: boolean;
    head: string;
    text: string | null;
  }>;
  styleAttributeCount: number;
  rewrittenAttributes: number;
  declaredMaxWidth: number | null;
  remoteStyleUrls: string[];
}

export interface FormulaResult {
  id: string;
  output: string;
  ok: boolean;
  error: string | null;
  fontFamily: string | null;
  stacked: boolean | null;
  lineWidth: number | null;
  width: number;
  height: number;
  hrefs: string[];
  hasImage: boolean;
  styleAttributes: string[];
  mathml: boolean;
}

export interface PageReport {
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
  calls: Array<{ kind: string; body: string }>;
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

export interface DecisionCheck {
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

export interface LoggedRequest {
  url: string;
  method: string;
  resourceType: string;
  cancelled: boolean;
}

export function findDiagram(report: PageReport, id: string): DiagramResult | undefined {
  return report.diagrams.find((diagram) => diagram.id === id);
}

export function findFormula(report: PageReport, id: string): FormulaResult | undefined {
  return report.formulas.find((formula) => formula.id === id);
}

function untinted(fill: string | null): boolean {
  if (!fill) {
    return true;
  }
  const value = fill.replace(/\s/g, '').toLowerCase();
  return (
    value === 'none' ||
    value === 'rgb(0,0,0)' ||
    value === '#000' ||
    value === '#000000' ||
    value === 'rgba(0,0,0,0)' ||
    value === 'rgba(0,0,0,1)' ||
    value === 'transparent'
  );
}

export function flowchartReadable(diagram: DiagramResult | undefined): boolean {
  if (!diagram?.ok || diagram.declaredMaxWidth === null) {
    return false;
  }
  const text = diagram.texts.join(' ');
  const labeled = text.includes('Start') && text.includes('Done') && text.includes('Ready');
  const laidOut = diagram.width > 40 && diagram.height > 40 && diagram.width <= diagram.declaredMaxWidth * 1.2;
  return labeled && laidOut && !untinted(diagram.shapeFill);
}

export function formulaReadable(formula: FormulaResult | undefined): boolean {
  if (!formula?.ok || formula.stacked !== true) {
    return false;
  }
  return (formula.fontFamily ?? '').includes('KaTeX') && (formula.lineWidth ?? 0) > 4;
}

export function mathmlReadable(formula: FormulaResult | undefined): boolean {
  if (!formula?.ok || !formula.mathml || formula.stacked !== true) {
    return false;
  }
  return formula.width > 10 && formula.height > 10;
}

export function violationCounts(report: PageReport): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of report.violations) {
    const key = violation.effectiveDirective || violation.violatedDirective;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function dynamicCodeKinds(report: PageReport): string[] {
  return [...new Set(report.calls.map((call) => call.kind))];
}

const RED = new Set(['rgb(255, 0, 0)', 'rgb(255,0,0)', 'rgba(255, 0, 0, 1)', '#ff0000', 'red']);

export interface SecurityFacts {
  pwned: boolean;
  securityLevel: unknown;
  htmlLabels: unknown;
  theme: unknown;
  fontFamily: unknown;
  themeCSS: unknown;
  altFontFamily: unknown;
  sentinelBackground: string | null;
  sentinelPainted: boolean;
  htmlLabelScripts: number;
  htmlLabelImages: number;
  clickHrefs: string[];
  clickHandlers: string[];
  macroLeaked: boolean | null;
  hrefBlocked: boolean | null;
  htmlExtensionRefused: boolean | null;
  remoteStyleUrls: string[];
}

export function securityFacts(report: PageReport): SecurityFacts {
  const htmlLabel = findDiagram(report, 'html-label');
  const click = findDiagram(report, 'click');
  const init = report.security.afterHostileInit;
  const remote = report.diagrams.flatMap((diagram) => diagram.remoteStyleUrls);
  const sentinel = report.security.sentinelBackground;
  return {
    pwned: report.security.pwned,
    securityLevel: init?.securityLevel ?? report.config?.securityLevel ?? null,
    htmlLabels: init?.htmlLabels ?? report.config?.htmlLabels ?? null,
    theme: init?.theme ?? report.config?.theme ?? null,
    fontFamily: init?.fontFamily ?? report.config?.fontFamily ?? null,
    themeCSS: init?.themeCSS ?? report.config?.themeCSS ?? null,
    altFontFamily: init?.altFontFamily ?? report.config?.altFontFamily ?? null,
    sentinelBackground: sentinel,
    sentinelPainted: sentinel !== null && RED.has(sentinel.replace(/\s/g, '').toLowerCase()),
    htmlLabelScripts: htmlLabel?.scriptElements ?? 0,
    htmlLabelImages: htmlLabel?.imageElements ?? 0,
    clickHrefs: click?.hrefs ?? [],
    clickHandlers: click?.eventHandlers ?? [],
    macroLeaked: report.security.macroLeaked,
    hrefBlocked: report.security.hrefBlocked,
    htmlExtensionRefused: report.security.htmlExtensionRefused,
    remoteStyleUrls: [...new Set(remote)],
  };
}

export function blockedNetwork(requests: readonly LoggedRequest[]): string[] {
  return requests.filter((request) => request.cancelled).map((request) => request.url);
}

export function allowedProtocols(requests: readonly LoggedRequest[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const request of requests) {
    let protocol: string;
    try {
      protocol = new URL(request.url).protocol;
    } catch {
      protocol = 'invalid';
    }
    counts[protocol] = (counts[protocol] ?? 0) + 1;
  }
  return counts;
}

export interface RunRecord {
  id: string;
  mode: string;
  policy: string;
  report: PageReport;
  requests: LoggedRequest[];
}

export interface RunFacts {
  id: string;
  mode: string;
  flowchart: boolean;
  fraction: boolean;
  mathml: boolean;
  katexFont: boolean;
  violations: Record<string, number>;
  dynamicCode: string[];
  blockedNetwork: string[];
  protocols: Record<string, number>;
  security: SecurityFacts | null;
}

const SHIPPABLE = ['baseline', 'attr-inline', 'elem-inline', 'both-inline', 'style-src-inline'] as const;

export function runFacts(run: RunRecord): RunFacts {
  const fraction = findFormula(run.report, 'fraction') ?? findFormula(run.report, 'fraction-both');
  const mathml = findFormula(run.report, 'fraction-mathml');
  const security = run.report.diagrams.some((diagram) => diagram.id === 'init-directive')
    ? securityFacts(run.report)
    : null;
  return {
    id: run.id,
    mode: run.mode,
    flowchart: flowchartReadable(findDiagram(run.report, 'flowchart')),
    fraction: formulaReadable(fraction),
    mathml: mathmlReadable(mathml),
    katexFont: run.report.fonts.katexMain,
    violations: violationCounts(run.report),
    dynamicCode: dynamicCodeKinds(run.report),
    blockedNetwork: blockedNetwork(run.requests),
    protocols: allowedProtocols(run.requests),
    security,
  };
}

export function strictestShippable(runs: readonly RunRecord[]): string | null {
  for (const id of SHIPPABLE) {
    const facts = runs.filter((run) => run.id === id).map(runFacts);
    if (facts.some((fact) => fact.flowchart && fact.fraction)) {
      return id;
    }
  }
  return null;
}

export type SpikeOutcome = 'pass' | 'judgement' | 'fail';

export function outcomeOf(runs: readonly RunRecord[]): SpikeOutcome {
  const facts = runs.map(runFacts);
  const anyNetwork = facts.some((fact) => fact.blockedNetwork.length > 0);
  const anyDynamic = facts.some((fact) => fact.dynamicCode.length > 0);
  const security = facts.map((fact) => fact.security).find((item) => item !== null) ?? null;
  const securityBroken =
    security !== null &&
    (security.pwned ||
      security.sentinelPainted ||
      security.htmlLabelScripts > 0 ||
      security.htmlLabelImages > 0 ||
      security.clickHandlers.length > 0 ||
      security.macroLeaked === true ||
      security.hrefBlocked === false ||
      security.htmlExtensionRefused === false ||
      (security.securityLevel !== null && security.securityLevel !== 'strict') ||
      security.htmlLabels === true ||
      (security.theme !== null && security.theme !== 'default') ||
      (security.fontFamily !== null && security.fontFamily !== 'sans-serif') ||
      (typeof security.themeCSS === 'string' && security.themeCSS.length > 0) ||
      security.remoteStyleUrls.length > 0);
  const dynamicBlockedRender = anyDynamic && strictestShippable(runs) === null && !facts.some((fact) => fact.flowchart);
  if (anyNetwork || securityBroken || dynamicBlockedRender) {
    return 'fail';
  }
  const baseline = facts.find((fact) => fact.id === 'baseline' && fact.mode === 'full') ?? facts.find((fact) => fact.id === 'baseline');
  if (baseline?.flowchart && baseline.fraction) {
    return 'pass';
  }
  if (strictestShippable(runs) !== null) {
    return 'judgement';
  }
  const nonce = facts.find((fact) => fact.id === 'nonce-reattach');
  if (nonce?.flowchart) {
    return 'judgement';
  }
  return 'fail';
}
