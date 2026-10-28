// Format 1 limits. Each value is the SRS figure. A megabyte is 1024 * 1024
// bytes, which is how spike S-08 applied the file caps in architecture 6.6.

export const FORMAT_NAME = 'obelisk';
export const FORMAT_VERSION = 1;

export const MB = 1024 * 1024;

export const FILE_MAX_BYTES = 200 * MB;
export const ENTRY_MAX_COUNT = 2000;
export const DOCUMENT_JSON_MAX_BYTES = 25 * MB;
export const IMAGE_MIN_BYTES = 1;
export const IMAGE_MAX_BYTES = 20 * MB;
export const ARCHIVE_MAX_UNCOMPRESSED_BYTES = 250 * MB;

export const IMAGE_DIMENSION_MIN = 1;
export const IMAGE_DIMENSION_MAX = 8000;
export const ANIMATION_FRAME_MIN = 1;
export const ANIMATION_FRAME_MAX = 1000;
export const ANIMATION_PIXEL_MAX = 250_000_000;

export const BLOCK_MAX = 20_000;
export const TEXT_MAX_CHARS = 100_000;
export const TABLE_ROW_MAX = 200;
export const TABLE_COLUMN_MAX = 26;
export const TABLE_CELL_MAX_CHARS = 10_000;
export const FORMULA_MAX_CHARS = 10_000;
export const INLINE_FORMULA_MAX_CHARS = 10_000;
export const DIAGRAM_MAX_CHARS = 50_000;
export const DRAWING_STROKE_MAX = 2000;
export const DRAWING_POINT_MAX = 100_000;
export const SIGNATURE_LABEL_MAX_CHARS = 100;
export const SIGNATURE_LABEL_MAX_LINES = 2;
export const SIGNATURE_WIDTH_MIN_IN = 1.5;
export const SIGNATURE_WIDTH_MAX_IN = 4;
export const LINK_MAX_CHARS = 2048;
export const ALT_TEXT_MAX_CHARS = 500;
export const FONT_NAME_MIN_CHARS = 1;
export const FONT_NAME_MAX_CHARS = 64;
export const WRITER_MAX_CHARS = 64;

export const FONT_SIZES_PT = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72] as const;
export const DEFAULT_FONT_SIZE_PT = 12;

export const LENGTH_DECIMAL_PLACES = 3;
export const LETTER_WIDTH_IN = 8.5;
export const LETTER_HEIGHT_IN = 11;
export const PAPER_LETTER = 'letter';
export const MARGIN_MIN_IN = 0.25;
export const MARGIN_MAX_IN = 3;
export const DEFAULT_MARGIN_IN = 1;
export const TEXT_AREA_MIN_IN = 2;
export const HEADER_OFFSET_IN = 0.5;

export const INDENT_LEFT_MIN_IN = 0;
export const INDENT_LEFT_MAX_IN = 3;
export const INDENT_FIRST_MAX_IN = 1;
export const INDENT_HANGING_MAX_IN = 1;
export const INDENT_STEP_IN = 0.25;

export const SPACE_BEFORE_AFTER_PT = [0, 6, 12, 18, 24] as const;

export const HEADING_LEVEL_MIN = 1;
export const HEADING_LEVEL_MAX = 6;
export const LIST_LEVEL_MIN = 0;
export const LIST_LEVEL_MAX = 5;

export const COLUMN_MIN = 2;
export const COLUMN_MAX = 4;
export const COLUMN_SHARE_MIN = 0.15;
export const COLUMN_GAP_IN = 0.25;
export const COLUMN_SHARE_SUM_TOLERANCE = 0.001;

export const DOCUMENT_VIEWS = ['pages', 'pageless'] as const;
export const ORIENTATIONS = ['portrait', 'landscape'] as const;
export const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
export const LINE_SPACINGS = ['single', '1.15', '1.5', 'double'] as const;
export const ROTATIONS = [0, 90, 180, 270] as const;
export const IMAGE_TYPES = ['png', 'jpeg', 'gif', 'webp'] as const;
export const STILL_IMAGE_TYPES = ['png', 'jpeg'] as const;
export const LINK_SCHEMES = ['http', 'https', 'mailto'] as const;
export const LIST_STYLES = ['bulleted', 'numbered', 'checklist'] as const;
export const DATE_CHIP_FORMATS = [
  'windows-short',
  'windows-long',
  'month-day-year',
  'day-month-year',
  'iso-date',
  'short-date-time',
  'time',
] as const;
export const PAGE_FIELD_KINDS = ['page', 'pages'] as const;
export const PAGE_FIELD_FORMATS = ['decimal', 'roman', 'page-of-n'] as const;

export const SHA256_HEX_LENGTH = 64;
