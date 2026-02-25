'use client';

import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { api } from '@/lib/api';
import clsx from 'clsx';

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, error } = useSWR(id ? `session-${id}` : null, () => api.sessions.get(id));

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load session: {error.message}
        </div>
      </div>
    );
  }

  if (!session) {
    return <div className="p-6 text-slate-400">Loading...</div>;
  }

  const duration = session.completedAt
    ? ((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 1000).toFixed(1)
    : '-';

  const statusColor: Record<string, string> = {
    completed: 'text-green-400',
    failed: 'text-red-400',
    timeout: 'text-yellow-400',
    escalated: 'text-orange-400',
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Session</h1>
        <p className="text-sm text-slate-500 font-mono mt-1">{session.sessionId}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Status</div>
          <div className={clsx('font-medium', statusColor[session.status] ?? 'text-slate-300')}>
            {session.status}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Duration</div>
          <div className="font-medium">{duration}s</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Cost</div>
          <div className="font-medium">${(session.cost / 100).toFixed(4)}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 mb-1">Tokens</div>
          <div className="font-medium">{session.tokenUsage.totalTokens.toLocaleString()}</div>
          <div className="text-xs text-slate-500">
            {session.tokenUsage.inputTokens.toLocaleString()} in / {session.tokenUsage.outputTokens.toLocaleString()} out
          </div>
        </div>
      </div>

      {/* Error */}
      {session.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="text-xs text-red-400 font-medium mb-1">Error</div>
          <pre className="text-sm text-red-300 whitespace-pre-wrap">{session.error}</pre>
        </div>
      )}

      {/* Tool calls */}
      {session.toolCalls.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Tool Calls</h2>
          <div className="space-y-2">
            {session.toolCalls.map((call, i) => {
              const result = session.toolResults[i];
              return (
                <div key={i} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm text-sky-400">{call.toolId}</span>
                    <div className="flex items-center gap-3 text-xs">
                      {result && (
                        <>
                          <span className={result.success ? 'text-green-400' : 'text-red-400'}>
                            {result.success ? 'OK' : 'FAIL'}
                          </span>
                          <span className="text-slate-500">{result.durationMs}ms</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 mb-1">Arguments</div>
                  <pre className="text-xs text-slate-400 bg-slate-800 rounded p-2 overflow-x-auto">
                    {JSON.stringify(call.arguments, null, 2)}
                  </pre>
                  {result && (
                    <>
                      <div className="text-xs text-slate-500 mt-2 mb-1">Result</div>
                      <pre className="text-xs text-slate-400 bg-slate-800 rounded p-2 overflow-x-auto">
                        {result.error ?? JSON.stringify(result.output, null, 2)}
                      </pre>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
