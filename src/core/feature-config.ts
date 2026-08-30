/**
 * Feature flag configuration for release builds.
 *
 * All features are enabled by default.
 * To disable a feature or entire category, add its identifier to DISABLED_FEATURES.
 * Disabling a parent category automatically disables all child features.
 */

import type { FeatureFlag } from './feature-flags';

/**
 * List of features and categories disabled in this build.
 * Features listed here represent unimplemented tools or mockups.
 */
export const DISABLED_FEATURES: readonly FeatureFlag[] = [
  'ocr.detect-photos',
  'extraction.remove-blanks',
  'page-numbers',
  'annotations.read-view',
  'signatures.timestamp',
  'signatures.shared',
  'components.media.stamp',
  'components.watermark',
  'settings.toc',
  'security.password',
  'security.unlock-forms',
  'security.permissions',
  'tools.repair',
  'tools.javascript',
  'tools.automate',
  'tools.auto-rename',
  'tools.api',
  'tools.folder-scan',
  'tools.sso-guide',
  'text.vertical-align',
];
