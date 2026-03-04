'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { AgentAvatar } from './AgentAvatar';
import { Check, X, Bell, XCircle, Zap, ShieldCheck } from 'lucide-react';

interface AgentErrorInfo {
  id: string;
  name: string;
  displayName: string;
  errorCount: number;
  lastError?: string;
}

interface ActionFeedProps {
  agentErrors?: AgentErrorInfo[];
}

export function ActionFeed({ agentErrors }: ActionFeedProps) {
  const { data: approvals, mutate: mutateApprovals } = useSWR(
    'approvals-pending',
    () => api.approvals.list('pending'),
    { refreshInterval: 5000 },
  );
  const { data: escalations, mutate: mutateEscalations } = useSWR(
    'escalations',
    () => api.escalations.list(),
    { refreshInterval: 5000 },
  );

  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const pendingApprovals = approvals ?? [];
  const openEscalations = (escalations ?? []).filter((e) => !e.resolved);
  const errors = agentErrors ?? [];
  const totalItems = pendingApprovals.length + openEscalations.length + errors.length;

  if (totalItems === 0) return null;

  function withLoading(id: string, fn: () => Promise<void>) {
    return async () => {
      setLoading((prev) => ({ ...prev, [id]: true }));
      try {
        await fn();
      } finally {
        setLoading((prev) => ({ ...prev, [id]: false }));
      }
    };
  }

  async function handleApprove(id: string, permanent?: boolean) {
    await api.approvals.approve(id, permanent);
    void mutateApprovals();
  }

  async function handleReject(id: string) {
    await api.approvals.reject(id);
    void mutateApprovals();
  }

  async function handleResolve(id: string) {
    await api.escalations.resolve(id);
    void mutateEscalations();
  }

  function summarizeArgs(args: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, val] of Object.entries(args)) {
      if (typeof val === 'string' && val.length > 0) {
        parts.push(`${key}: ${val.length > 40 ? `${val.slice(0, 40)}...` : val}`);
      }
    }
    return parts.slice(0, 2).join(', ') || '...';
  }

  return (
    <div className="border border-amber-600/30 bg-amber-950/10 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-amber-600/20 flex items-center gap-2">
        <Zap size={14} className="text-amber-400" />
        <span className="text-sm font-medium text-amber-300">Needs Attention</span>
        <span className="text-xs bg-amber-600/20 text-amber-400 px-1.5 py-0.5 rounded-full">{totalItems}</span>
      </div>

      <div className="divide-y divide-slate-800/50">
        {/* Agent errors */}
        {errors.map((agent) => (
          <Link
            key={`err-${agent.id}`}
            href={`/agents/${agent.id}?tab=sessions`}
            className="px-4 py-3 flex items-start gap-3 hover:bg-slate-800/30 transition-colors"
          >
            <AgentAvatar name={agent.name} size={28} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <XCircle size={12} className="text-red-400 flex-shrink-0" />
                <span className="font-medium text-slate-200 truncate">{agent.displayName}</span>
                <span className="text-red-400 text-xs">
                  {agent.errorCount} error{agent.errorCount !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {agent.lastError || 'Session failed — view sessions for details'}
              </p>
            </div>
            <span className="flex-shrink-0 px-2.5 py-1 rounded-md bg-slate-700 text-slate-300 text-xs font-medium">
              Sessions
            </span>
          </Link>
        ))}

        {/* Tool approvals */}
        {pendingApprovals.map((item) => {
          const isUnlisted = item.escalationReason === 'unlisted_action';
          return (
            <div key={item.id} className="px-4 py-3 flex items-start gap-3">
              <AgentAvatar name={item.agentId} size={28} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-slate-200 truncate">{item.agentId}</span>
                  <span className="text-slate-500">wants to</span>
                  <code className="text-xs bg-slate-800 px-1.5 py-0.5 rounded text-sky-300">{item.toolName}</code>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{summarizeArgs(item.arguments)}</p>
                {isUnlisted && (
                  <p className="text-xs text-amber-500/80 mt-0.5">Tool not in allowed list</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {isUnlisted ? (
                  <>
                    <button
                      type="button"
                      onClick={withLoading(item.id, () => handleApprove(item.id))}
                      disabled={loading[item.id]}
                      className="px-2 py-1 rounded-md bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-50 text-xs font-medium"
                      title="Allow this tool use once"
                    >
                      Once
                    </button>
                    <button
                      type="button"
                      onClick={withLoading(`${item.id}-perm`, () => handleApprove(item.id, true))}
                      disabled={loading[item.id] || loading[`${item.id}-perm`]}
                      className="px-2 py-1 rounded-md bg-sky-600/20 text-sky-400 hover:bg-sky-600/30 transition-colors disabled:opacity-50 text-xs font-medium flex items-center gap-1"
                      title="Allow permanently — adds tool to agent's allowed actions"
                    >
                      <ShieldCheck size={12} />
                      Always
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={withLoading(item.id, () => handleApprove(item.id))}
                    disabled={loading[item.id]}
                    className="p-1.5 rounded-md bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-50"
                    title="Approve"
                  >
                    <Check size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={withLoading(item.id, () => handleReject(item.id))}
                  disabled={loading[item.id]}
                  className="p-1.5 rounded-md bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors disabled:opacity-50"
                  title="Reject"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Alerts */}
        {openEscalations.map((esc) => (
          <div key={esc.id} className="px-4 py-3 flex items-start gap-3">
            <AgentAvatar name={esc.agentId} size={28} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <Bell size={12} className="text-amber-400 flex-shrink-0" />
                <span className="font-medium text-slate-200 truncate">{esc.agentId}</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{esc.message}</p>
            </div>
            <button
              type="button"
              onClick={withLoading(esc.id, () => handleResolve(esc.id))}
              disabled={loading[esc.id]}
              className="flex-shrink-0 px-2.5 py-1 rounded-md bg-slate-700 text-slate-300 hover:bg-slate-600 text-xs font-medium transition-colors disabled:opacity-50"
            >
              Resolve
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
