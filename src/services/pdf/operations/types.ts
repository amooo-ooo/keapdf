/**
 * Base options for drawing elements on a canvas or PDF page.
 */
export interface DrawOptions {
  /** The horizontal position coordinate. */
  x: number;
  /** The vertical position coordinate. */
  y: number;
  /** The target width of the element. */
  width?: number;
  /** The target height of the element. */
  height?: number;
  /** The rotation angle of the element in degrees. */
  rotation?: number;
  /** Indicates whether the element is flipped along the horizontal axis. */
  flipX?: boolean;
  /** Indicates whether the element is flipped along the vertical axis. */
  flipY?: boolean;
}

/**
 * Options for drawing vector shapes.
 */
export interface ShapeOptions extends DrawOptions {
  /** The fill color string. */
  fill?: string;
  /** The stroke color string. */
  stroke?: string;
  /** The stroke line width. */
  strokeWidth?: number;
}

/**
 * Options for drawing paths/polylines.
 */
export interface PathOptions extends DrawOptions {
  /** The points in the path. */
  points: { x: number; y: number }[];
  /** The stroke color string. */
  stroke?: string;
  /** The stroke line width. */
  strokeWidth?: number;
  /** Opacity or blend mode flag */
  isHighlight?: boolean;
  opacity?: number;
}

import type { TextElementLine, TextSegment } from '../../../stores/canvas-types';

/**
 * Options for rendering text elements.
 */
export interface TextOptions extends DrawOptions {
  /** The text content to render. */
  text: string;
  /** The font size in points or pixels. */
  fontSize: number;
  /** The font family name. */
  fontFamily: string;
  /** Raw font family name from PDF stream. */
  rawFontFamily?: string;
  /** The text color string. */
  color?: string;
  /** Font weight ('normal' | 'bold'). */
  fontWeight?: 'normal' | 'bold';
  /** Font style ('normal' | 'italic'). */
  fontStyle?: 'normal' | 'italic';
  /** Line height in points. */
  lineHeight?: number;
  /** Styled multi-line structures for portion-level styling. */
  lines?: TextElementLine[];
  /** Styled text segments for portion-level styling. */
  segments?: TextSegment[];
}

/**
 * Options for rendering image elements.
 */
export interface ImageOptions extends DrawOptions {
  /** The unique identifier for the image element. */
  id: string;
  /** The rendered width of the image. */
  width: number;
  /** The rendered height of the image. */
  height: number;
  /** The scaling behavior inside the target bounds. */
  objectFit?: 'fill' | 'contain' | 'cover';
  /** The raw image data payload and intrinsic dimensions. */
  imageData: {
    /** Intrinsic width of the image data. */
    width: number;
    /** Intrinsic height of the image data. */
    height: number;
    /** Raw ImageData instance containing pixel values. */
    imgData: ImageData;
  };
}

/**
 * Options for rendering form field placeholder elements.
 */
export interface FormFieldPlaceholderOptions extends DrawOptions {
  /** The unique identifier for the form field placeholder. */
  id: string;
  /** The form field variant type. */
  variant: string;
  /** The optional display label for the form field. */
  label?: string;
  /** The optional placeholder text for the form field. */
  placeholder?: string;
  /** The rendered width of the form field placeholder. */
  width: number;
  /** The rendered height of the form field placeholder. */
  height: number;
}

/** Standard sheet size presets in points (72 pt = 1 inch). */
export type StandardSheetSize = 'source' | 'source-2x' | 'A4' | 'Letter' | 'A3' | 'A5' | 'Legal' | 'Tabloid' | 'custom';

/** Sheet orientation options. */
export type SheetOrientation = 'auto' | 'portrait' | 'landscape';

/** Flow ordering for multi-page grids. */
export type PageFlowDirection = 'horizontal' | 'vertical' | 'horizontal-rtl';

/** Custom sheet dimensions in PDF points. */
export interface SheetDimensions {
  /** Width in points. */
  widthPts: number;
  /** Height in points. */
  heightPts: number;
}

/**
 * Configuration options for N-Up / Multi-Page layout imposition.
 */
export interface NUpImpositionOptions {
  /** Mode discriminator. */
  type: 'nup';
  /** Number of columns and rows per sheet. */
  grid: { cols: number; rows: number };
  /** Target sheet size preset or custom. */
  sheetSize: StandardSheetSize;
  /** Custom sheet dimensions when sheetSize is 'custom'. */
  customDimensions?: SheetDimensions;
  /** Sheet orientation. */
  orientation: SheetOrientation;
  /** Order in which source pages fill the grid. */
  pageFlow: PageFlowDirection;
  /** Outer margin of the sheet in points. */
  marginPts: number;
  /** Spacing between subpages (gutter) in points. */
  gutterPts: number;
  /** Whether to draw a thin border around each placed subpage. */
  drawPageBorders: boolean;
  /** Whether to draw dashed cut lines between grid cells. */
  drawCutMarks: boolean;
  /** Optional subset of pages to impose (e.g. "1-8, 10"). Empty or 'all' means all pages. */
  pageRange?: string;
  /** Whether to auto-rotate subpages 90 degrees if it achieves a larger scale fit. */
  autoRotateSubpages?: boolean;
}

/** Binding side edge for booklet folding. */
export type BookletBindingSide = 'left' | 'right' | 'top';

/** Output sequence format for booklets. */
export type BookletOutputMode = 'duplex' | 'front-then-back';

/**
 * Configuration options for saddle-stitch booklet imposition.
 */
export interface BookletImpositionOptions {
  /** Mode discriminator. */
  type: 'booklet';
  /** Binding edge. */
  bindingSide: BookletBindingSide;
  /** Target sheet size preset. Defaults to landscape sheet matching 2x source width. */
  sheetSize: StandardSheetSize;
  /** Custom sheet dimensions when sheetSize is 'custom'. */
  customDimensions?: SheetDimensions;
  /** Sheet orientation. */
  orientation: SheetOrientation;
  /** Output page sequence. */
  outputMode: BookletOutputMode;
  /** Automatically pad the document with blank pages to a multiple of 4. */
  autoPad: boolean;
  /** Whether to draw a dashed fold line down the spine center. */
  drawFoldLine: boolean;
  /** Whether to draw a thin border around each subpage. */
  drawPageBorders: boolean;
  /** Spine gutter spacing in points. */
  gutterPts: number;
  /** Outer margin in points. */
  marginPts: number;
  /** Creep compensation shift per sheet in points (for thick booklets). */
  creepPtsPerSheet?: number;
  /** Optional subset of pages to include in the booklet. */
  pageRange?: string;
}

/** Layout style for single large continuous page imposition. */
export type SinglePageLayout = 'vertical-strip' | 'horizontal-strip' | 'grid';

/**
 * Configuration options for merging all pages into a single large canvas.
 */
export interface SinglePageImpositionOptions {
  /** Mode discriminator. */
  type: 'single-page';
  /** Layout arrangement. */
  layout: SinglePageLayout;
  /** Number of columns when layout is 'grid'. */
  gridCols?: number;
  /** Spacing between adjacent pages in points. */
  spacingPts: number;
  /** Outer padding around the entire canvas in points. */
  marginPts: number;
  /** Whether to draw a border outline around each placed page. */
  drawPageBorders: boolean;
  /** Background fill color in hex format (e.g. '#ffffff'). */
  backgroundColor?: string;
  /** Optional subset of pages to include. */
  pageRange?: string;
}

/**
 * Configuration options for posterizing / tiling a large page across multiple sheets.
 */
export interface PosterizeImpositionOptions {
  /** Mode discriminator. */
  type: 'posterize';
  /** Target individual sheet size preset. */
  sheetSize: StandardSheetSize;
  /** Custom sheet dimensions when sheetSize is 'custom'. */
  customDimensions?: SheetDimensions;
  /** Target sheet orientation. */
  orientation: SheetOrientation;
  /** Tile scaling factor (e.g. 2.0 for 200%). If undefined, auto-calculated from tileGrid. */
  tileScale?: number;
  /** Desired number of tile columns and rows (e.g. 2x2). */
  tileGrid?: { cols: number; rows: number };
  /** Overlap margin in points between adjacent tiles for physical gluing/taping. */
  overlapPts: number;
  /** Outer sheet margin in points. */
  marginPts: number;
  /** Whether to draw cut guides and trim marks in the overlap margins. */
  drawCutGuides: boolean;
  /** Whether to print tile coordinate labels in the margin (e.g. "Tile 1 of 4 [Row 1, Col 1]"). */
  drawSheetNumbers: boolean;
  /** Zero-based page index of the source page to posterize. If undefined, applies to current page. */
  sourcePageIndex?: number;
}

/**
 * Configuration options for cut-and-stack imposition.
 */
export interface CutAndStackImpositionOptions {
  /** Mode discriminator. */
  type: 'cut-stack';
  /** Grid arrangement (2x1 for 2-up, 2x2 for 4-up). */
  grid: { cols: number; rows: number };
  /** Target sheet size preset. */
  sheetSize: StandardSheetSize;
  /** Custom sheet dimensions when sheetSize is 'custom'. */
  customDimensions?: SheetDimensions;
  /** Sheet orientation. */
  orientation: SheetOrientation;
  /** Outer sheet margin in points. */
  marginPts: number;
  /** Gutter spacing in points. */
  gutterPts: number;
  /** Whether to draw dashed cut lines between stack partitions. */
  drawCutMarks: boolean;
  /** Whether to draw a thin border around each subpage. */
  drawPageBorders: boolean;
  /** Optional subset of pages to impose. */
  pageRange?: string;
}

/**
 * Union of all imposition configuration variants.
 */
export type ImpositionConfig =
  | NUpImpositionOptions
  | BookletImpositionOptions
  | SinglePageImpositionOptions
  | PosterizeImpositionOptions
  | CutAndStackImpositionOptions;

