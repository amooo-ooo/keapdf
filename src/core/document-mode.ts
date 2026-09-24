/**
 * Document viewing and editing mode specification for Kea PDF.
 *
 * Provides modes:
 * - editing: Full editing, tool access, and document mutation capabilities.
 * - viewing: Strict read-only mode for document layout with text selection and highlighting conforming to browser PDF viewers.
 * - suggesting: Annotation and review mode permitting comments and notes whilst guarding content.
 */

import type { EditorTool, LeftPanelMode } from '../stores/types';

/** Document viewing mode identifiers. */
export type DocumentViewMode = 'editing' | 'viewing' | 'suggesting';

/** Mode descriptor and capability matrix. */
export interface ViewModeConfig {
  readonly id: DocumentViewMode;
  readonly label: string;
  readonly description: string;
  readonly allowedTabs: readonly LeftPanelMode[];
  readonly allowedTools: readonly EditorTool[];
  readonly isReadOnly: boolean;
  readonly canEditContent: boolean;
  readonly canAnnotate: boolean;
  readonly canMutateDocument: boolean;
  readonly canSelectElements: boolean;
  readonly canEditValues: boolean;
  readonly canReorderPages: boolean;
  readonly canMergeFiles: boolean;
  readonly canExtractPages: boolean;
  readonly canExtractImages: boolean;
  readonly canMoveElements: boolean;
  readonly canResizeElements: boolean;
  readonly canDeleteElements: boolean;
}

/** Pre-configured definitions for each document viewing mode. */
export const VIEW_MODE_CONFIGS: Readonly<Record<DocumentViewMode, ViewModeConfig>> = {
  editing: {
    id: 'editing',
    label: 'Editing',
    description: 'Edit document directly',
    allowedTabs: ['workspace', 'components', 'annotate', 'tools', 'settings'],
    allowedTools: [
      'select',
      'hand',
      'text',
      'place',
      'highlight',
      'pen',
      'signature',
      'note',
      'redact',
      'eraser',
    ],
    isReadOnly: false,
    canEditContent: true,
    canAnnotate: true,
    canMutateDocument: true,
    canSelectElements: true,
    canEditValues: true,
    canReorderPages: true,
    canMergeFiles: true,
    canExtractPages: true,
    canExtractImages: true,
    canMoveElements: true,
    canResizeElements: true,
    canDeleteElements: true,
  },
  suggesting: {
    id: 'suggesting',
    label: 'Suggesting',
    description: 'Edits become suggestions',
    allowedTabs: ['workspace', 'annotate', 'settings'],
    allowedTools: ['select', 'hand', 'note', 'highlight'],
    isReadOnly: false,
    canEditContent: false,
    canAnnotate: true,
    canMutateDocument: false,
    canSelectElements: true,
    canEditValues: false,
    canReorderPages: false,
    canMergeFiles: false,
    canExtractPages: true,
    canExtractImages: true,
    canMoveElements: true,
    canResizeElements: false,
    canDeleteElements: false,
  },
  viewing: {
    id: 'viewing',
    label: 'View',
    description: 'Read-only view without changes',
    allowedTabs: ['workspace', 'settings'],
    allowedTools: ['select', 'hand'],
    isReadOnly: true,
    canEditContent: false,
    canAnnotate: false,
    canMutateDocument: false,
    canSelectElements: false,
    canEditValues: false,
    canReorderPages: false,
    canMergeFiles: false,
    canExtractPages: false,
    canExtractImages: false,
    canMoveElements: false,
    canResizeElements: false,
    canDeleteElements: false,
  },
};

/** All available mode options for UI presentation. */
export const VIEW_MODE_OPTIONS: readonly ViewModeConfig[] = [
  VIEW_MODE_CONFIGS.editing,
  VIEW_MODE_CONFIGS.suggesting,
  VIEW_MODE_CONFIGS.viewing,
];

/** Mutation operation descriptions permitted in viewing mode. */
export const VIEWING_MODE_ALLOWED_MUTATIONS: readonly string[] = [];

/**
 * Retrieves the configuration and capability matrix for a viewing mode.
 *
 * @param mode Target document viewing mode.
 * @return Corresponding mode configuration.
 */
export function getViewModeConfig(mode: DocumentViewMode): ViewModeConfig {
  return VIEW_MODE_CONFIGS[mode] ?? VIEW_MODE_CONFIGS.editing;
}

/**
 * Validates whether a sidebar tab is accessible in the specified mode.
 *
 * @param mode Target viewing mode.
 * @param tabId Identifier of the sidebar panel tab.
 * @return True if the tab is permitted, false otherwise.
 */
export function isTabAllowedInMode(mode: DocumentViewMode, tabId: string): boolean {
  const config = getViewModeConfig(mode);
  return config.allowedTabs.includes(tabId as LeftPanelMode);
}

/**
 * Validates whether an editor tool is accessible in the specified mode.
 *
 * @param mode Target viewing mode.
 * @param toolId Identifier of the editor tool.
 * @return True if the tool is permitted, false otherwise.
 */
export function isToolAllowedInMode(mode: DocumentViewMode, toolId: string): boolean {
  const config = getViewModeConfig(mode);
  return config.allowedTools.includes(toolId as EditorTool);
}

/**
 * Validates whether a specific document mutation operation is permitted in a mode.
 *
 * @param mode Target document viewing mode.
 * @param operationName Description of the document mutation operation.
 * @return True if permitted, false otherwise.
 */
export function isMutationAllowedInMode(mode: DocumentViewMode, operationName: string): boolean {
  if (mode === 'editing') {
    return true;
  }
  if (mode === 'viewing') {
    return VIEWING_MODE_ALLOWED_MUTATIONS.includes(operationName);
  }
  return false;
}
