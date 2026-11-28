import { DIAGRAM_STYLE_NONCE } from './style-nonce.js';

// Architecture section 6.4. base-uri, form-action, and frame-ancestors do not
// fall back to default-src, so they are set to 'none' as well.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src app:",
  "style-src app:",
  `style-src-elem app: 'nonce-${DIAGRAM_STYLE_NONCE}'`,
  "style-src-attr 'none'",
  "font-src app:",
  "img-src app: data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
