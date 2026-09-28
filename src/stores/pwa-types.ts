/**
 * Progressive Web Application (PWA) type definitions.
 *
 * Provides typed interfaces for native browser installation events,
 * service worker registration options, and offline lifecycle state.
 */

/**
 * Native browser event fired before displaying the installation prompt.
 */
export interface BeforeInstallPromptEvent extends Event {
  /**
   * Platforms available for installation.
   */
  readonly platforms: string[];

  /**
   * User selection promise resolved after responding to prompt.
   */
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;

  /**
   * Trigger the native installation dialog.
   */
  prompt(): Promise<void>;
}

/**
 * Lifecycle status of service worker and offline capability.
 */
export type PwaOfflineStatus = 'idle' | 'checking' | 'ready' | 'update-available' | 'offline';

/**
 * Installation outcome state for the application.
 */
export type PwaInstallState = 'unsupported' | 'available' | 'installing' | 'installed';
