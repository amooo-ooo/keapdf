/**
 * Central state store managing Progressive Web App (PWA) lifecycle.
 *
 * Coordinates service worker registration, offline cache readiness,
 * application update notifications, and browser installation prompts.
 */

import { getContext, setContext } from 'svelte';
import type { BeforeInstallPromptEvent } from './pwa-types';

const PWA_STORE_KEY = Symbol('PWA_STORE');

export class PwaStore {
  isOfflineReady = $state(false);
  needRefresh = $state(false);
  isOnline = $state(typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true);
  isInstalled = $state(false);
  deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);

  private updateServiceWorkerFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private cleanupListeners: (() => void) | null = null;

  get canInstall(): boolean {
    return this.deferredPrompt !== null && !this.isInstalled;
  }

  get isSupported(): boolean {
    return typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  }

  constructor() {
    this.initialiseEnvironment();
  }

  /**
   * Initialise browser event listeners and service worker registration.
   */
  private initialiseEnvironment(): void {
    if (typeof window === 'undefined') return;

    // Detect standalone display mode indicating installed status
    const isStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
    const isIosStandalone = Boolean((navigator as unknown as { standalone?: boolean })?.standalone);
    if (isStandalone || isIosStandalone) {
      this.isInstalled = true;
    }

    const handleOnline = (): void => {
      this.isOnline = true;
    };

    const handleOffline = (): void => {
      this.isOnline = false;
    };

    const handleBeforeInstallPrompt = (event: Event): void => {
      // Prevent browser default mini-infobar to control install timing
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
    };

    const handleAppInstalled = (): void => {
      this.isInstalled = true;
      this.deferredPrompt = null;
    };

    const handleLoad = (): void => {
      void this.checkForUpdates();
    };

    const handleVisibilityChange = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void this.checkForUpdates();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      if (document.readyState === 'complete') {
        void this.checkForUpdates();
      } else if (typeof window.addEventListener === 'function') {
        window.addEventListener('load', handleLoad, { once: true });
      }
    }

    this.cleanupListeners = (): void => {
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.removeEventListener('appinstalled', handleAppInstalled);
        window.removeEventListener('load', handleLoad);
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };

    this.initialiseServiceWorker();
  }

  /**
   * Dynamically import and register the Workbox service worker.
   */
  private initialiseServiceWorker(): void {
    if (!this.isSupported) return;

    void import('virtual:pwa-register')
      .then(({ registerSW }) => {
        this.updateServiceWorkerFn = registerSW({
          immediate: true,
          onNeedRefresh: () => {
            this.needRefresh = true;
          },
          onOfflineReady: () => {
            this.isOfflineReady = true;
          },
          onRegistered: (reg: ServiceWorkerRegistration | undefined) => {
            this.registration = reg ?? null;
            if (this.registration) {
              void this.checkForUpdates();
            }
          },
          onRegisterError: (error: unknown) => {
            console.warn('[PWA] Service worker registration error:', error);
          },
        });
      })
      .catch((error: unknown) => {
        console.warn('[PWA] Failed to load registration virtual module:', error);
      });
  }

  /**
   * Present the native browser installation prompt dialog.
   */
  async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) return false;

    try {
      await this.deferredPrompt.prompt();
      const choice = await this.deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        this.isInstalled = true;
        this.deferredPrompt = null;
        return true;
      }
      return false;
    } catch (err: unknown) {
      console.warn('[PWA] Install prompt failed:', err);
    }
    return false;
  }

  /**
   * Activate the waiting service worker and reload the application.
   */
  async updateApp(): Promise<void> {
    if (this.updateServiceWorkerFn) {
      await this.updateServiceWorkerFn(true);
    } else {
      window.location.reload();
    }
  }

  /**
   * Dismiss the current offline ready or update available toast notification.
   */
  dismissNotification(): void {
    this.isOfflineReady = false;
    this.needRefresh = false;
  }

  /**
   * Trigger an explicit check for service worker updates against the server.
   *
   * Awaits service worker registration readiness if not already populated.
   */
  async checkForUpdates(): Promise<void> {
    try {
      if (!this.registration && this.isSupported) {
        this.registration = await navigator.serviceWorker.ready;
      }
      if (this.registration) {
        await this.registration.update();
      }
    } catch (err: unknown) {
      console.warn('[PWA] Service worker update check failed:', err);
    }
  }

  /**
   * Release event listeners and resources on teardown.
   */
  dispose(): void {
    if (this.cleanupListeners) {
      this.cleanupListeners();
      this.cleanupListeners = null;
    }
  }
}

/**
 * Provide the PwaStore instance into Svelte component context.
 */
export function providePwaStore(store: PwaStore): void {
  setContext(PWA_STORE_KEY, store);
}

/**
 * Access the PwaStore instance from Svelte component context.
 */
export function usePwaStore(): PwaStore {
  return getContext<PwaStore>(PWA_STORE_KEY);
}
