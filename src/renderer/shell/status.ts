export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

export function characterCount(text: string): number {
  return text.length;
}

function countLabel(count: number, singular: string, plural: string): string {
  const amount = count.toLocaleString('en-US');
  return `${amount} ${count === 1 ? singular : plural}`;
}

export function statusLabel(text: string): string {
  const words = wordCount(text);
  const characters = characterCount(text);
  return [
    'Page 1 of 1',
    countLabel(words, 'word', 'words'),
    countLabel(characters, 'character', 'characters'),
    '100%',
    'Not saved',
  ].join(' - ');
}
