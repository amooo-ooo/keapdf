/**
 * Hierarchical feature flags system for the PDF editor.
 *
 * Provides fine-grained capability checks using dot notation.
 * Disabling a parent category automatically disables all child features.
 * All features are enabled by default unless listed in DISABLED_FEATURES.
 */

import { getContext, setContext } from 'svelte';
import { DISABLED_FEATURES } from './feature-config';

/**
 * Exhaustive union of all toggleable categories and specific tools.
 */
export type FeatureFlag =
  | 'ocr'
  | 'ocr.recognize'
  | 'ocr.detect-photos'
  | 'compression'
  | 'sanitization'
  | 'conversion'
  | 'annotations'
  | 'annotations.highlighter'
  | 'annotations.pen'
  | 'annotations.eraser'
  | 'annotations.colors'
  | 'annotations.note'
  | 'annotations.read-view'
  | 'redaction'
  | 'redaction.area'
  | 'redaction.sanitize'
  | 'redaction.colors'
  | 'signatures'
  | 'signatures.esign'
  | 'signatures.cert-sign'
  | 'signatures.validate'
  | 'signatures.timestamp'
  | 'signatures.shared'
  | 'crop'
  | 'split'
  | 'merge'
  | 'imposition'
  | 'imposition.nup'
  | 'imposition.booklet'
  | 'imposition.panel'
  | 'imposition.continuous'
  | 'imposition.posterize'
  | 'imposition.cut-stack'
  | 'extraction'
  | 'extraction.pages'
  | 'extraction.images'
  | 'extraction.remove-blanks'
  | 'page-numbers'
  | 'page-numbers.numbers'
  | 'page-numbers.header-footer'
  | 'outline'
  | 'forms'
  | 'components'
  | 'components.text'
  | 'components.heading'
  | 'components.body-text'
  | 'components.note'
  | 'components.forms'
  | 'components.forms.text-input'
  | 'components.forms.checkbox'
  | 'components.forms.radio'
  | 'components.forms.dropdown'
  | 'components.forms.signature'
  | 'components.forms.button'
  | 'components.forms.attachment'
  | 'components.media'
  | 'components.media.image-import'
  | 'components.media.image-placeholder'
  | 'components.media.stamp'
  | 'components.shapes'
  | 'components.shapes.rectangle'
  | 'components.shapes.circle'
  | 'components.shapes.line'
  | 'components.shapes.arrow'
  | 'components.watermark'
  | 'components.watermark.add'
  | 'components.watermark.overlay'
  | 'components.apply'
  | 'page-actions'
  | 'page-actions.crop'
  | 'page-actions.duplicate'
  | 'page-actions.add-blank'
  | 'page-actions.delete'
  | 'page-actions.outline'
  | 'page-actions.ocr'
  | 'page-actions.merge'
  | 'page-actions.import-image'
  | 'page-actions.flatten'
  | 'page-actions.rasterize'
  | 'page-actions.split'
  | 'page-actions.extract'
  | 'page-actions.rotate'
  | 'page-actions.scale'
  | 'export'
  | 'export.pdf'
  | 'export.flattened-pdf'
  | 'export.compress-pdf'
  | 'export.images'
  | 'export.text'
  | 'workspace'
  | 'workspace.open'
  | 'workspace.add'
  | 'workspace.convert'
  | 'workspace.compliance'
  | 'workspace.merge'
  | 'workspace.files'
  | 'workspace.pages'
  | 'settings'
  | 'settings.metadata'
  | 'settings.toc'
  | 'settings.security'
  | 'security'
  | 'security.password'
  | 'security.unlock-forms'
  | 'security.permissions'
  | 'tools'
  | 'tools.repair'
  | 'tools.javascript'
  | 'tools.automate'
  | 'tools.auto-rename'
  | 'tools.api'
  | 'tools.folder-scan'
  | 'tools.sso-guide'
  | 'page-actions.reorder'
  | 'export.watermarked-summary'
  | 'plugins'
  | 'plugins.watermark'
  | 'webmcp'
  | 'zoom'
  | 'history'
  | 'watermark'
  | 'canvas-elements.duplicate'
  | 'canvas-elements.lock'
  | 'canvas-elements.delete'
  | 'organizer'
  | 'document-info'
  | 'text-editing'
  | 'canvas-elements'
  | 'rasterize'
  | 'flatten'
  | 'export-images'
  | 'text'
  | 'text.vertical-align'
  | 'snapping'
  | 'snapping.page'
  | 'snapping.elements'
  | 'snapping.smart-guides'
  | 'snapping.spacing';

/** Type alias for backwards compatibility. */
export type FeatureId = FeatureFlag;

const FEATURE_FLAG_STORE_KEY = Symbol('feature-flag-store');

/**
 * Reactive store managing feature capability checks.
 * Uses Svelte 5 runes for fine-grained reactivity.
 */
export class FeatureFlagStore {
  /** Reactive set of currently disabled feature flags. */
  private disabledFlags = $state<Set<FeatureFlag>>(
    new Set<FeatureFlag>(DISABLED_FEATURES)
  );

  /**
   * Checks whether a feature is currently enabled.
   * Checks the exact flag and all parent category prefixes.
   *
   * @param flag The feature identifier or category to check.
   * @return True if the feature and all its parent categories are enabled.
   */
  isEnabled(flag: FeatureFlag): boolean {
    if (this.disabledFlags.has(flag)) {
      return false;
    }
    const parts = flag.split('.');
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}.${parts[i]}` : parts[i];
      if (this.disabledFlags.has(prefix as FeatureFlag)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Disables a feature or category programmatically.
   *
   * @param flag The feature identifier to disable.
   */
  disable(flag: FeatureFlag): void {
    const next = new Set(this.disabledFlags);
    next.add(flag);
    this.disabledFlags = next;
  }

  /**
   * Enables a feature or category programmatically.
   *
   * @param flag The feature identifier to enable.
   */
  enable(flag: FeatureFlag): void {
    const next = new Set(this.disabledFlags);
    next.delete(flag);
    this.disabledFlags = next;
  }

  /**
   * Resets all feature flags to the static defaults from DISABLED_FEATURES.
   */
  resetAll(): void {
    this.disabledFlags = new Set<FeatureFlag>(DISABLED_FEATURES);
  }

  /**
   * Retrieves an array of all currently disabled feature flags.
   *
   * @return Array of disabled flags.
   */
  getDisabled(): FeatureFlag[] {
    return Array.from(this.disabledFlags);
  }
}

/** Provide the feature flag store via Svelte context. */
export function provideFeatureFlagStore(store: FeatureFlagStore): void {
  setContext(FEATURE_FLAG_STORE_KEY, store);
}

/** Retrieve the feature flag store from Svelte context. */
export function useFeatureFlagStore(): FeatureFlagStore {
  const store = getContext<FeatureFlagStore>(FEATURE_FLAG_STORE_KEY);
  if (!store) {
    throw new Error('FeatureFlagStore not found in context');
  }
  return store;
}

export { DISABLED_FEATURES };
