import fs from 'node:fs';
import path from 'node:path';

export function readAppContentSecurityPolicy(repoRoot: string): string {
  const source = fs.readFileSync(path.join(repoRoot, 'src', 'main', 'security', 'csp.ts'), 'utf8');
  const arrayMatch = source.match(
    /export const CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]\.join\(';\s*'\)/,
  );
  if (!arrayMatch) {
    throw new Error('Could not read CONTENT_SECURITY_POLICY from src/main/security/csp.ts.');
  }
  const parts = [...arrayMatch[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  if (parts.length < 8) {
    throw new Error('src/main/security/csp.ts did not contain the expected directives.');
  }
  return parts.join('; ');
}
