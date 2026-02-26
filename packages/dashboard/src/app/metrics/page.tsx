'use client';

import useSWR from 'swr';
import { api } from '@/lib/api';
import { useEventStream } from '@/lib/use-event-stream';

export default function MetricsPage() {
  const { data: stream } = useEventStream();

  // SSE provides runtime + agent states in real time; fall back to SWR if SSE not connected
  const { data: swrRuntime } = useSWR(!stream ? 'metrics-runtime' : null, () => api.metrics.runtime(), {
    refreshInterval: 5000,
  });
  const { data: swrAgents } = useSWR(!stream ? 'metrics-agents' : null, () => api.metrics.agents(), {
    refreshInterval: 5000,
  });

  const runtime = stream?.runtime ?? swrRuntime;
  const agents = stream?.agents ?? swrAgents;

  const activeSessions = Number(runtime?.activeSessions ?? 0);
  const agentCount = Number(runtime?.agentCount ?? 0);
  const totalEscalations = Number(runtime?.totalEscalations ?? 0);
  const resolvedEscalations = Number(runtime?.resolvedEscalations ?? 0);
  const sessionHistory = Array.isArray(runtime?.sessionHistory)
    ? (runtime.sessionHistory as { agentId: string; sessionId: string; startedAt: string }[])
    : [];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Metrics</h1>

      {/* Gauges */}
      <div className="grid grid-cols-4 gap-4">
        <GaugeCard label="Active Sessions" value={activeSessions} />
        <GaugeCard label="Agents" value={agentCount} />
        <GaugeCard label="Escalations" value={totalEscalations} color="amber" />
        <GaugeCard
          label="Resolved"
          value={resolvedEscalations}
          color="green"
        />
      </div>

      {/* Agent states table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-medium text-slate-400">Agent States</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500">
              <th className="text-left px-4 py-2 font-medium">Agent</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-right px-4 py-2 font-medium">Sessions</th>
              <th className="text-right px-4 py-2 font-medium">Errors</th>
              <th className="text-right px-4 py-2 font-medium">Total Cost</th>
            </tr>
          </thead>
          <tbody>
            {(agents ?? []).map((a: Record<string, unknown>, i: number) => {
              const costCents = Number(a.totalCost ?? 0);
              return (
                <tr key={String(a.id ?? i)} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-4 py-2 font-medium">{String(a.id)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        a.status === 'active'
                          ? 'bg-green-500/20 text-green-400'
                          : a.status === 'error'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-slate-700 text-slate-400'
                      }`}
                    >
                      {String(a.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">{String(a.sessionsCompleted ?? 0)}</td>
                  <td className="px-4 py-2 text-right text-red-400">{String(a.errorCount ?? 0)}</td>
                  <td className="px-4 py-2 text-right">
                    ${(costCents / 100).toFixed(2)}
                  </td>
                </tr>
              );
            })}
            {(!agents || agents.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No agent data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Active Sessions */}
      {sessionHistory.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-medium text-slate-400 mb-2">Active Sessions</h2>
          <div className="space-y-1">
            {sessionHistory.map((s, i) => (
              <div key={i} className="text-sm flex justify-between">
                <span>{s.agentId}</span>
                <span className="text-slate-500">{s.sessionId}</span>
                <span className="text-slate-500">
                  {new Date(s.startedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GaugeCard({
  label,
  value,
  color = 'sky',
}: {
  label: string;
  value: number;
  color?: 'sky' | 'green' | 'amber' | 'red';
}) {
  const colorMap = {
    sky: 'text-sky-400',
    green: 'text-green-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${colorMap[color]}`}>{value}</div>
    </div>
  );
}
