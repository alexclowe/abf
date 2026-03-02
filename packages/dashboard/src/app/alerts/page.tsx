'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useEventStream } from '@/lib/use-event-stream';
import { Bell } from 'lucide-react';

export default function AlertsPage() {
  const { data: stream } = useEventStream();
  const { data: swrEscalations, error, mutate } = useSWR(
    !stream ? 'escalations' : null,
    () => api.escalations.list(),
    { refreshInterval: 3000 },
  );
  const escalations = stream?.escalations ?? swrEscalations;
  const [actionError, setActionError] = useState<string | null>(null);

  async function resolve(id: string) {
    try {
      setActionError(null);
      await api.escalations.resolve(id);
      mutate();
    } catch (e) {
      setActionError(`Failed to resolve: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const open = escalations?.filter((e) => !e.resolved) ?? [];
  const resolved = escalations?.filter((e) => e.resolved) ?? [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Alerts</h1>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load alerts: {error.message}
        </div>
      )}

      {actionError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      {open.length === 0 && resolved.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <p className="text-slate-400">No alerts.</p>
        </div>
      )}

      {open.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 text-yellow-400">Open ({open.length})</h2>
          <div className="space-y-2">
            {open.map((esc) => (
              <div
                key={esc.id}
                className="bg-slate-900 border border-yellow-500/20 rounded-lg p-4 flex items-start justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Bell size={14} className="text-yellow-400" />
                    <span className="font-medium text-sm">{esc.type}</span>
                    <span className="text-xs text-slate-500">from {esc.agentId}</span>
                  </div>
                  <p className="text-sm text-slate-300">{esc.message}</p>
                  <div className="text-xs text-slate-500 mt-1">
                    Target: {esc.target} | {new Date(esc.timestamp).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => resolve(esc.id)}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-medium transition-colors shrink-0"
                >
                  Resolve
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 text-slate-500">Resolved ({resolved.length})</h2>
          <div className="space-y-2">
            {resolved.map((esc) => (
              <div
                key={esc.id}
                className="bg-slate-900 border border-slate-800 rounded-lg p-4 opacity-60"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{esc.type}</span>
                  <span className="text-xs text-slate-500">from {esc.agentId}</span>
                </div>
                <p className="text-sm text-slate-400">{esc.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
