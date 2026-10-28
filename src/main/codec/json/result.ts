// Reasons the strict JSON parser refuses a manifest.json or document.json.
// The wording is what the open path shows. A byte order mark is not an error.

export const JSON_REASONS = [
  'duplicate-key',
  'not-finite',
  'unpaired-surrogate',
  'invalid-json',
  'invalid-utf8',
] as const;

export type JsonReason = (typeof JSON_REASONS)[number];

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const JSON_MESSAGES: Record<JsonReason, string> = {
  'duplicate-key': 'A key is repeated.',
  'not-finite': 'A number is not finite.',
  'unpaired-surrogate': 'Text has an unpaired surrogate.',
  'invalid-json': 'The text is not valid JSON.',
  'invalid-utf8': 'The text is not valid UTF-8.',
};

export interface JsonFailure {
  ok: false;
  reason: JsonReason;
  path: string;
  message: string;
}

export type JsonResult = { ok: true; value: JsonValue } | JsonFailure;

export function failure(reason: JsonReason, path: string): JsonFailure {
  return { ok: false, reason, path, message: JSON_MESSAGES[reason] };
}

export function jsonFileMessage(entry: string, reason: JsonReason): string {
  switch (reason) {
    case 'duplicate-key':
      return `${entry} has a duplicate key, so it was not opened.`;
    case 'not-finite':
      return `${entry} has a number that is not finite, so it was not opened.`;
    case 'unpaired-surrogate':
      return `${entry} has an unpaired surrogate, so it was not opened.`;
    case 'invalid-utf8':
      return `${entry} is not valid UTF-8, so it was not opened.`;
    case 'invalid-json':
      return `${entry} is not valid JSON, so it was not opened.`;
    default: {
      const unexpected: never = reason;
      return unexpected;
    }
  }
}
