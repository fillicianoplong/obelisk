import fs from 'node:fs';
import path from 'node:path';

export const USER_DICTIONARY_FILE = 'dictionary.json';

const WORD_MAX = 64;

export function userDictionaryPath(userDataDir: string): string {
  return path.join(userDataDir, USER_DICTIONARY_FILE);
}

function acceptedWord(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const word = value;
  const hasWhitespace = [...word].some((char) => char.trim() === '');
  if (word.length < 1 || word.length > WORD_MAX || hasWhitespace) {
    return null;
  }
  return word;
}

export function readUserWords(userDataDir: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(userDictionaryPath(userDataDir), 'utf8');
  } catch {
    return [];
  }
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  const words = (parsed as { words?: unknown }).words;
  if (!Array.isArray(words)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of words) {
    const word = acceptedWord(item);
    if (word === null || seen.has(word)) {
      continue;
    }
    seen.add(word);
    out.push(word);
  }
  return out;
}

export function addUserWord(userDataDir: string, word: string): string[] {
  const accepted = acceptedWord(word);
  if (accepted === null) {
    return readUserWords(userDataDir);
  }
  const words = readUserWords(userDataDir);
  if (!words.includes(accepted)) {
    words.push(accepted);
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(userDictionaryPath(userDataDir), `${JSON.stringify({ words })}\n`, 'utf8');
  return words;
}
