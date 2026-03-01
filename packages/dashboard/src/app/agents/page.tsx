'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useEventStream } from '@/lib/use-event-stream';
import { AgentStatusBadge } from '@/components/AgentStatusBadge';
import { MessageSquare, Search } from 'lucide-react';

export default function AgentsPage() {
  const { data: stream } = useEventStream();
  const sseHasAgents = !!stream?.agents?.[0]?.config;
  const { data: swrAgents, error } = useSWR(!sseHasAgents ? 'agents' : null, () => api.agents.list(), { refreshInterval: 3000 });
  const agents = (sseHasAgents ? stream!.agents : swrAgents) as { config: Record<string, any>; state?: Record<string, any> | null }[] | undefined;

  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');

  // Derive unique teams for filter dropdown
  const teams = useMemo(() => {
    if (!agents) return [];
    const set = new Set(agents.map((a) => a.config.team).filter(Boolean));
    return Array.from(set).sort();
  }, [agents]);

  // Filter agents
  const filteredAgents = useMemo(() => {
    if (!agents) return undefined;
    return agents.filter((a) => {
      const q = search.toLowerCase();
      const matchesSearch = !q ||
        a.config.displayName?.toLowerCase().includes(q) ||
        a.config.name?.toLowerCase().includes(q) ||
        a.config.role?.toLowerCase().includes(q);
      const matchesTeam = !teamFilter || a.config.team === teamFilter;
      return matchesSearch && matchesTeam;
    });
  }, [agents, search, teamFilter]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agents</h1>
        <Link
          href="/agents/new"
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
        >
          + New Agent
        </Link>
      </div>

      {/* Search and filter */}
      {agents && agents.length > 0 && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or role..."
              className="w-full bg-slate-800 border border-slate-700 rounded-md pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          {teams.length > 1 && (
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
            >
              <option value="">All Teams</option>
              {teams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load agents: {error.message}
        </div>
      )}

      {agents && agents.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <p className="text-slate-400 mb-3">No agents configured yet.</p>
          <Link
            href="/agents/new"
            className="inline-block px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            Create your first agent
          </Link>
        </div>
      )}

      {filteredAgents && agents && agents.length > 0 && filteredAgents.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 text-center">
          <p className="text-slate-400 text-sm">No agents match your filter.</p>
        </div>
      )}

      <div className="space-y-2">
        {filteredAgents?.map((a) => (
          <Link
            key={a.config.id}
            href={`/agents/${a.config.id}`}
            className="block bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-700 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{a.config.displayName}</span>
                  <AgentStatusBadge status={a.state?.status ?? 'idle'} />
                </div>
                <div className="text-sm text-slate-400 mt-1">{a.config.role}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-sm">
                  {a.config.team && (
                    <div className="text-slate-500">Team: {a.config.team}</div>
                  )}
                  <div className="text-slate-500">
                    Sessions: {a.state?.sessionsCompleted ?? 0}
                  </div>
                  <div className="text-slate-500">
                    Cost: ${((a.state?.totalCost ?? 0) / 100).toFixed(4)}
                  </div>
                </div>
                <Link
                  href={`/agents/${a.config.id}/chat`}
                  onClick={(e) => e.stopPropagation()}
                  className="p-2 bg-slate-800 hover:bg-slate-700 rounded-md border border-slate-700 transition-colors"
                  title="Chat with agent"
                >
                  <MessageSquare size={14} className="text-slate-400" />
                </Link>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
