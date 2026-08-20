/**
 * Global keyboard shortcuts handler for the PDF editor.
 */

import type { EditorStore } from '../stores/editor.svelte';
import type { EditorActions } from '../stores/editor-actions';

import type { CanvasStore } from '../stores/canvas.svelte';

export function setupKeyboardShortcuts(
  store: EditorStore,
  actions: EditorActions,
  canvasStore: CanvasStore
): () => void {
  function handleKeyDown(e: KeyboardEvent): void {
    // Ignore shortcuts when user is typing inside an input/textarea/editable element
    const target = e.target as Element | null;
    const isTyping =
      (target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          Boolean(target.closest('[contenteditable="true"]')))) ||
      store.isInlineEditing;

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

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
      // Escape: clear selection or inline edit
      if (e.key === 'Escape') {
        e.preventDefault();
        if (store.isInlineEditing) {
          actions.cancelInlineEdit();
        } else {
          actions.clearSelection(true);
          canvasStore.selectElement(null);
        }
        return;
      }

      // Delete / Backspace: delete selected text span or canvas element
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (canvasStore.selectedElementId) {
          e.preventDefault();
          const id = canvasStore.selectedElementId;
          const el = canvasStore.elements.find((item) => item.id === id);
          const kind = el?.kind ?? 'Element';
          canvasStore.removeElement(id);
          actions.recordSnapshot(`Delete ${kind}`);
          return;
        }
        if (store.hasSelection) {
          e.preventDefault();
          actions.deleteSelectedSpan();
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

  window.addEventListener('keydown', handleKeyDown);
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
  };
}
