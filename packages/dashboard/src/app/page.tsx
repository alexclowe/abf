'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useEventStream } from '@/lib/use-event-stream';
import { AgentStatusBadge } from '@/components/AgentStatusBadge';
import { Bot, Play, DollarSign } from 'lucide-react';

export default function OverviewPage() {
  const { data: stream } = useEventStream();

  // Check if SSE snapshot has the data shapes this page needs
  const sseHasAgents = !!stream?.agents?.[0]?.config;
  const sseHasStatus = stream?.status?.activeSessions !== undefined;
  const sseHasSessions = !!stream?.sessions;

  // SWR polls only when SSE doesn't provide usable data for that field
  const { data: swrStatus } = useSWR(!sseHasStatus ? 'status' : null, () => api.status(), { refreshInterval: 3000 });
  const { data: swrAgents } = useSWR(!sseHasAgents ? 'agents' : null, () => api.agents.list(), { refreshInterval: 3000 });
  const { data: swrSessions } = useSWR(!sseHasSessions ? 'sessions' : null, () => api.sessions.active(), { refreshInterval: 3000 });

  const status = sseHasStatus ? stream!.status : swrStatus;
  const agents = (sseHasAgents ? stream!.agents : swrAgents) as { config: Record<string, any>; state?: Record<string, any> | null }[] | undefined;
  const sessions = sseHasSessions ? stream!.sessions : swrSessions;

  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});
  const [activeInput, setActiveInput] = useState<string | null>(null);

  function handleRunClick(agentId: string) {
    if (activeInput === agentId) {
      // Submit the task
      const task = taskInputs[agentId];
      if (task?.trim()) {
        void api.agents.run(agentId, task.trim());
        setActiveInput(null);
        setTaskInputs((prev) => ({ ...prev, [agentId]: '' }));
      }
    } else {
      setActiveInput(agentId);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your Team</h1>
      </div>

      {/* Agent cards */}
      {agents && agents.length > 0 ? (
        <div className="space-y-0 border border-slate-800 rounded-lg overflow-hidden">
          {agents.map((a, i) => (
            <div
              key={a.config.id}
              className={`bg-slate-900 p-4 ${i < agents.length - 1 ? 'border-b border-slate-800' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{a.config.displayName}</span>
                    <span className="text-slate-500">&middot;</span>
                    <span className="text-sm text-slate-400">{a.config.role}</span>
                    <AgentStatusBadge status={a.state?.status ?? 'idle'} />
                  </div>
                  <p className="text-sm text-slate-500">{a.config.description}</p>
                </div>
                <button
                  onClick={() => handleRunClick(a.config.id)}
                  className="ml-4 flex-shrink-0 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-1.5"
                >
                  <Play size={12} />
                  Run
                </button>
              </div>
              {activeInput === a.config.id && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    placeholder="What should this agent do?"
                    value={taskInputs[a.config.id] ?? ''}
                    onChange={(e) =>
                      setTaskInputs((prev) => ({ ...prev, [a.config.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRunClick(a.config.id);
                      if (e.key === 'Escape') setActiveInput(null);
                    }}
                    autoFocus
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
                  />
                  <button
                    onClick={() => setActiveInput(null)}
                    className="px-2 py-1.5 text-slate-400 hover:text-white text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <Bot size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400">No agents loaded.</p>
          <p className="text-slate-500 text-sm mt-1">
            Run <code className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-400">abf dev</code> in your project directory.
          </p>
        </div>
      )}

      {/* Footer stats */}
      <div className="flex items-center gap-6 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Bot size={12} />
          Agents: {status?.agents ?? 0}
        </span>
        <span>Active: {sessions?.length ?? status?.activeSessions ?? 0}</span>
        <span className="flex items-center gap-1">
          <DollarSign size={12} />
          Cost today: $0.00
        </span>
      </div>
    </div>
  );
}
