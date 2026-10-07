/**
 * Submenu level coordination and portal interaction helpers for DropdownMenu.
 *
 * Ensures mutual exclusion across sibling submenus within the same menu level,
 * cascades close state down to nested child submenus when a parent submenu
 * closes, and disengages ancestor pointer-intent timers when entering nested
 * portaled submenu surfaces.
 */

import { getContext, setContext } from 'svelte';

const MENU_LEVEL_CONTEXT_KEY = Symbol('dropdown-menu-level-coordinator');
const SUBMENU_CONTROLLER_CONTEXT_KEY = Symbol('dropdown-menu-submenu-controller');

/** Registration contract for a single submenu instance within a menu level. */
export interface SubmenuEntry {
  readonly id: string;
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
}

/** Configuration options for constructing a SubmenuController. */
export interface SubmenuControllerOptions {
  readonly id: string;
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
  parentLevel?: MenuLevelCoordinator;
}

/**
 * Coordinates sibling submenus registered within a single menu content level.
 */
export class MenuLevelCoordinator {
  private readonly subs = new Map<string, SubmenuEntry>();
  private readonly unregisterFromParent: (() => void) | undefined;

  /**
   * Initialises a menu level coordinator and optionally attaches it to a parent submenu.
   *
   * @param parentSub Optional parent submenu controller when this level is a SubContent.
   */
  constructor(parentSub?: SubmenuController) {
    if (parentSub) {
      this.unregisterFromParent = parentSub.registerChildLevel(this);
    }
  }

  /**
   * Registers a child submenu at this menu level.
   *
   * @param entry Submenu entry callbacks.
   * @return Cleanup function removing the submenu registration.
   */
  registerSub(entry: SubmenuEntry): () => void {
    this.subs.set(entry.id, entry);
    return () => {
      if (this.subs.get(entry.id) === entry) {
        this.subs.delete(entry.id);
      }
    };
  }

  /**
   * Closes all sibling submenus at this level other than the specified submenu id.
   *
   * @param activeId Identifier of the submenu that should remain open.
   */
  notifySubOpened(activeId: string): void {
    for (const [id, entry] of this.subs.entries()) {
      if (id !== activeId && entry.isOpen()) {
        entry.setOpen(false);
      }
    }
  }

  /**
   * Opens the specified submenu and closes all other sibling submenus at this level.
   *
   * @param targetId Identifier of the submenu to open exclusively.
   */
  openExclusive(targetId: string): void {
    this.notifySubOpened(targetId);
    const target = this.subs.get(targetId);
    if (target && !target.isOpen()) {
      target.setOpen(true);
    }
  }

  /**
   * Closes all submenus registered at this menu level.
   */
  closeAllSubs(): void {
    for (const entry of this.subs.values()) {
      if (entry.isOpen()) {
        entry.setOpen(false);
      }
    }
  }

  /**
   * Checks whether any submenu at this menu level is currently open.
   *
   * @return True if at least one registered submenu is open.
   */
  hasOpenSub(): boolean {
    for (const entry of this.subs.values()) {
      if (entry.isOpen()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Detaches this menu level coordinator from its parent submenu controller.
   */
  dispose(): void {
    this.unregisterFromParent?.();
    this.subs.clear();
  }
}

/**
 * Manages open state and nested child levels for an individual DropdownMenu.Sub instance.
 */
export class SubmenuController {
  readonly id: string;
  private readonly getOpen: () => boolean;
  private readonly applyOpen: (open: boolean) => void;
  private readonly parentLevel: MenuLevelCoordinator | undefined;
  private readonly childLevels = new Set<MenuLevelCoordinator>();
  private readonly unregisterFromLevel: (() => void) | undefined;

  /**
   * Initialises a submenu controller and registers it with its parent menu level.
   *
   * @param options Submenu controller configuration options.
   */
  constructor(options: SubmenuControllerOptions) {
    this.id = options.id;
    this.getOpen = options.isOpen;
    this.applyOpen = options.setOpen;
    this.parentLevel = options.parentLevel;

    if (this.parentLevel) {
      this.unregisterFromLevel = this.parentLevel.registerSub({
        id: this.id,
        isOpen: () => this.isOpen(),
        setOpen: (nextOpen: boolean) => this.setOpen(nextOpen),
      });
    }
  }

  /**
   * Returns whether this submenu is currently open.
   *
   * @return True if open.
   */
  isOpen(): boolean {
    return this.getOpen();
  }

  /**
   * Updates the open state of this submenu and synchronises parent and child levels.
   *
   * @param nextOpen Target open state.
   */
  setOpen(nextOpen: boolean): void {
    if (nextOpen) {
      this.parentLevel?.notifySubOpened(this.id);
      if (!this.getOpen()) {
        this.applyOpen(true);
      }
    } else {
      this.closeChildLevels();
      if (this.getOpen()) {
        this.applyOpen(false);
      }
    }
  }

  /**
   * Opens this submenu exclusively within its parent menu level.
   */
  open(): void {
    this.setOpen(true);
  }

  /**
   * Closes this submenu and any nested child submenus.
   */
  close(): void {
    this.setOpen(false);
  }

  /**
   * Synchronises external open state transitions with sibling and child coordinators.
   *
   * @param nextOpen Current open state.
   */
  handleOpenChange(nextOpen: boolean): void {
    if (nextOpen) {
      this.parentLevel?.notifySubOpened(this.id);
    } else {
      this.closeChildLevels();
    }
  }

  /**
   * Registers a nested child menu level belonging to this submenu's SubContent.
   *
   * @param level Child menu level coordinator.
   * @return Cleanup callback removing the child level registration.
   */
  registerChildLevel(level: MenuLevelCoordinator): () => void {
    this.childLevels.add(level);
    return () => {
      this.childLevels.delete(level);
    };
  }

  /**
   * Closes all submenus registered inside nested child levels.
   */
  closeChildLevels(): void {
    for (const level of this.childLevels) {
      level.closeAllSubs();
    }
  }

  /**
   * Cleans up registrations when the submenu unmounts.
   */
  dispose(): void {
    this.closeChildLevels();
    this.childLevels.clear();
    this.unregisterFromLevel?.();
  }
}

/**
 * Creates and provides a MenuLevelCoordinator in Svelte context.
 *
 * @param parentSub Optional parent submenu controller when inside a SubContent.
 * @return Created MenuLevelCoordinator instance.
 */
export function provideMenuLevelContext(parentSub?: SubmenuController): MenuLevelCoordinator {
  const coordinator = new MenuLevelCoordinator(parentSub);
  setContext(MENU_LEVEL_CONTEXT_KEY, coordinator);
  return coordinator;
}

/**
 * Retrieves the nearest MenuLevelCoordinator from Svelte context if present.
 *
 * @return Active MenuLevelCoordinator or undefined.
 */
export function useMenuLevelContext(): MenuLevelCoordinator | undefined {
  try {
    return getContext<MenuLevelCoordinator | undefined>(MENU_LEVEL_CONTEXT_KEY);
  } catch {
    return undefined;
  }
}

/**
 * Creates and provides a SubmenuController in Svelte context.
 *
 * @param options Submenu controller configuration options.
 * @return Created SubmenuController instance.
 */
export function provideSubmenuController(options: SubmenuControllerOptions): SubmenuController {
  const controller = new SubmenuController(options);
  setContext(SUBMENU_CONTROLLER_CONTEXT_KEY, controller);
  return controller;
}

/**
 * Retrieves the nearest SubmenuController from Svelte context if present.
 *
 * @return Active SubmenuController or undefined.
 */
export function useSubmenuController(): SubmenuController | undefined {
  try {
    return getContext<SubmenuController | undefined>(SUBMENU_CONTROLLER_CONTEXT_KEY);
  } catch {
    return undefined;
  }
}

/**
 * Checks whether an event target resides inside a dropdown submenu content element.
 *
 * @param target Event target to inspect.
 * @return True if target is inside a submenu content surface.
 */
export function isTargetInsideSubContent(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest('[data-dropdown-menu-sub-content], [data-slot="dropdown-menu-sub-content"]')
  );
}

/**
 * Disengages pointer-intent timers on any ancestor submenu content elements when
 * the pointer enters a nested portaled submenu content surface.
 *
 * @param subContentEl Nested submenu content element that received pointerenter.
 * @param pointerType Pointer type string, defaulting to mouse.
 * @param clientX Optional pointer client X coordinate.
 * @param clientY Optional pointer client Y coordinate.
 */
export function disengageAncestorSubContentIntent(
  subContentEl: HTMLElement | null,
  pointerType: string = 'mouse',
  clientX: number = 0,
  clientY: number = 0
): void {
  if (!subContentEl || typeof document === 'undefined' || typeof PointerEvent === 'undefined') {
    return;
  }

  let currentContent: HTMLElement | null = subContentEl;
  const visited = new Set<HTMLElement>();

  while (currentContent && !visited.has(currentContent)) {
    visited.add(currentContent);
    const contentId: string = currentContent.id;
    if (!contentId) {
      break;
    }

    const triggerEl: Element | null = document.querySelector(`[aria-controls="${contentId}"]`);
    if (!(triggerEl instanceof HTMLElement)) {
      break;
    }

    const ancestorEl: Element | null = triggerEl.closest(
      '[data-dropdown-menu-sub-content], [data-slot="dropdown-menu-sub-content"]'
    );
    if (!(ancestorEl instanceof HTMLElement) || ancestorEl === currentContent) {
      break;
    }

    ancestorEl.dispatchEvent(
      new PointerEvent('pointerenter', {
        bubbles: false,
        cancelable: false,
        pointerType: pointerType || 'mouse',
        clientX,
        clientY,
      })
    );

    currentContent = ancestorEl;
  }
}
