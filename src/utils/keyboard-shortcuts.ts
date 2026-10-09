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
    if (e.defaultPrevented) return;

    // Ignore shortcuts when user is typing inside an input/textarea/editable element
    const target = e.target as (Element & { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => Element | null }) | null;
    const isTyping =
      Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable ||
            target.closest?.('[contenteditable="true"]'))
      ) || store.isInlineEditing;

    const isCtrlOrCmd = (e.ctrlKey || e.metaKey) && !e.altKey;

    // Ctrl+A: Select all items in active workspace section if left panel workspace tab is active
    if (isCtrlOrCmd && !isTyping && e.key.toLowerCase() === 'a') {
      const isInsideCanvas = Boolean(
        target && (target.closest?.('.canvas-container') || target.closest?.('[data-page-element]'))
      );

      if (!isInsideCanvas && store.leftPanelMode === 'workspace' && !store.leftPanelCollapsed) {
        e.preventDefault();
        actions.selectAllInWorkspaceSection();
        return;
      }
    }

    // Ctrl+Alt+G: Open Component Variant Gallery
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      store.openComponentGalleryDialog();
      return;
    }

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

    // Enter: apply crop if in crop mode, or deselect active selection when not typing
    if (e.key === 'Enter') {
      if (store.isCropping && store.activeCrop && !isTyping) {
        e.preventDefault();
        actions.cropPage(store.activeCrop.pageIndex, store.activeCrop.margins, store.activeCrop.scope);
        return;
      }
      if (!isTyping && !store.isCropping) {
        const hasWindowSelection = typeof window !== 'undefined' && window.getSelection && !window.getSelection()?.isCollapsed;
        if (store.hasSelection || canvasStore.selectedElementId || store.selectedSpan || hasWindowSelection) {
          e.preventDefault();
          if (hasWindowSelection) {
            window.getSelection()?.removeAllRanges();
          }
          actions.clearSelection(true);
          canvasStore.selectElement(null);
          return;
        }
      }
    }

    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: Undo & Redo
    if (isCtrlOrCmd && !isTyping && (!store.isReadOnly || store.canAnnotate)) {
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

    // Ctrl+D: Duplicate selected canvas element or PDF span
    if (isCtrlOrCmd && !isTyping && !store.isReadOnly && e.key.toLowerCase() === 'd') {
      if (canvasStore.selectedElementId || store.hasSelection || store.selectedSpan) {
        e.preventDefault();
        if (store.selectedSpans && store.selectedSpans.length > 0 && typeof actions.extractSelectedSpansToCanvas === 'function') {
          void actions.extractSelectedSpansToCanvas(undefined, canvasStore).then(() => {
            actions.canvasActions?.duplicateSelectedElement();
          });
        } else {
          actions.canvasActions?.duplicateSelectedElement();
        }
        return;
      }
    }

    // Ctrl/Cmd + [ or ]: Arrange and layer stacking order shortcuts
    if (isCtrlOrCmd && !isTyping && !store.isReadOnly) {
      if (canvasStore.selectedElementId || store.hasSelection || store.selectedSpan) {
        if (e.key === ']' || e.key === '}') {
          e.preventDefault();
          if (e.shiftKey) {
            void actions.bringSelectedToFront();
          } else {
            void actions.bringSelectedForward();
          }
          return;
        }
        if (e.key === '[' || e.key === '{') {
          e.preventDefault();
          if (e.shiftKey) {
            void actions.sendSelectedToBack();
          } else {
            void actions.sendSelectedBackward();
          }
          return;
        }
      }
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
      // V: activate Select tool
      if (!isCtrlOrCmd && !e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        actions.setSelectMode('select');
        return;
      }

      // Delete / Backspace: delete selected text span or canvas element
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.isReadOnly) return;
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
