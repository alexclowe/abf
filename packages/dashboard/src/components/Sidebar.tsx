'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Bot, LayoutDashboard, Users, Bell, ScrollText, Layers, GitBranch, TrendingUp, ShieldCheck, BarChart3, BookOpen, Eye, Mail, Inbox, Settings, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import useSWR from 'swr';
import { getIcon } from '../lib/icon-map';
import { useEventStream } from '@/lib/event-stream-provider';

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
  { href: '/mail', label: 'Mail', icon: Inbox },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
  { href: '/monitors', label: 'Monitors', icon: Eye },
  { href: '/message-templates', label: 'Templates', icon: Mail },
  { href: '/metrics', label: 'Metrics', icon: BarChart3 },
  { href: '/kpis', label: 'KPIs', icon: TrendingUp },
  { href: '/logs', label: 'Logs', icon: ScrollText },
];

const mainNavItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/teams', label: 'Teams', icon: Users },
  { href: '/mail', label: 'Mail', icon: Inbox },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const advancedNavItems = [
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
  { href: '/monitors', label: 'Monitors', icon: Eye },
  { href: '/message-templates', label: 'Templates', icon: Mail },
  { href: '/metrics', label: 'Metrics', icon: BarChart3 },
  { href: '/kpis', label: 'KPIs', icon: TrendingUp },
  { href: '/logs', label: 'Logs', icon: ScrollText },
];

const API_BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? '';
const apiKey = process.env.NEXT_PUBLIC_ABF_API_KEY;
const fetcher = (url: string) => fetch(url, {
  headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
}).then(r => r.ok ? r.json() : null);

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Persist Advanced section state in localStorage
  useEffect(() => {
    const stored = localStorage.getItem('abf-sidebar-advanced');
    if (stored === 'true') setShowAdvanced(true);
  }, []);
  const toggleAdvanced = () => {
    setShowAdvanced(prev => {
      localStorage.setItem('abf-sidebar-advanced', String(!prev));
      return !prev;
    });
  };

  const { data: apiNav } = useSWR<NavItem[]>(`${API_BASE}/api/navigation`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const { data: config } = useSWR<Record<string, unknown>>(`${API_BASE}/api/config`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 120_000,
  });
  const projectName = typeof config?.name === 'string' ? config.name : 'ABF Dashboard';

  // Fetch pending approval/escalation counts for badges
  const { data: approvals } = useSWR(`${API_BASE}/api/approvals?status=pending`, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });
  const { data: escalations } = useSWR(`${API_BASE}/api/alerts`, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });
  const pendingApprovals = Array.isArray(approvals) ? approvals.length : 0;
  const openEscalations = Array.isArray(escalations) ? escalations.filter((e: Record<string, unknown>) => !e.resolved).length : 0;

  // Agent message badge — count messages newer than last seen timestamp
  const { data: stream } = useEventStream();
  const [lastSeenTs, setLastSeenTs] = useState(0);
  useEffect(() => {
    setLastSeenTs(Number(localStorage.getItem('abf-agent-msg-seen') ?? '0'));
  }, []);
  const unreadAgentMsgs = (stream?.agentMessages ?? [])
    .filter(m => m.timestamp > lastSeenTs).length;

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
          <span className="font-bold text-white text-sm tracking-wide">{projectName}</span>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {apiNav ? (
          /* API-provided nav — flat list */
          mainItems.map(({ href, label, icon: Icon, badge, external }) => {
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
          })
        ) : (
          /* Fallback: Your Company + collapsible Advanced */
          <>
            <div className="mb-2">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                Your Company
              </div>
              {mainNavItems.map(({ href, label, icon: Icon }) => {
                const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
                const badgeCount = href === '/approvals' ? pendingApprovals
                  : href === '/alerts' ? openEscalations
                  : href === '/mail' ? unreadAgentMsgs
                  : 0;
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
                    <div className="relative">
                      <Icon size={16} />
                      {badgeCount > 0 && (
                        <span className="absolute -top-1 -right-1.5 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                        </span>
                      )}
                    </div>
                    {label}
                    {badgeCount > 0 && (
                      <span className="ml-auto text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium min-w-[1.25rem] text-center">
                        {badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            <div className="mb-2">
              <button
                type="button"
                onClick={toggleAdvanced}
                className="w-full flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-400 transition-colors"
              >
                {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Advanced
              </button>
              {showAdvanced && advancedNavItems.map(({ href, label, icon: Icon }) => {
                const isActive = pathname.startsWith(href);
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
                  </Link>
                );
              })}
            </div>
          </>
        )}
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
