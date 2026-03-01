/**
 * PluginRegistry — manages dashboard plugins that inject nav items and UI extensions.
 * Created in factory.ts, passed to gateway, exposed on runtime for cloud repo usage.
 */
import type { DashboardNavItem, DashboardPlugin } from '../../types/plugin.js';

export class PluginRegistry {
	private readonly plugins = new Map<string, DashboardPlugin>();

	/** Register a plugin. Overwrites if same ID already registered. */
	register(plugin: DashboardPlugin): void {
		this.plugins.set(plugin.id, plugin);
	}

	/** Remove a plugin by ID. */
	unregister(id: string): void {
		this.plugins.delete(id);
	}

	/** Get merged nav items from all registered plugins. */
	getNavItems(): DashboardNavItem[] {
		const items: DashboardNavItem[] = [];
		for (const plugin of this.plugins.values()) {
			items.push(...plugin.navItems);
		}
		return items;
	}

	/** Get all registered plugins. */
	getPlugins(): DashboardPlugin[] {
		return [...this.plugins.values()];
	}
}
