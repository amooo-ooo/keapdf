/**
 * Hierarchical feature flag store with dot-notation capability gating.
 * Disabling a parent category cascades to all child features.
 * DEV_ENABLE_FEATURES and DEV_ENABLE_ALL allow targeted testing in dev mode.
 */

import { getContext, setContext } from 'svelte';
import {
  DISABLE_FEATURES,
  DEV_ENABLE_FEATURES,
  DEV_ENABLE_ALL,
} from './feature-config';

/** Literal union of features present in DISABLE_FEATURES. */
export type DisabledFeature = (typeof DISABLE_FEATURES)[number];

/** Union of all toggleable feature and category identifiers. */
export type FeatureFlag =
  | 'ocr'
  | 'ocr.recognize'
  | 'ocr.detect-photos'
  | 'compression'
  | 'compression.estimate'
  | 'sanitization'
  | 'conversion'
  | 'annotations'
  | 'annotations.highlighter'
  | 'annotations.pen'
  | 'annotations.eraser'
  | 'annotations.colors'
  | 'annotations.note'
  | 'annotations.read-view'
  | 'annotations.select'
  | 'annotations.modify'
  | 'redaction'
  | 'redaction.area'
  | 'redaction.sanitize'
  | 'redaction.colors'
  | 'signatures'
  | 'signatures.esign'
  | 'signatures.cert-sign'
  | 'signatures.cert-sign.saved'
  | 'signatures.cert-sign.interactive-placement'
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
  | 'page-numbers.bates'
  | 'page-numbers.header-footer'
  | 'outline'
  | 'forms'
  | 'components'
  | 'components.text'
  | 'components.title'
  | 'components.subtitle'
  | 'components.heading'
  | 'components.subheading'
  | 'components.body-text'
  | 'components.caption'
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
  | 'components.media.video'
  | 'components.media.audio'
  | 'components.media.3d'
  | 'components.media.attachment'
  | 'components.media.barcode'
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
  | 'components.gallery'
  | 'components.slider'
  | 'components.slider.value'
  | 'components.slider.units'
  | 'components.slider.range'
  | 'components.slider.steps'
  | 'components.dropdown-button'
  | 'components.dropdown-button.variants'
  | 'components.dropdown-button.split'
  | 'components.dropdown-button.submenus'
  | 'components.carousel'
  | 'components.carousel.indicators'
  | 'components.carousel.controls'
  | 'components.carousel.autoplay'
  | 'components.card'
  | 'components.card.header'
  | 'components.card.actions'
  | 'components.card.footer'
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
  | 'page-actions.compress'
  | 'page-actions.sanitize'
  | 'page-actions.extract-images'
  | 'export'
  | 'export.pdf'
  | 'export.flattened-pdf'
  | 'export.compress-pdf'
  | 'export.docx'
  | 'export.pptx'
  | 'export.xlsx'
  | 'export.csv'
  | 'export.html'
  | 'export.markdown'
  | 'export.images'
  | 'export.text'
  | 'workspace'
  | 'workspace.open'
  | 'workspace.add'
  | 'workspace.convert'
  | 'workspace.quick-convert'
  | 'workspace.compliance'
  | 'workspace.compliance.suites'
  | 'workspace.compliance.url'
  | 'workspace.compliance.multi-demo'
  | 'workspace.merge'
  | 'workspace.files'
  | 'workspace.pages'
  | 'workspace.select-all'
  | 'workspace.feature-carousel'
  | 'conversion.quick-convert'
  | 'conversion.markdown-diagrams'
  | 'conversion.markdown-math'
  | 'conversion.markdown-links'
  | 'conversion.markdown-outline'
  | 'conversion.page-numbers'
  | 'conversion.running-headers'
  | 'compliance'
  | 'compliance.suites'
  | 'compliance.url'
  | 'settings'
  | 'settings.metadata'
  | 'settings.metadata.add'
  | 'settings.metadata.delete'
  | 'settings.toc'
  | 'settings.security'
  | 'settings.repair-developer-info'
  | 'settings.feature-flags'
  | 'feature-flags'
  | 'feature-flags.prod-only'
  | 'feature-flags.dev-show-all'
  | 'feature-flags.disable-in-prod-only'
  | 'security'
  | 'security.password'
  | 'security.unlock-forms'
  | 'security.permissions'
  | 'security.preserve-encryption'
  | 'tools'
  | 'tools.repair'
  | 'tools.javascript'
  | 'tools.automate'
  | 'tools.auto-rename'
  | 'tools.api'
  | 'tools.folder-scan'
  | 'tools.sso-guide'
  | 'tools.outline'
  | 'tools.compress'
  | 'tools.sanitize'
  | 'tools.adjust-colors'
  | 'page-actions.reorder'
  | 'export.watermarked-summary'
  | 'plugins'
  | 'plugins.watermark'
  | 'webmcp'
  | 'zoom'
  | 'page-navigation'
  | 'view-mode'
  | 'view-mode.editing'
  | 'view-mode.viewing'
  | 'view-mode.viewing.select'
  | 'view-mode.viewing.form-values'
  | 'view-mode.viewing.reorder'
  | 'view-mode.viewing.merge'
  | 'view-mode.viewing.extract'
  | 'view-mode.viewing.text-selection'
  | 'view-mode.viewing.collapse-sidebar'
  | 'view-mode.viewing.toolbar-controls'
  | 'view-mode.suggesting'
  | 'history'
  | 'watermark'
  | 'canvas-elements.duplicate'
  | 'canvas-elements.lock'
  | 'canvas-elements.delete'
  | 'canvas-elements.arrange'
  | 'canvas-elements.images'
  | 'canvas-elements.annotations'
  | 'organizer'
  | 'document-info'
  | 'text-editing'
  | 'text-editing.table-aware-clustering'
  | 'text-editing.cell-isolation'
  | 'canvas-elements'
  | 'rasterize'
  | 'flatten'
  | 'export-images'
  | 'panels'
  | 'panels.collapse-empty'
  | 'panels.unified-geometry'
  | 'panels.contextual-selection'
  | 'text'
  | 'text.presets'
  | 'text.vertical-align'
  | 'snapping'
  | 'snapping.page'
  | 'snapping.elements'
  | 'snapping.smart-guides'
  | 'snapping.spacing'
  | 'snapping.line-endpoints'
  | 'performance'
  | 'performance.virtual-rendering'
  | 'performance.fast-dimensions'
  | 'performance.fast-element-interaction'
  | 'performance.optimistic-actions'
  | 'performance.optimistic-rotation'
  | 'performance.optimistic-actions.rotation'
  | 'performance.optimistic-actions.reorder'
  | 'performance.optimistic-actions.deletion'
  | 'performance.optimistic-actions.duplicate'
  | 'performance.optimistic-actions.blank-page'
  | 'performance.optimistic-actions.thumbnails'
  | 'performance.optimistic-actions.mutation-queue'
  | 'select-tool'
  | 'select-tool.cluster'
  | 'select-tool.text'
  | 'select-tool.precise'
  | 'select-tool.marquee'
  | 'select-tool.multiselect'
  | 'select-tool.multiselect.transform'
  | 'select-tool.multiselect.modify'
  | 'select-tool.line-endpoints'
  | 'ui'
  | 'ui.concentric-radii'
  | 'ui.optical-alignment'
  | 'ui.subtle-image-outline'
  | 'ui.theme-transition-suppression'
  | 'ui.accessible-hit-targets';

/** Alias for FeatureFlag. */
export type FeatureId = FeatureFlag;

const FEATURE_FLAG_STORE_KEY = Symbol('feature-flag-store');

/** Configuration options for FeatureFlagStore initialisation. */
export interface FeatureFlagStoreOptions {
  /** Force production or development environment for testing. */
  isProduction?: boolean;
  /** Custom disabled features for test isolation. */
  disableFeatures?: readonly FeatureFlag[];
  /** Custom dev-enabled features for test isolation. */
  devEnableFeatures?: readonly FeatureFlag[];
  /** Force enable all disabled features in dev mode. */
  devEnableAll?: boolean;
}

/**
 * Detects whether the current runtime is a production environment.
 * Checks Vite import.meta.env before falling back to process.env.NODE_ENV.
 *
 * @return {boolean} True if running in production.
 */
export function isProductionEnvironment(): boolean {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    if (typeof import.meta.env.PROD === 'boolean') {
      return import.meta.env.PROD;
    }
    if (import.meta.env.MODE === 'production') {
      return true;
    }
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV === 'production';
  }
  return false;
}

/** Reactive store managing feature capability checks and dev overrides. */
export class FeatureFlagStore {
  /** Reactive set of disabled feature flags. */
  private disabledFlags = $state<Set<FeatureFlag>>(
    new Set<FeatureFlag>(DISABLE_FEATURES)
  );

  /** Map of explicit overrides (true = enabled, false = disabled). */
  private explicitOverrides = $state<Map<FeatureFlag, boolean>>(new Map());

  /** Set of features force-enabled in dev mode. */
  private devEnableFeatures = $state<Set<FeatureFlag>>(
    new Set<FeatureFlag>(DEV_ENABLE_FEATURES)
  );

  /** Whether all disabled features are force-enabled in dev mode. */
  private devEnableAll = $state<boolean>(DEV_ENABLE_ALL);

  /** Whether operating under production constraints. */
  private isProd: boolean;

  /**
   * Initialises store with optional environment and flag overrides.
   *
   * @param {FeatureFlagStoreOptions} [options] Store configuration options.
   */
  constructor(options?: FeatureFlagStoreOptions) {
    this.isProd = options?.isProduction ?? isProductionEnvironment();
    if (options?.disableFeatures) {
      this.disabledFlags = new Set<FeatureFlag>(options.disableFeatures);
    }
    if (options?.devEnableFeatures) {
      this.devEnableFeatures = new Set<FeatureFlag>(options.devEnableFeatures);
    }
    if (options?.devEnableAll !== undefined) {
      this.devEnableAll = options.devEnableAll;
    }
  }

  /**
   * Resolves whether the current context operates as production.
   *
   * @return {boolean} True if production constraints apply.
   */
  isProduction(): boolean {
    return this.isProd;
  }

  /** Whether all disabled features are force-enabled in dev mode. */
  get isDevEnableAll(): boolean {
    return this.devEnableAll;
  }

  /** Set of features force-enabled in dev mode. */
  get devEnabledFeatures(): ReadonlySet<FeatureFlag> {
    return this.devEnableFeatures;
  }

  /**
   * Checks whether a feature or parent category is in the disabled set.
   *
   * @param {FeatureFlag} flag Feature identifier to inspect.
   * @return {boolean} True if the flag or any ancestor prefix is disabled.
   */
  private isDefaultDisabled(flag: FeatureFlag): boolean {
    if (this.disabledFlags.has(flag)) {
      return true;
    }
    const parts = flag.split('.');
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}.${parts[i]}` : parts[i];
      if (this.disabledFlags.has(prefix as FeatureFlag)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks whether a feature is force-enabled for dev mode testing.
   *
   * @param {FeatureFlag} flag Feature identifier to inspect.
   * @return {boolean} True if the flag or any ancestor prefix is dev-enabled.
   */
  private isDevForceEnabled(flag: FeatureFlag): boolean {
    if (this.devEnableAll) {
      return true;
    }
    if (this.devEnableFeatures.has(flag)) {
      return true;
    }
    const parts = flag.split('.');
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}.${parts[i]}` : parts[i];
      if (this.devEnableFeatures.has(prefix as FeatureFlag)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Evaluates whether a feature is currently enabled.
   * Checks explicit overrides, parent categories, and dev force-enable rules.
   *
   * @param {FeatureFlag} flag Feature identifier to check.
   * @return {boolean} True if the feature is enabled.
   */
  isEnabled(flag: FeatureFlag): boolean {
    const directOverride = this.explicitOverrides.get(flag);
    if (directOverride === false) {
      return false;
    }

    const parts = flag.split('.');
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}.${parts[i]}` : parts[i];
      if (this.explicitOverrides.get(prefix as FeatureFlag) === false) {
        return false;
      }
    }

    if (directOverride === true) {
      return true;
    }

    if (this.isDefaultDisabled(flag)) {
      if (!this.isProduction() && this.isDevForceEnabled(flag)) {
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Disables a feature programmatically.
   *
   * @param {FeatureFlag} flag Feature identifier to disable.
   */
  disable(flag: FeatureFlag): void {
    const nextDisabled = new Set(this.disabledFlags);
    nextDisabled.add(flag);
    this.disabledFlags = nextDisabled;

    const nextOverrides = new Map(this.explicitOverrides);
    nextOverrides.set(flag, false);
    this.explicitOverrides = nextOverrides;
  }

  /**
   * Enables a feature programmatically.
   *
   * @param {FeatureFlag} flag Feature identifier to enable.
   */
  enable(flag: FeatureFlag): void {
    const nextDisabled = new Set(this.disabledFlags);
    nextDisabled.delete(flag);
    this.disabledFlags = nextDisabled;

    const nextOverrides = new Map(this.explicitOverrides);
    nextOverrides.set(flag, true);
    this.explicitOverrides = nextOverrides;
  }

  /**
   * Toggles a feature flag state.
   *
   * @param {FeatureFlag} flag Feature identifier to toggle.
   * @return {boolean} New enabled state after toggle.
   */
  toggle(flag: FeatureFlag): boolean {
    if (this.isEnabled(flag)) {
      this.disable(flag);
      return false;
    } else {
      this.enable(flag);
      return true;
    }
  }

  /** Resets all flags and overrides to configuration defaults. */
  resetAll(): void {
    this.disabledFlags = new Set<FeatureFlag>(DISABLE_FEATURES);
    this.devEnableFeatures = new Set<FeatureFlag>(DEV_ENABLE_FEATURES);
    this.devEnableAll = DEV_ENABLE_ALL;
    this.explicitOverrides = new Map();
  }

  /**
   * Returns all currently disabled feature flags.
   *
   * @return {FeatureFlag[]} Array of disabled feature identifiers.
   */
  getDisabled(): FeatureFlag[] {
    const list: FeatureFlag[] = [];
    const candidates = new Set<FeatureFlag>([
      ...DISABLE_FEATURES,
      ...this.disabledFlags,
      ...this.explicitOverrides.keys(),
    ]);
    for (const flag of candidates) {
      if (!this.isEnabled(flag)) {
        list.push(flag);
      }
    }
    return list;
  }
}

/**
 * Provides the feature flag store via Svelte context.
 *
 * @param {FeatureFlagStore} store Store instance to register.
 */
export function provideFeatureFlagStore(store: FeatureFlagStore): void {
  setContext(FEATURE_FLAG_STORE_KEY, store);
}

/**
 * Retrieves the feature flag store from Svelte context.
 *
 * @return {FeatureFlagStore} Active store instance.
 */
export function useFeatureFlagStore(): FeatureFlagStore {
  const store = getContext<FeatureFlagStore>(FEATURE_FLAG_STORE_KEY);
  if (!store) {
    throw new Error('FeatureFlagStore not found in context');
  }
  return store;
}

/**
 * Retrieves the feature flag store from Svelte context if available.
 *
 * @return {FeatureFlagStore | undefined} Active store instance or undefined.
 */
export function tryUseFeatureFlagStore(): FeatureFlagStore | undefined {
  try {
    return getContext<FeatureFlagStore | undefined>(FEATURE_FLAG_STORE_KEY);
  } catch {
    return undefined;
  }
}

export {
  DISABLE_FEATURES,
  DEV_ENABLE_FEATURES,
  DEV_ENABLE_ALL,
};
