'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import type { ApprovalItem } from '@/lib/types';

export default function ApprovalsPage() {
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: approvals, error, mutate } = useSWR(
    `approvals-${filter}`,
    () => api.approvals.list(filter || undefined),
    { refreshInterval: 3000 },
  );

  async function handleApprove(id: string) {
    try {
      setActionError(null);
      await api.approvals.approve(id);
      mutate();
    } catch (e) {
      setActionError(`Failed to approve: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleReject(id: string) {
    try {
      setActionError(null);
      await api.approvals.reject(id);
      mutate();
    } catch (e) {
      setActionError(`Failed to reject: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Approvals</h1>
        <div className="flex gap-1">
          {(['pending', 'approved', 'rejected', ''] as const).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === s
                  ? 'bg-sky-500/10 text-sky-400'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load approvals: {error.message}
        </div>
      )}

      {actionError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      {!approvals && !error && (
        <div className="text-slate-400 text-sm">Loading...</div>
      )}

      {approvals && approvals.length === 0 && (
        <div className="text-slate-500 text-sm">No approvals found.</div>
      )}

      <div className="space-y-3">
        {approvals?.map((item: ApprovalItem) => (
          <div
            key={item.id}
            className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">{item.toolName}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  item.status === 'pending'
                    ? 'bg-amber-500/10 text-amber-400'
                    : item.status === 'approved'
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                }`}>
                  {item.status}
                </span>
                <span className="text-xs text-slate-500">
                  from {item.agentId}
                </span>
              </div>
              <span className="text-xs text-slate-500">
                {new Date(item.createdAt).toLocaleString()}
              </span>
            </div>

            <div className="bg-slate-800 rounded-md p-3">
              {item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments) ? (
                <dl className="space-y-1 text-xs">
                  {Object.entries(item.arguments).map(([key, val]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="text-slate-500 font-medium min-w-[100px]">{key}</dt>
                      <dd className="text-slate-300 font-mono break-all">
                        {typeof val === 'string' ? val : JSON.stringify(val)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono">
                  {JSON.stringify(item.arguments, null, 2)}
                </pre>
              )}
            </div>

            {item.status === 'pending' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleApprove(item.id)}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-medium transition-colors"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => handleReject(item.id)}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-md text-xs font-medium transition-colors"
                >
                  Reject
                </button>
              </div>
            )}

            {item.resolvedAt && (
              <div className="text-xs text-slate-500">
                Resolved by {item.resolvedBy} at {new Date(item.resolvedAt).toLocaleString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
