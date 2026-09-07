/**
 * Type definitions for industry-grade PDF compliance test documents.
 *
 * Provides metadata interfaces, category definitions, and generator contracts
 * for compliance verification across ISO 32000-1 and ISO 19005 standards.
 */

import type { CanvasElement } from '../../stores/canvas-types';

export type DemoPresetId =
  | 'iso-32000-forms'
  | 'typography-stress'
  | 'vector-graphics'
  | 'linearized-multipage'
  | 'pdfa-signatures'
  | 'annotations-redaction';

export type DemoDocumentCategory =
  | 'forms'
  | 'typography'
  | 'vector'
  | 'multipage'
  | 'security'
  | 'annotations'
  | 'general';

export interface DemoDocumentPreset {
  readonly id: DemoPresetId;
  readonly aliases: readonly string[];
  readonly title: string;
  readonly subtitle: string;
  readonly category: DemoDocumentCategory;
  readonly standard: string;
  readonly origin: string;
  readonly description: string;
  readonly fileName: string;
  readonly badge: string;
  readonly pageCount: number;
  readonly expectedCapabilities: readonly string[];
  readonly primaryUrl?: string;
  readonly remoteFallbackUrls?: readonly string[];
  readonly generateBuffer: () => Promise<Uint8Array>;
  readonly getCanvasElements?: () => Promise<CanvasElement[]> | CanvasElement[];
}

export interface DemoDocumentMetadata {
  readonly id: DemoPresetId;
  readonly aliases: readonly string[];
  readonly title: string;
  readonly subtitle: string;
  readonly category: DemoDocumentCategory;
  readonly standard: string;
  readonly origin: string;
  readonly description: string;
  readonly fileName: string;
  readonly badge: string;
  readonly pageCount: number;
  readonly expectedCapabilities: readonly string[];
  readonly primaryUrl?: string;
  readonly remoteFallbackUrls?: readonly string[];
}
