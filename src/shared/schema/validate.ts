import { failure, type SchemaFailure } from './result.js';

const METADATA = new Set(['$schema', '$id', '$defs', 'title', 'description']);

const KEYWORDS = new Set([
  ...METADATA,
  '$ref',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'enum',
  'const',
  'oneOf',
]);

export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: { [name: string]: JsonSchema };
  title?: string;
  description?: string;
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: { [name: string]: JsonSchema };
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: readonly (string | number | boolean | null)[];
  const?: string | number | boolean | null;
  oneOf?: JsonSchema[];
}

export function characterLength(value: string): number {
  return [...value].length;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function joinPath(path: string, key: string | number): string {
  return `${path}/${key}`;
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  const prefix = '#/$defs/';
  if (!ref.startsWith(prefix)) {
    throw new Error(`Unsupported schema ref ${ref}`);
  }
  const name = ref.slice(prefix.length);
  const found = root.$defs?.[name];
  if (!found) {
    throw new Error(`Missing schema definition ${name}`);
  }
  return found;
}

function dereference(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let current = schema;
  const seen = new Set<JsonSchema>();
  while (current.$ref) {
    if (seen.has(current)) {
      throw new Error(`Schema cycle at ${current.$ref}`);
    }
    seen.add(current);
    current = resolveRef(current.$ref, root);
  }
  return current;
}

function assertKeywords(schema: JsonSchema): void {
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) {
      throw new Error(`Unsupported schema keyword ${key}`);
    }
  }
}

function wrongType(path: string, expected: string): SchemaFailure {
  return failure('wrong-type', path, `Expected ${expected}.`);
}

function checkEnum(schema: JsonSchema, value: unknown, path: string): SchemaFailure | null {
  if (!schema.enum) {
    return null;
  }
  if (schema.enum.some((item) => item === value)) {
    return null;
  }
  const expected = schema.enum.length > 0 ? typeof schema.enum[0] : 'string';
  if (schema.enum.every((item) => typeof item === expected) && typeof value !== expected) {
    return wrongType(path, `a ${expected}`);
  }
  return failure('out-of-range', path, 'Value is outside the allowed set.');
}

function checkConst(schema: JsonSchema, value: unknown, path: string): SchemaFailure | null {
  if (schema.const === undefined || schema.const === value) {
    return null;
  }
  if (typeof value !== typeof schema.const) {
    return wrongType(path, `a ${typeof schema.const}`);
  }
  return failure('out-of-range', path, 'Value is outside the allowed set.');
}

function checkDeclaredType(schema: JsonSchema, value: unknown, path: string): SchemaFailure | null {
  switch (schema.type) {
    case undefined:
      return null;
    case 'object':
      return isPlainRecord(value) ? null : wrongType(path, 'an object');
    case 'array':
      return Array.isArray(value) ? null : wrongType(path, 'an array');
    case 'string':
      return typeof value === 'string' ? null : wrongType(path, 'a string');
    case 'boolean':
      return typeof value === 'boolean' ? null : wrongType(path, 'a boolean');
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : wrongType(path, 'a number');
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value) ? null : wrongType(path, 'an integer');
    case 'null':
      return value === null ? null : wrongType(path, 'null');
    default: {
      const unexpected: never = schema.type;
      throw new Error(`Unsupported type ${String(unexpected)}`);
    }
  }
}

function isMultiple(value: number, divisor: number): boolean {
  const quotient = value / divisor;
  return Math.abs(quotient - Math.round(quotient)) < 1e-8;
}

function checkNumber(schema: JsonSchema, value: number, path: string): SchemaFailure | null {
  if (schema.minimum !== undefined && value < schema.minimum) {
    return failure('out-of-range', path, 'Value is below the minimum.');
  }
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
    return failure('out-of-range', path, 'Value is below the minimum.');
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    return failure('out-of-range', path, 'Value is above the maximum.');
  }
  if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
    return failure('out-of-range', path, 'Value is above the maximum.');
  }
  if (schema.multipleOf !== undefined && !isMultiple(value, schema.multipleOf)) {
    return failure('out-of-range', path, 'Value is not an allowed step.');
  }
  return null;
}

function checkString(schema: JsonSchema, value: string, path: string): SchemaFailure | null {
  if (hasUnpairedSurrogate(value)) {
    return failure('invalid', path, 'Text has an unpaired surrogate.');
  }
  const length = characterLength(value);
  if (schema.minLength !== undefined && length < schema.minLength) {
    return failure('out-of-range', path, 'Text is shorter than the minimum.');
  }
  if (schema.maxLength !== undefined && length > schema.maxLength) {
    return failure('out-of-range', path, 'Text is longer than the maximum.');
  }
  if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
    return failure('invalid', path, 'Text does not match the required pattern.');
  }
  return null;
}

function sharedConstKeys(schemas: JsonSchema[]): string[] {
  if (schemas.length === 0) {
    return [];
  }
  const keys = Object.keys(schemas[0]?.properties ?? {});
  return keys.filter((key) => schemas.every((schema) => schema.properties?.[key]?.const !== undefined));
}

function narrowOneOf(
  schemas: JsonSchema[],
  value: unknown,
  path: string,
): { schemas: JsonSchema[] } | SchemaFailure {
  if (!isPlainRecord(value)) {
    return { schemas };
  }
  let current = schemas;
  while (current.length > 1) {
    const keys = sharedConstKeys(current);
    if (keys.length === 0) {
      break;
    }
    let progressed = false;
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) {
        return failure('missing-field', joinPath(path, key), `Missing ${key}.`);
      }
      const actual = value[key];
      const next = current.filter((schema) => schema.properties?.[key]?.const === actual);
      if (next.length === 0) {
        const expected = current[0]?.properties?.[key]?.const;
        if (typeof actual !== typeof expected) {
          return wrongType(joinPath(path, key), `a ${typeof expected}`);
        }
        return failure('out-of-range', joinPath(path, key), `${key} is not a known value.`);
      }
      if (next.length < current.length) {
        progressed = true;
      }
      current = next;
      if (current.length === 1) {
        return { schemas: current };
      }
    }
    if (!progressed) {
      break;
    }
  }
  return { schemas: current };
}

function validateOneOf(options: JsonSchema[], value: unknown, path: string, root: JsonSchema): SchemaFailure | null {
  const resolved = options.map((option) => dereference(option, root));
  const narrowed = narrowOneOf(resolved, value, path);
  if (!('schemas' in narrowed)) {
    return narrowed;
  }
  if (narrowed.schemas.length === 1) {
    const only = narrowed.schemas[0];
    if (!only) {
      return failure('invalid', path, 'Value did not match.');
    }
    return validateNode(only, value, path, root);
  }
  let passed = 0;
  let firstFailure: SchemaFailure | null = null;
  for (const option of narrowed.schemas) {
    const issue = validateNode(option, value, path, root);
    if (!issue) {
      passed += 1;
      if (passed > 1) {
        return failure('invalid', path, 'Value matched more than one shape.');
      }
      continue;
    }
    if (!firstFailure) {
      firstFailure = issue;
    }
  }
  if (passed === 1) {
    return null;
  }
  return firstFailure ?? failure('invalid', path, 'Value did not match.');
}

function validateObject(schema: JsonSchema, value: unknown, path: string, root: JsonSchema): SchemaFailure | null {
  if (!isPlainRecord(value)) {
    return wrongType(path, 'an object');
  }
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) {
      return failure('missing-field', joinPath(path, key), `Missing ${key}.`);
    }
  }
  const properties = schema.properties ?? {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        return failure('unknown-field', joinPath(path, key), `Unknown field ${key}.`);
      }
    }
  }
  for (const key of Object.keys(value)) {
    const property = properties[key];
    if (!property) {
      continue;
    }
    const issue = validateNode(property, value[key], joinPath(path, key), root);
    if (issue) {
      return issue;
    }
  }
  return null;
}

function validateArray(schema: JsonSchema, value: unknown, path: string, root: JsonSchema): SchemaFailure | null {
  if (!Array.isArray(value)) {
    return wrongType(path, 'an array');
  }
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    return failure('out-of-range', path, 'Too few items.');
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    return failure('out-of-range', path, 'Too many items.');
  }
  if (!schema.items) {
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const issue = validateNode(schema.items, value[index], joinPath(path, index), root);
    if (issue) {
      return issue;
    }
  }
  return null;
}

function validateNode(schema: JsonSchema, value: unknown, path: string, root: JsonSchema): SchemaFailure | null {
  assertKeywords(schema);
  if (schema.$ref) {
    return validateNode(resolveRef(schema.$ref, root), value, path, root);
  }
  if (schema.oneOf) {
    return validateOneOf(schema.oneOf, value, path, root);
  }
  const enumIssue = checkEnum(schema, value, path);
  if (enumIssue) {
    return enumIssue;
  }
  const constIssue = checkConst(schema, value, path);
  if (constIssue) {
    return constIssue;
  }
  const declared = checkDeclaredType(schema, value, path);
  if (declared) {
    return declared;
  }
  if (schema.type === 'object' || schema.properties || schema.required || schema.additionalProperties === false) {
    const issue = validateObject(schema, value, path, root);
    if (issue) {
      return issue;
    }
  }
  if (schema.type === 'array' || schema.items || schema.minItems !== undefined || schema.maxItems !== undefined) {
    const issue = validateArray(schema, value, path, root);
    if (issue) {
      return issue;
    }
  }
  if (typeof value === 'string' && (schema.type === 'string' || schema.minLength !== undefined || schema.maxLength !== undefined || schema.pattern !== undefined)) {
    const issue = checkString(schema, value, path);
    if (issue) {
      return issue;
    }
  }
  if (typeof value === 'number' && (schema.type === 'number' || schema.type === 'integer' || schema.minimum !== undefined || schema.maximum !== undefined || schema.exclusiveMinimum !== undefined || schema.exclusiveMaximum !== undefined || schema.multipleOf !== undefined)) {
    const issue = checkNumber(schema, value, path);
    if (issue) {
      return issue;
    }
  }
  return null;
}

export function validateWith(schema: JsonSchema, value: unknown): SchemaFailure | null {
  return validateNode(schema, value, '', schema);
}
