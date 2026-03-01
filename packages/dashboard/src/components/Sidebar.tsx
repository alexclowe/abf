'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, LayoutDashboard, Users, AlertTriangle, ScrollText, Layers, GitBranch, TrendingUp, ShieldCheck, BarChart3, BookOpen, Eye, Mail, Settings, MessageSquare, CreditCard } from 'lucide-react';
import clsx from 'clsx';
import useSWR from 'swr';
import { getIcon } from '../lib/icon-map';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  position?: 'main' | 'bottom';
  badge?: string;
  external?: boolean;
}

const fallbackNav = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/teams', label: 'Teams', icon: Users },
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
  { href: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { href: '/monitors', label: 'Monitors', icon: Eye },
  { href: '/message-templates', label: 'Templates', icon: Mail },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/escalations', label: 'Escalations', icon: AlertTriangle },
  { href: '/channels', label: 'Channels', icon: MessageSquare },
  { href: '/metrics', label: 'Metrics', icon: BarChart3 },
  { href: '/kpis', label: 'KPIs', icon: TrendingUp },
  { href: '/billing', label: 'Billing', icon: CreditCard },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/logs', label: 'Logs', icon: ScrollText },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : null);

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: apiNav } = useSWR<NavItem[]>(`${API_BASE}/api/navigation`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });

  // If API returned data, use it (resolving icon strings); otherwise fall back to static
  const navItems = apiNav
    ? apiNav.map(item => ({
        href: item.href,
        label: item.label,
        icon: getIcon(item.icon),
        position: item.position,
        badge: item.badge,
        external: item.external,
      }))
    : fallbackNav.map(item => ({ ...item, position: undefined as 'main' | 'bottom' | undefined, badge: undefined as string | undefined, external: undefined as boolean | undefined }));

  const mainItems = navItems.filter(item => item.position !== 'bottom');
  const bottomItems = navItems.filter(item => item.position === 'bottom');

  return (
    <aside className="w-56 min-h-screen bg-slate-900 border-r border-slate-800 flex flex-col" aria-label="Main navigation">
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Layers className="text-sky-400" size={20} />
          <span className="font-bold text-white text-sm tracking-wide">ABF Dashboard</span>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {mainItems.map(({ href, label, icon: Icon, badge, external }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
          if (external) {
            return (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onNavigate}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <Icon size={16} />
                {label}
                {badge && <span className="ml-auto text-xs bg-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded">{badge}</span>}
              </a>
            );
          }
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-sky-500/10 text-sky-400 font-medium'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800',
              )}
            >
              <Icon size={16} />
              {label}
              {badge && <span className="ml-auto text-xs bg-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded">{badge}</span>}
            </Link>
          );
        })}
      </nav>
      {bottomItems.length > 0 && (
        <div className="p-3 border-t border-slate-800 space-y-1">
          {bottomItems.map(({ href, label, icon: Icon, external }) =>
            external ? (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onNavigate}
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800 transition-colors"
              >
                <Icon size={14} />
                {label}
              </a>
            ) : (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800 transition-colors"
              >
                <Icon size={14} />
                {label}
              </Link>
            ),
          )}
        </div>
      )}
      <div className="p-3 border-t border-slate-800">
        <Link
          href="/setup"
          onClick={onNavigate}
          className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800 transition-colors"
        >
          Setup
        </Link>
      </div>
    </aside>
  );
}
