/**
 * Built-in plugins barrel export and registration helpers.
 */

import type { PluginManager } from '../core/plugin-manager';
import { watermarkPlugin } from './watermark-plugin';

/**
 * Registers all default built-in plugins into the plugin manager.
 *
 * @param manager The plugin manager instance.
 */
export async function registerBuiltinPlugins(manager: PluginManager): Promise<void> {
  await manager.register(watermarkPlugin);
}

export { watermarkPlugin };
