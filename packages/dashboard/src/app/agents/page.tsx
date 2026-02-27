'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useEventStream } from '@/lib/use-event-stream';
import { AgentStatusBadge } from '@/components/AgentStatusBadge';

export default function AgentsPage() {
  const { data: stream } = useEventStream();
  const sseHasAgents = !!stream?.agents?.[0]?.config;
  const { data: swrAgents, error } = useSWR(!sseHasAgents ? 'agents' : null, () => api.agents.list(), { refreshInterval: 3000 });
  const agents = (sseHasAgents ? stream!.agents : swrAgents) as { config: Record<string, any>; state?: Record<string, any> | null }[] | undefined;

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

      <div className="space-y-2">
        {agents?.map((a) => (
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
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
