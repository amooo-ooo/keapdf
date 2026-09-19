import type { EditableTextSpan, TextLine } from '../core/types';

/**
 * UI-specific type definitions for editor state management.
 * Keeps core/types.ts focused on PDFium data contracts.
 */

/** Active editing tool in the toolbar. */
export type EditorTool = 'select' | 'hand' | 'text' | 'place' | 'highlight' | 'pen' | 'signature' | 'note' | 'redact' | 'eraser';

/** Content mode for the left panel. */
export type LeftPanelMode = 'workspace' | 'components' | 'annotate' | 'tools' | 'settings';

/** State for an active inline text edit on the canvas. */
export interface InlineEditState {
  spanId: string;
  textValue: string;
  span: EditableTextSpan;
  styledLines?: TextLine[];
  matchedFontFamily?: string;
}

/** Visual transform applied to a PDF page on the canvas. */
export interface PageTransform {
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** Default (identity) page transform. */
export const DEFAULT_PAGE_TRANSFORM: Readonly<PageTransform> = {
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

/** Measurement unit for page cropping margins. */
export type CropUnit = 'pt' | 'in' | 'mm';

/** Target scope for page cropping operations. */
export type CropScope = 'current' | 'all' | 'selected';

/** Active crop interaction state for the editor. */
export interface ActiveCropState {
  pageIndex: number;
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  unit: CropUnit;
  scope: CropScope;
}

