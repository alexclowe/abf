'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, LayoutDashboard, Users, AlertTriangle, ScrollText, Layers, GitBranch, TrendingUp, ShieldCheck, BarChart3 } from 'lucide-react';
import clsx from 'clsx';

const nav = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/teams', label: 'Teams', icon: Users },
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/escalations', label: 'Escalations', icon: AlertTriangle },
  { href: '/metrics', label: 'Metrics', icon: BarChart3 },
  { href: '/kpis', label: 'KPIs', icon: TrendingUp },
  { href: '/logs', label: 'Logs', icon: ScrollText },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 min-h-screen bg-slate-900 border-r border-slate-800 flex flex-col">
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Layers className="text-sky-400" size={20} />
          <span className="font-bold text-white text-sm tracking-wide">ABF Dashboard</span>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
              pathname === href
                ? 'bg-sky-500/10 text-sky-400 font-medium'
                : 'text-slate-400 hover:text-white hover:bg-slate-800',
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t border-slate-800">
        <Link
          href="/setup"
          className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800 transition-colors"
        >
          Setup
        </Link>
      </div>
    </aside>
  );
}
