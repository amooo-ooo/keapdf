import { SvelteSet } from 'svelte/reactivity';

export type WorkspaceSection = 'files' | 'pages' | 'outline';

export class SelectionStore {
  selectedIds = new SvelteSet<string>();
  lastSelectedId = $state<string | null>(null);
  activeSection = $state<WorkspaceSection | null>(null);

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  setActiveSection(section: WorkspaceSection | null): void {
    this.activeSection = section;
  }

  selectAll(ids: string[]): void {
    this.selectedIds.clear();
    for (const id of ids) {
      this.selectedIds.add(id);
    }
    if (ids.length > 0) {
      if (!this.lastSelectedId || !this.selectedIds.has(this.lastSelectedId)) {
        this.lastSelectedId = ids[ids.length - 1];
      }
      const firstId = ids[0];
      if (firstId.startsWith('file_')) {
        this.activeSection = 'files';
      } else if (firstId.startsWith('page_')) {
        this.activeSection = 'pages';
      } else if (firstId.startsWith('outline_')) {
        this.activeSection = 'outline';
      }
    } else {
      this.lastSelectedId = null;
    }
  }

  select(
    id: string,
    ctrlKey: boolean,
    shiftKey: boolean,
    getRange?: (startId: string, endId: string) => string[]
  ) {
    if (id.startsWith('file_')) {
      this.activeSection = 'files';
    } else if (id.startsWith('page_')) {
      this.activeSection = 'pages';
    } else if (id.startsWith('outline_')) {
      this.activeSection = 'outline';
    }

    if (shiftKey && this.lastSelectedId && getRange) {
      const range = getRange(this.lastSelectedId, id);
      if (!ctrlKey) {
        this.selectedIds.clear();
      }
      for (const item of range) {
        this.selectedIds.add(item);
      }
    } else if (ctrlKey) {
      if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
      } else {
        this.selectedIds.add(id);
      }
      this.lastSelectedId = id;
    } else {
      this.selectedIds.clear();
      this.selectedIds.add(id);
      this.lastSelectedId = id;
    }
  }

  clear() {
    this.selectedIds.clear();
    this.lastSelectedId = null;
  }
}

const globalSelection = new SelectionStore();

export function useSelection(): SelectionStore {
  return globalSelection;
}
