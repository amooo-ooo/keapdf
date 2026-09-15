import type { Rect } from '../utils/geometry';

/** Orientation of an alignment guide line. */
export type SnapOrientation = 'horizontal' | 'vertical';

/** Category of snap target. */
export type SnapTargetKind =
  | 'page-edge'
  | 'page-center'
  | 'page-margin'
  | 'element-edge'
  | 'element-center'
  | 'spacing-gap'
  | 'size-match';

/** Visual descriptor for a snap guideline rendered on canvas. */
export interface SnapGuide {
  id: string;
  orientation: SnapOrientation;
  coordinate: number;
  pageIndex: number;
  start: number;
  end: number;
  kind: SnapTargetKind;
  label?: string;
  matchedElementId?: string;
}

/** Configuration options for snapping calculations. */
export interface SnapOptions {
  screenThresholdPx?: number;
  disabled?: boolean;
  enablePageSnap?: boolean;
  enableElementSnap?: boolean;
  enableSpacingSnap?: boolean;
  enableSizeSnap?: boolean;
}

/** Result of a 2D snapping calculation. */
export interface SnapResult {
  x: number;
  y: number;
  snappedX: boolean;
  snappedY: boolean;
  guides: SnapGuide[];
}

/** Candidate element for snap calculations. */
export interface SnapCandidate {
  id: string;
  rect: Rect;
  pageIndex: number;
}

/** Margins for page snapping. */
export interface SnapMargins {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}
