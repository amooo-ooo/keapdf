/**
 * Feature flag configuration for release and dev environments.
 * Features are enabled by default unless listed in DISABLE_FEATURES.
 * Disabling a parent category cascades to all child features.
 */

import type { FeatureFlag } from './feature-flags';

/**
 * Disabled features to force enable for dev mode testing.
 * Constrained at compile time to literal values in DISABLE_FEATURES.
 */
export const DEV_ENABLE_FEATURES: readonly (typeof DISABLE_FEATURES)[number][] = [];

/**
 * Force enable all disabled features for dev mode.
 * When true, bypasses DISABLE_FEATURES for testing.
 */
export const DEV_ENABLE_ALL: boolean = false;

/**
 * Features and categories disabled in production and development builds.
 * Disabling a parent category automatically disables all child features.
 */
export const DISABLE_FEATURES = [
  'ocr.detect-photos',
  'extraction.remove-blanks',
  'page-numbers',
  'page-actions.ocr',
  'annotations.read-view',
  'signatures.timestamp',
  'signatures.shared',
  'components.media.stamp',
  'components.watermark',
  'components.media.image-placeholder',
  'components.forms.attachment',
  'components.media.video',
  'components.media.audio',
  'components.media.3d',
  'components.media.attachment',
  'components.media.barcode',
  'components.apply',
  'components.gallery',
  'view-mode.viewing.collapse-sidebar',
  'settings.toc',
  'tools.repair',
  'tools.javascript',
  'tools.automate',
  'tools.auto-rename',
  'tools.api',
  'tools.folder-scan',
  'tools.sso-guide',
  'text.vertical-align',
] as const satisfies readonly FeatureFlag[];

export const DISABLED_FEATURES = DISABLE_FEATURES;
