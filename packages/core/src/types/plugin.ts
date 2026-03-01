/**
 * Dashboard plugin types — extension points for injecting UI elements.
 * Used by the cloud repo to add nav items, pages, etc. without forking.
 */

export interface DashboardNavItem {
	readonly href: string;
	readonly label: string;
	readonly icon: string;
	readonly position?: 'main' | 'bottom';
	readonly badge?: string;
	readonly external?: boolean;
}

export interface DashboardPlugin {
	readonly id: string;
	readonly name: string;
	readonly navItems: readonly DashboardNavItem[];
}
