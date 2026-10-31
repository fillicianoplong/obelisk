import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'src/shared/schema/document.schema.json');
const typesPath = path.join(root, 'src/shared/schema/types.ts');
const dataPath = path.join(root, 'src/shared/schema/schema-data.ts');

const header = '/* Generated from document.schema.json by scripts/generate-schema-types.mjs. Do not edit. */\n\n';

function literal(value) {
  return JSON.stringify(value);
}

function definitionName(schema, ref) {
  const prefix = '#/$defs/';
  if (!ref.startsWith(prefix)) {
    throw new Error(`Unsupported schema ref ${ref}`);
  }
  const key = ref.slice(prefix.length);
  const definition = schema.$defs?.[key];
  if (!definition?.title) {
    throw new Error(`Schema definition ${key} needs a title`);
  }
  return definition.title;
}

function propertyType(schema, property) {
  if (property.$ref) {
    return definitionName(schema, property.$ref);
  }
  if (property.const !== undefined) {
    return literal(property.const);
  }
  if (property.enum) {
    return property.enum.map(literal).join(' | ');
  }
  if (property.oneOf) {
    return property.oneOf.map((part) => propertyType(schema, part)).join(' | ');
  }
  if (property.type === 'array') {
    if (!property.items) {
      throw new Error('Array schema needs items');
    }
    const item = propertyType(schema, property.items);
    return item.includes('|') ? `(${item})[]` : `${item}[]`;
  }
  if (property.type === 'string') {
    return 'string';
  }
  if (property.type === 'boolean') {
    return 'boolean';
  }
  if (property.type === 'number' || property.type === 'integer') {
    return 'number';
  }
  throw new Error(`Unsupported property shape ${JSON.stringify(property)}`);
}

function emitDefinition(schema, definition) {
  const name = definition.title;
  if (!name) {
    throw new Error('Schema definition needs a title');
  }
  if (definition.oneOf) {
    const parts = definition.oneOf.map((part) => {
      if (!part.$ref) {
        throw new Error(`${name} oneOf entries must be refs`);
      }
      return definitionName(schema, part.$ref);
    });
    return `export type ${name} =\n${parts.map((part) => `  | ${part}`).join('\n')};\n`;
  }
  if (definition.type === 'object') {
    const required = new Set(definition.required ?? []);
    const lines = Object.entries(definition.properties ?? {}).map(([key, property]) => {
      const optional = required.has(key) ? '' : '?';
      return `  ${key}${optional}: ${propertyType(schema, property)};`;
    });
    return `export interface ${name} {\n${lines.join('\n')}\n}\n`;
  }
  if (definition.enum) {
    return `export type ${name} = ${definition.enum.map(literal).join(' | ')};\n`;
  }
  return `export type ${name} = ${propertyType(schema, definition)};\n`;
}

export function generateSources(schema) {
  const types = Object.values(schema.$defs ?? {}).map((definition) => emitDefinition(schema, definition));
  const typesSource = `${header}${types.join('\n')}`;
  const dataSource = `${header}import type { JsonSchema } from './validate.js';\n\nexport const documentSchema: JsonSchema = ${JSON.stringify(schema, null, 2)};\n`;
  return { typesSource, dataSource };
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const { typesSource, dataSource } = generateSources(schema);
  const check = process.argv.includes('--check');
  if (check) {
    const normalize = (text) => text.replaceAll('\r\n', '\n');
    const typesMatch = normalize(readFileSync(typesPath, 'utf8')) === normalize(typesSource);
    const dataMatch = normalize(readFileSync(dataPath, 'utf8')) === normalize(dataSource);
    if (!typesMatch || !dataMatch) {
      console.error('Generated schema files are out of date. Run node scripts/generate-schema-types.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(typesPath, typesSource);
    writeFileSync(dataPath, dataSource);
  }
}
