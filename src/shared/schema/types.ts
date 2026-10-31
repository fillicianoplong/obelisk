/* Generated from document.schema.json by scripts/generate-schema-types.mjs. Do not edit. */

export interface Document {
  view: "pages" | "pageless";
  page: PageSetup;
  header: HeaderParagraph;
  footer: HeaderParagraph;
  blocks: Block[];
}

export interface PageSetup {
  paper: "letter";
  orientation: "portrait" | "landscape";
  margins: Margins;
}

export interface Margins {
  top: MarginInches;
  right: MarginInches;
  bottom: MarginInches;
  left: MarginInches;
}

export type MarginInches = number;

export interface Indents {
  left: number;
  first: number;
  hanging: number;
}

export type BlockId = string;

export type Sha256 = string;

export type Color = string;

export interface TextMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  font?: string;
  size?: 8 | 9 | 10 | 11 | 12 | 14 | 16 | 18 | 20 | 24 | 28 | 36 | 48 | 72;
  color?: Color;
  highlight?: Color;
}

export interface TextRun {
  type: "text";
  text: string;
  marks?: TextMarks;
}

export interface LinkRun {
  type: "link";
  address: string;
  text: string;
}

export interface InlineFormula {
  type: "inlineFormula";
  latex: string;
}

export interface DateChip {
  type: "dateChip";
  dateTime: string;
  format: "windows-short" | "windows-long" | "month-day-year" | "day-month-year" | "iso-date" | "short-date-time" | "time";
}

export interface PageField {
  type: "pageField";
  kind: "page" | "pages";
  format: "decimal" | "roman" | "page-of-n";
}

export type BodyInline =
  | TextRun
  | LinkRun
  | InlineFormula
  | DateChip;

export type HeaderInline =
  | TextRun
  | PageField;

export interface HeaderParagraph {
  id: BlockId;
  align: "left" | "center" | "right" | "justify";
  lineSpacing: "single" | "1.15" | "1.5" | "double";
  spaceBefore: 0 | 6 | 12 | 18 | 24;
  spaceAfter: 0 | 6 | 12 | 18 | 24;
  indents: Indents;
  content: HeaderInline[];
}

export interface ParagraphBlock {
  type: "paragraph";
  id: BlockId;
  align: "left" | "center" | "right" | "justify";
  lineSpacing: "single" | "1.15" | "1.5" | "double";
  spaceBefore: 0 | 6 | 12 | 18 | 24;
  spaceAfter: 0 | 6 | 12 | 18 | 24;
  indents: Indents;
  content: BodyInline[];
}

export interface HeadingBlock {
  type: "heading";
  id: BlockId;
  level: number;
  content: BodyInline[];
}

export interface PlainListItem {
  level: number;
  content: BodyInline[];
}

export interface CheckListItem {
  level: number;
  checked: boolean;
  content: BodyInline[];
}

export interface BulletListBlock {
  type: "list";
  id: BlockId;
  style: "bulleted";
  items: PlainListItem[];
}

export interface NumberedListBlock {
  type: "list";
  id: BlockId;
  style: "numbered";
  items: PlainListItem[];
}

export interface ChecklistBlock {
  type: "list";
  id: BlockId;
  style: "checklist";
  items: CheckListItem[];
}

export interface QuoteBlock {
  type: "quote";
  id: BlockId;
  content: BodyInline[];
}

export interface CodeBlock {
  type: "code";
  id: BlockId;
  text: string;
}

export interface DividerBlock {
  type: "divider";
  id: BlockId;
}

export interface PageBreakBlock {
  type: "pageBreak";
  id: BlockId;
}

export type ColumnWidth = number;

export interface TextCell {
  kind: "text";
  content: BodyInline[];
}

export interface FormulaCell {
  kind: "formula";
  source: string;
}

export type TableCell =
  | TextCell
  | FormulaCell;

export interface TableRow {
  cells: TableCell[];
}

export interface TableBlock {
  type: "table";
  id: BlockId;
  headerRow: boolean;
  columnWidths: ColumnWidth[];
  rows: TableRow[];
}

export interface ImageBlock {
  type: "image";
  id: BlockId;
  sha256: Sha256;
  width: number;
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
  alt: string;
  drawing?: DrawingLayer;
}

export interface FormulaBlock {
  type: "formula";
  id: BlockId;
  latex: string;
}

export interface Column {
  share: number;
  blocks: NestedBlock[];
}

export interface ColumnsBlock {
  type: "columns";
  id: BlockId;
  columns: Column[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  width: number;
  color: Color;
}

export interface DrawingLayer {
  width: number;
  height: number;
  strokes: Stroke[];
}

export interface DrawingBlock {
  type: "drawing";
  id: BlockId;
  width: number;
  height: number;
  strokes: Stroke[];
}

export interface SignatureBlock {
  type: "signature";
  id: BlockId;
  sha256: Sha256;
  line: boolean;
  width: number;
  labels: string[];
  align: "left" | "center" | "right";
  blank: boolean;
}

export interface DiagramBlock {
  type: "diagram";
  id: BlockId;
  source: string;
}

export type NestedBlock =
  | ParagraphBlock
  | HeadingBlock
  | BulletListBlock
  | NumberedListBlock
  | ChecklistBlock
  | QuoteBlock
  | CodeBlock
  | DividerBlock
  | TableBlock
  | ImageBlock
  | FormulaBlock
  | DrawingBlock
  | SignatureBlock
  | DiagramBlock;

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | BulletListBlock
  | NumberedListBlock
  | ChecklistBlock
  | QuoteBlock
  | CodeBlock
  | DividerBlock
  | PageBreakBlock
  | TableBlock
  | ImageBlock
  | FormulaBlock
  | ColumnsBlock
  | DrawingBlock
  | SignatureBlock
  | DiagramBlock;

export interface ManifestImage {
  sha256: Sha256;
  type: "png" | "jpeg" | "gif" | "webp";
  bytes: number;
  width: number;
  height: number;
  frames: number;
}

export interface Manifest {
  format: "obelisk";
  formatVersion: 1;
  writer: string;
  images: ManifestImage[];
}
