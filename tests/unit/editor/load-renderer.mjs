import { register } from 'node:module';

register(new URL('./renderer-hooks.mjs', import.meta.url));

export function loadRenderer(specifier) {
  return import(specifier);
}
