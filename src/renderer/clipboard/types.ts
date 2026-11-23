import type { Block } from '../../shared/schema/types.js';

/** Clipboard flavors the sanitizer accepts. Plain text ignores HTML and images. */
export interface PasteInput {
  html?: string;
  text?: string;
  image?: Uint8Array;
  alt?: string;
  plain?: boolean;
}

export interface SanitizeOptions {
  ids?: () => string;
  /**
   * Parses HTML into a detached document. Tests pass a parser; the editor
   * uses DOMParser and never inserts the tree into the page.
   */
  parseHtml?: (html: string) => Document;
}

export interface PastedImageAsset {
  sha256: string;
  bytes: Uint8Array;
  type: 'png' | 'jpeg' | 'gif' | 'webp';
  pixelWidth: number;
  pixelHeight: number;
  frames: number;
}

export interface SanitizedPaste {
  blocks: Block[];
  images: PastedImageAsset[];
}
