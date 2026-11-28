const CLICK_LINE = /^\s*click\s+/i;

/** Approved 27 October 2026: strip click lines and href values before Mermaid sees the source. */
export function sanitizeDiagramSource(source: string): string {
  const kept: string[] = [];
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    if (CLICK_LINE.test(line)) {
      continue;
    }
    const withoutHref = line.replace(/\bhref\s*[:=]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gi, '');
    kept.push(withoutHref);
  }
  return kept.join('\n');
}