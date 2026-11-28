// User-facing refusals when an image is inserted or picked, not opened from a file.

export const IMAGE_INSERT_TOO_LARGE =
  'An image is over 20 MB, so it was not inserted.';

export const IMAGE_INSERT_DIMENSIONS =
  'An image is over 8000 by 8000 pixels, so it was not inserted.';

export const IMAGE_INSERT_BAD =
  'This image could not be read, so it was not inserted.';

export const IMAGE_INSERT_SVG =
  'An SVG image is not allowed, so it was not inserted.';