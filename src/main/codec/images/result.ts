// Reasons an image entry is refused after the schema has passed. The wording
// is what the open path shows. No pixel buffer is allocated for any of them.

export const IMAGE_REASONS = [
  'type-mismatch',
  'header-too-large',
  'svg',
  'not-in-manifest',
  'missing-entry',
  'hash-mismatch',
  'too-many-frames',
  'pixel-budget',
  'frame-outside',
  'manifest-mismatch',
  'bad-image',
] as const;

export type ImageReason = (typeof IMAGE_REASONS)[number];

const IMAGE_MESSAGES: Record<ImageReason, string> = {
  'type-mismatch': 'An image does not match its type, so it was not opened.',
  'header-too-large': 'An image is over 8000 by 8000 pixels, so it was not opened.',
  svg: 'An SVG image is not allowed, so it was not opened.',
  'not-in-manifest': 'An image is not in the manifest, so it was not opened.',
  'missing-entry': 'An image in the manifest has no file, so it was not opened.',
  'hash-mismatch': 'An image hash does not match its bytes, so it was not opened.',
  'too-many-frames': 'An image has over 1,000 frames, so it was not opened.',
  'pixel-budget': 'An image is over 250 million pixels, so it was not opened.',
  'frame-outside': 'An image frame is outside the image, so it was not opened.',
  'manifest-mismatch': 'An image does not match the manifest, so it was not opened.',
  'bad-image': 'An image could not be read, so it was not opened.',
};

export interface ImageFailure {
  ok: false;
  reason: ImageReason;
  path: string;
  message: string;
}

export type ImageResult = { ok: true } | ImageFailure;

export function imageMessage(reason: ImageReason): string {
  return IMAGE_MESSAGES[reason];
}

export function imageFailure(reason: ImageReason, entryPath: string): ImageFailure {
  return { ok: false, reason, path: entryPath, message: imageMessage(reason) };
}
