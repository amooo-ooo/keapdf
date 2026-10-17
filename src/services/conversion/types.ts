/**
 * Types and interfaces for the document conversion engine.
 */

export type DocumentFormat =
  | 'docx'
  | 'xlsx'
  | 'xls'
  | 'csv'
  | 'tsv'
  | 'pptx'
  | 'markdown'
  | 'text'
  | 'json'
  | 'code'
  | 'html'
  | 'rtf'
  | 'image'
  | 'unknown';

export type PageSizePreset =
  | 'a4'
  | 'letter'
  | 'legal'
  | 'slide_16_9'
  | 'slide_4_3'
  | 'custom';

export type PageOrientation = 'portrait' | 'landscape' | 'auto';

export interface PageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface DocumentMargins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface DocumentConversionOptions {
  readonly pageSize?: PageSizePreset;
  readonly orientation?: PageOrientation;
  readonly customDimensions?: PageDimensions;
  readonly margins?: DocumentMargins;
  readonly fontSize?: number;
  readonly fontFamily?: 'helvetica' | 'times' | 'courier';
  readonly includePageNumbers?: boolean;
  readonly includeHeader?: boolean;
  readonly includeOutline?: boolean;
  readonly title?: string;

  // Spreadsheet options
  readonly includeGridlines?: boolean;
  readonly alternateRowShading?: boolean;
  readonly selectedSheets?: readonly string[];
  readonly autoColumnWidths?: boolean;
  readonly smartNumericAlignment?: boolean;

  // Slide options
  readonly slideTheme?: 'light' | 'dark' | 'corporate' | 'clean';
  readonly showSlideNumbers?: boolean;

  // Text / Markdown options
  readonly lineSpacing?: number;
  readonly renderMarkdownHeadings?: boolean;
  readonly syntaxHighlightCode?: boolean;
}

export interface ConvertedDocumentMetadata {
  readonly title?: string;
  readonly sheetNames?: readonly string[];
  readonly slideCount?: number;
  readonly rowCount?: number;
  readonly columnCount?: number;
  readonly wordCount?: number;
  readonly conversionDurationMs: number;
}

export interface ConvertedDocumentResult {
  readonly buffer: ArrayBuffer;
  readonly pageCount: number;
  readonly fileName: string;
  readonly format: DocumentFormat;
  readonly metadata: ConvertedDocumentMetadata;
}

export interface ConversionInputItem {
  readonly name: string;
  readonly buffer: ArrayBuffer | Uint8Array;
  readonly mimeType?: string;
}

// Intermediate Document Representation (IDR) models

export interface TextStyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly code?: boolean;
  readonly math?: boolean;
  readonly fontSize?: number;
  readonly fontColor?: string;
  readonly fontFamily?: 'helvetica' | 'times' | 'courier';
}

export interface StyledRun {
  readonly text: string;
  readonly style?: TextStyle;
  readonly link?: string;
}

export type BlockAlignment = 'left' | 'center' | 'right' | 'justify';

export interface ParagraphBlock {
  readonly type: 'paragraph';
  readonly runs: readonly StyledRun[];
  readonly align?: BlockAlignment;
  readonly spaceBefore?: number;
  readonly spaceAfter?: number;
  readonly lineSpacing?: number;
}

export interface HeadingBlock {
  readonly type: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
  readonly runs?: readonly StyledRun[];
  readonly align?: BlockAlignment;
  readonly id?: string;
  readonly unlisted?: boolean;
}

export interface ListItem {
  readonly runs: readonly StyledRun[];
  readonly isTask?: boolean;
  readonly isChecked?: boolean;
  readonly indentLevel?: number;
}

export interface ListBlock {
  readonly type: 'list';
  readonly ordered: boolean;
  readonly items: readonly (readonly StyledRun[] | ListItem)[];
  readonly indentLevel?: number;
}

export interface CodeBlock {
  readonly type: 'code';
  readonly code: string;
  readonly language?: string;
  readonly showLineNumbers?: boolean;
}

export interface QuoteBlock {
  readonly type: 'quote';
  readonly text: string;
  readonly runs?: readonly StyledRun[];
}

export type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export interface AlertBlock {
  readonly type: 'alert';
  readonly alertType: AlertType;
  readonly title?: string;
  readonly runs: readonly StyledRun[];
}

export interface DiagramBlock {
  readonly type: 'diagram';
  readonly diagramType: 'mermaid';
  readonly code: string;
  readonly title?: string;
}

export interface MathBlock {
  readonly type: 'math';
  readonly expression: string;
  readonly displayMode?: boolean;
}

export interface DividerBlock {
  readonly type: 'divider';
}

export interface PageBreakBlock {
  readonly type: 'pageBreak';
}

export interface TableCell {
  readonly runs: readonly StyledRun[];
  readonly background?: string;
  readonly colSpan?: number;
  readonly rowSpan?: number;
  readonly align?: BlockAlignment;
  readonly isHeader?: boolean;
}

export interface TableRow {
  readonly cells: readonly TableCell[];
  readonly isHeader?: boolean;
}

export interface TableBlock {
  readonly type: 'table';
  readonly rows: readonly TableRow[];
  readonly columnWidths?: readonly number[];
  readonly hasBorders?: boolean;
  readonly hasZebraStriping?: boolean;
}

export interface ImageBlock {
  readonly type: 'image';
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly width?: number;
  readonly height?: number;
  readonly caption?: string;
}

export type DocumentBlock =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | CodeBlock
  | QuoteBlock
  | AlertBlock
  | DiagramBlock
  | MathBlock
  | DividerBlock
  | PageBreakBlock
  | TableBlock
  | ImageBlock;

export interface FlowDocument {
  readonly title?: string;
  readonly blocks: readonly DocumentBlock[];
}

export interface SheetData {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
  readonly columnWidths?: readonly number[];
}

export interface GridDocument {
  readonly title?: string;
  readonly sheets: readonly SheetData[];
}

export interface SlideElement {
  readonly kind: 'title' | 'subtitle' | 'body' | 'bullet_list' | 'card' | 'image' | 'table';
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
  readonly runs?: readonly StyledRun[];
  readonly items?: readonly string[];
  readonly imageData?: Uint8Array;
  readonly imageMime?: string;
  readonly table?: TableBlock;
  readonly backgroundColor?: string;
}

export interface SlideData {
  readonly slideIndex: number;
  readonly title?: string;
  readonly elements: readonly SlideElement[];
  readonly backgroundColor?: string;
}

export interface SlideDocument {
  readonly title?: string;
  readonly width: number;
  readonly height: number;
  readonly slides: readonly SlideData[];
}

export interface FormatConverter {
  readonly id: string;
  readonly displayName: string;
  readonly formats: readonly DocumentFormat[];
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
  canConvert(fileName: string, buffer: ArrayBuffer | Uint8Array, mimeType?: string): boolean;
  convert(
    input: ConversionInputItem,
    options?: DocumentConversionOptions
  ): Promise<ConvertedDocumentResult>;
}
