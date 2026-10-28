import { documentSchema } from '../../../shared/schema/index.js';

// Architecture 6.6: writes use a fixed key order, so the same document gives
// the same bytes. The order is the format 1 schema's property order.

interface SchemaNode {
  $ref?: string;
  $defs?: { [name: string]: SchemaNode };
  properties?: { [name: string]: SchemaNode };
  items?: SchemaNode;
  oneOf?: SchemaNode[];
  const?: unknown;
}

const SCHEMA = documentSchema as SchemaNode;

function resolveRef(ref: string): SchemaNode {
  const prefix = '#/$defs/';
  if (!ref.startsWith(prefix)) {
    throw new Error(`Unsupported schema reference ${ref}.`);
  }
  const name = ref.slice(prefix.length);
  const schema = SCHEMA.$defs?.[name];
  if (!schema) {
    throw new Error(`Missing schema definition ${name}.`);
  }
  if (schema.$ref) {
    return resolveRef(schema.$ref);
  }
  return schema;
}

function resolve(schema: SchemaNode): SchemaNode {
  return schema.$ref ? resolveRef(schema.$ref) : schema;
}

function branchMatches(value: unknown, schema: SchemaNode): boolean {
  const resolved = resolve(schema);
  if (resolved.oneOf) {
    return resolved.oneOf.some((option) => branchMatches(value, option));
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return !resolved.properties;
  }
  const record = value as { [key: string]: unknown };
  const properties = resolved.properties ?? {};
  for (const key of Object.keys(properties)) {
    const property = properties[key];
    if (!property) {
      continue;
    }
    const child = resolve(property);
    if (Object.hasOwn(child, 'const') && record[key] !== child.const) {
      return false;
    }
  }
  return true;
}

function concrete(schema: SchemaNode, value: unknown): SchemaNode {
  const resolved = resolve(schema);
  if (!resolved.oneOf) {
    return resolved;
  }
  for (const option of resolved.oneOf) {
    if (branchMatches(value, option)) {
      return resolve(option);
    }
  }
  throw new Error('No schema branch matched.');
}

function stringify(value: unknown, schema: SchemaNode): string {
  const current = concrete(schema, value);
  if (Array.isArray(value)) {
    if (!current.items) {
      throw new Error('An array has no item schema.');
    }
    const itemSchema = current.items;
    return `[${value.map((item) => stringify(item, itemSchema)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const properties = current.properties;
    if (!properties) {
      throw new Error('An object has no properties in the schema.');
    }
    const record = value as { [key: string]: unknown };
    const parts: string[] = [];
    for (const key of Object.keys(properties)) {
      if (!Object.hasOwn(record, key) || record[key] === undefined) {
        continue;
      }
      const property = properties[key];
      if (!property) {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${stringify(record[key], property)}`);
    }
    return `{${parts.join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('A number is not finite.');
  }
  const text = JSON.stringify(value);
  if (typeof text !== 'string') {
    throw new Error('A value could not be written as JSON.');
  }
  return text;
}

function definition(name: string): SchemaNode {
  const schema = SCHEMA.$defs?.[name];
  if (!schema) {
    throw new Error(`Missing schema definition ${name}.`);
  }
  return schema;
}

export function canonicalDocumentJson(value: unknown): string {
  return stringify(value, definition('document'));
}

export function canonicalManifestJson(value: unknown): string {
  return stringify(value, definition('manifest'));
}
