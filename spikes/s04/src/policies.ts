export interface PolicySpec {
  id: string;
  styleDirectives: readonly string[];
  note: string;
}

export const POLICY_SPECS: readonly PolicySpec[] = [
  {
    id: 'baseline',
    styleDirectives: ["style-src app:"],
    note: 'The app CSP from src/main/security/csp.ts.',
  },
  {
    id: 'attr-inline',
    styleDirectives: ["style-src-elem app:", "style-src-attr 'unsafe-inline'"],
    note: 'Stylesheets from app: only. Style attributes allowed. No style-src, so elem and attr do not fall back.',
  },
  {
    id: 'elem-inline',
    styleDirectives: ["style-src-elem app: 'unsafe-inline'", "style-src-attr 'none'"],
    note: 'Inline style elements allowed. Style attributes blocked.',
  },
  {
    id: 'both-inline',
    styleDirectives: [
      "style-src-elem app: 'unsafe-inline'",
      "style-src-attr 'unsafe-inline'",
    ],
    note: 'Inline style elements and style attributes allowed, as two directives.',
  },
  {
    id: 'style-src-inline',
    styleDirectives: ["style-src app: 'unsafe-inline'"],
    note: "One style-src directive. style-src-elem and style-src-attr fall back to it, so both inline elements and attributes are allowed.",
  },
];

export function policyHeader(appPolicy: string, styleDirectives: readonly string[]): string {
  const parts = appPolicy
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('style-src'));
  const scriptAt = parts.findIndex((part) => part.startsWith('script-src'));
  parts.splice(scriptAt + 1, 0, ...styleDirectives);
  return parts.join('; ');
}

export function noncePolicy(appPolicy: string, nonce: string): string {
  return policyHeader(appPolicy, [
    `style-src-elem app: 'nonce-${nonce}'`,
    "style-src-attr 'none'",
  ]);
}

export function hashElementPolicy(appPolicy: string, hashes: readonly string[]): string {
  const sources = hashes.map((hash) => `'sha256-${hash}'`).join(' ');
  return policyHeader(appPolicy, [
    `style-src-elem app: ${sources}`,
    "style-src-attr 'none'",
  ]);
}

export function blobStylesheetPolicy(appPolicy: string): string {
  return policyHeader(appPolicy, ["style-src-elem app: blob:", "style-src-attr 'none'"]);
}

export function hashAttributePolicy(appPolicy: string, hashes: readonly string[]): string {
  const sources = hashes.map((hash) => `'sha256-${hash}'`).join(' ');
  return policyHeader(appPolicy, [
    'style-src-elem app:',
    `style-src-attr 'unsafe-hashes' ${sources}`,
  ]);
}
