import { SvelteSet } from 'svelte/reactivity';

export class SelectionStore {
  selectedIds = new SvelteSet<string>();
  lastSelectedId = $state<string | null>(null);

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  select(
    id: string,
    ctrlKey: boolean,
    shiftKey: boolean,
    getRange?: (startId: string, endId: string) => string[]
  ) {
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
