/**
 * Global keyboard shortcuts handler for the PDF editor.
 */

import type { EditorStore } from '../stores/editor.svelte';
import type { EditorActions } from '../stores/editor-actions';
import type { CanvasStore } from '../stores/canvas.svelte';

export function setupKeyboardShortcuts(
  store: EditorStore,
  actions: EditorActions,
  canvasStore: CanvasStore,
  target: EventTarget = typeof window !== 'undefined' ? window : (globalThis as unknown as EventTarget)
): () => void {
  function handleKeyDown(e: KeyboardEvent): void {
    // Ignore shortcuts when user is typing inside an input/textarea/editable element
    const target = e.target as Element | null;
    const isTyping =
      (typeof HTMLElement !== 'undefined' &&
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          Boolean(target.closest('[contenteditable="true"]')))) ||
      store.isInlineEditing;

    const isCtrlOrCmd = (e.ctrlKey || e.metaKey) && !e.altKey;

    // Escape: cancel crop, cancel inline edit, or clear selection
    if (e.key === 'Escape') {
      if (store.isCropping) {
        e.preventDefault();
        actions.cancelCropMode();
        return;
      }
      if (store.isInlineEditing) {
        e.preventDefault();
        actions.cancelInlineEdit();
        return;
      } else if (!isTyping) {
        e.preventDefault();
        actions.clearSelection(true);
        canvasStore.selectElement(null);
        return;
      }
    }

    // Enter: apply crop if in crop mode
    if (e.key === 'Enter' && store.isCropping && store.activeCrop && !isTyping) {
      e.preventDefault();
      actions.cropPage(store.activeCrop.pageIndex, store.activeCrop.margins, store.activeCrop.scope);
      return;
    }

    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: Undo & Redo
    if (isCtrlOrCmd && !isTyping) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          actions.redo();
        } else {
          actions.undo();
        }
        return;
      }
      if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        actions.redo();
        return;
      }
    }

    // Ctrl+O: Open file
    if (isCtrlOrCmd && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      actions.triggerFileOpen();
      return;
    }

    // Ctrl+S: Save/Export PDF
    if (isCtrlOrCmd && e.key.toLowerCase() === 's') {
      e.preventDefault();
      actions.exportPdf(canvasStore);
      return;
    }

    // Ctrl + Zoom controls
    if (isCtrlOrCmd) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        actions.zoomIn();
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        actions.zoomOut();
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        actions.resetZoom();
        return;
      }
    }

    // Non-typing shortcuts
    if (!isTyping) {
      // Delete / Backspace: delete selected text span or canvas element
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (canvasStore.selectedElementId || store.hasSelection) {
          e.preventDefault();
          void actions.deleteSelected();
          return;
        }
      }

      // PageUp / PageDown navigation
      if (e.key === 'PageUp') {
        e.preventDefault();
        actions.goToPrevPage();
        return;
      }
      if (e.key === 'PageDown') {
        e.preventDefault();
        actions.goToNextPage();
        return;
      }
    }
  }

  target.addEventListener('keydown', handleKeyDown as EventListener);
  return () => {
    target.removeEventListener('keydown', handleKeyDown as EventListener);
  };
}
