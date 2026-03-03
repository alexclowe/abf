'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { AgentStatusBadge } from '@/components/AgentStatusBadge';
import { AgentAvatar } from '@/components/AgentAvatar';
import { MarkdownContent } from '@/components/MarkdownContent';
import { MessageSquare, CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { describeCron, snakeToTitle, providerLabel, modelLabel, formatDuration, timeAgo } from '@/lib/format';

type Tab = 'overview' | 'memory' | 'sessions';

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, error } = useSWR(id ? `agent-${id}` : null, () => api.agents.get(id), {
    refreshInterval: 10_000,
  });
  const [tab, setTab] = useState<Tab>('overview');
  const [showRun, setShowRun] = useState(false);
  const [task, setTask] = useState('');
  const [runResult, setRunResult] = useState<string | null>(null);
  const [inboxSubject, setInboxSubject] = useState('');
  const [inboxBody, setInboxBody] = useState('');
  const [inboxStatus, setInboxStatus] = useState<string | null>(null);

  async function handleRun() {
    if (!task.trim()) return;
    try {
      await api.agents.run(id, task);
      setRunResult(`${config?.displayName ?? 'Agent'} is working on your task...`);
      setTask('');
      setShowRun(false);
      setTab('sessions');
    } catch (e) {
      setRunResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load agent: {error.message}
        </div>
      </div>
    );
  }

  if (!agent) {
    return <div className="p-6 text-slate-400">Loading...</div>;
  }

  const { config, state, memory } = agent;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <AgentAvatar name={config.name} size={48} />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{config.displayName}</h1>
              <AgentStatusBadge status={state?.status ?? 'idle'} />
            </div>
            <p className="text-slate-400 mt-1">{config.role} — {config.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/agents/${id}/chat`}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-sm font-medium transition-colors border border-slate-700 flex items-center gap-1.5"
          >
            <MessageSquare size={14} />
            Chat
          </Link>
          <Link
            href={`/agents/${id}/edit`}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-sm font-medium transition-colors border border-slate-700"
          >
            Edit
          </Link>
          <button
            type="button"
            onClick={() => setShowRun(!showRun)}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            Run Agent
          </button>
        </div>
      </div>

      {/* Run form */}
      {showRun && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex gap-2">
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Enter task description..."
            className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            onKeyDown={(e) => e.key === 'Enter' && handleRun()}
          />
          <button
            type="button"
            onClick={handleRun}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            Run
          </button>
        </div>
      )}

      {runResult && (
        <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-3 text-sky-400 text-sm flex items-center justify-between">
          <span>{runResult}</span>
          {!runResult.startsWith('Error') && (
            <Link
              href={`/agents/${id}/chat`}
              className="text-sky-400 hover:text-sky-300 underline underline-offset-2 text-xs font-medium"
            >
              Watch live
            </Link>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800" role="tablist" aria-label="Agent details">
        {(['overview', 'memory', 'sessions'] as Tab[]).map((t) => (
          <button
            type="button"
            key={t}
            role="tab"
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-sky-400 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div role="tabpanel" id="panel-overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-400 mb-2">Configuration</h3>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Provider</dt>
                  <dd>{providerLabel(config.provider)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Model</dt>
                  <dd>{modelLabel(config.model)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Team</dt>
                  <dd>{config.team ?? '-'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Reports to</dt>
                  <dd>{config.reportsTo ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Tools</dt>
                  <dd className="text-slate-300 mt-0.5">{config.tools.length > 0 ? config.tools.map(t => snakeToTitle(t)).join(', ') : '-'}</dd>
                </div>
              </dl>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-400 mb-2">Permissions</h3>
              <dl className="space-y-1 text-sm">
                <div>
                  <dt className="text-slate-500">Allowed</dt>
                  <dd className="text-green-400">{config.behavioralBounds.allowedActions.map(a => snakeToTitle(a)).join(', ') || '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Forbidden</dt>
                  <dd className="text-red-400">{config.behavioralBounds.forbiddenActions.map(a => snakeToTitle(a)).join(', ') || '-'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Max cost/session</dt>
                  <dd>${config.behavioralBounds.maxCostPerSession}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* KPIs */}
          {config.kpis.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-400 mb-2">KPIs</h3>
              <div className="space-y-1">
                {config.kpis.map((kpi, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{kpi.metric}</span>
                    <span className="text-slate-400">Target: {kpi.target} (review: {kpi.review})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Triggers */}
          {config.triggers.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-400 mb-2">Triggers</h3>
              <div className="space-y-1">
                {config.triggers.map((t, i) => (
                  <div key={i} className="text-sm flex gap-2">
                    <span className="px-2 py-0.5 bg-slate-800 rounded text-xs font-mono">{t.type}</span>
                    {t.schedule && <span className="text-slate-400">{describeCron(t.schedule)}</span>}
                    {t.task && <span className="text-slate-400">-&gt; {t.task}</span>}
                    {t.from && <span className="text-slate-400">from {t.from}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Send Task (Inbox) */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Send Task to Inbox</h3>
            <div className="space-y-2">
              <input
                value={inboxSubject}
                onChange={(e) => setInboxSubject(e.target.value)}
                placeholder="Subject"
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              />
              <textarea
                value={inboxBody}
                onChange={(e) => setInboxBody(e.target.value)}
                placeholder="Task body..."
                rows={3}
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-none"
              />
              <div className="flex justify-between items-center">
                {inboxStatus && (
                  <span className="text-xs text-sky-400">{inboxStatus}</span>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    if (!inboxSubject.trim() || !inboxBody.trim()) return;
                    try {
                      await api.inbox.push(id, { subject: inboxSubject, body: inboxBody });
                      setInboxStatus('Task queued');
                      setInboxSubject('');
                      setInboxBody('');
                      setTimeout(() => setInboxStatus(null), 3000);
                    } catch (e) {
                      setInboxStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  }}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors ml-auto"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'memory' && (
        <div role="tabpanel" id="panel-memory" className="space-y-4">
          {memory?.charter && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-400 mb-2">Charter</h3>
              <MarkdownContent>{memory.charter}</MarkdownContent>
            </div>
          )}
          {memory?.history && memory.history.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-400 mb-2">Recent History</h3>
              <div className="space-y-2">
                {memory.history.slice(-10).map((entry, i) => (
                  <div key={i} className="text-sm border-l-2 border-slate-700 pl-3">
                    <div className="text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()}</div>
                    <div className="text-slate-300">{entry.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(!memory || (!memory.charter && memory.history.length === 0)) && (
            <div className="text-slate-500 text-sm">No memory data available.</div>
          )}
        </div>
      )}

      {tab === 'sessions' && (
        <SessionsPanel agentId={id} />
      )}
    </div>
  );
}

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2,
  failed: XCircle,
  escalated: AlertTriangle,
  timeout: Clock,
};
const STATUS_COLOR: Record<string, string> = {
  completed: 'text-green-400',
  failed: 'text-red-400',
  escalated: 'text-amber-400',
  timeout: 'text-orange-400',
};

function SessionsPanel({ agentId }: { agentId: string }) {
  const { data: sessions, error } = useSWR(
    agentId ? `agent-sessions-${agentId}` : null,
    () => api.agents.sessions(agentId),
    { refreshInterval: 10_000 },
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  if (error) {
    return (
      <div role="tabpanel" id="panel-sessions" className="text-sm text-red-400">
        Failed to load sessions.
      </div>
    );
  }

  if (!sessions) {
    return <div role="tabpanel" id="panel-sessions" className="text-sm text-slate-500">Loading sessions...</div>;
  }

  if (sessions.length === 0) {
    return (
      <div role="tabpanel" id="panel-sessions" className="text-sm text-slate-500">
        No sessions yet. Run the agent or send a task to get started.
      </div>
    );
  }

  return (
    <div role="tabpanel" id="panel-sessions" className="space-y-2">
      {sessions.map((s) => {
        const StatusIcon = STATUS_ICON[s.status] ?? CheckCircle2;
        const statusColor = STATUS_COLOR[s.status] ?? 'text-slate-400';
        const duration = new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime();
        const isExpanded = expanded === s.sessionId;

        return (
          <div key={s.sessionId} className="bg-slate-900 border border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setExpanded(isExpanded ? null : s.sessionId)}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-800/50 transition-colors rounded-lg"
            >
              <StatusIcon size={16} className={statusColor} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium capitalize">{s.status}</span>
                  <span className="text-slate-500">{timeAgo(s.completedAt)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                  <span>{formatDuration(duration)}</span>
                  {typeof s.cost === 'number' && s.cost > 0 && <span>${(s.cost / 100).toFixed(2)}</span>}
                  <span>{s.toolCalls.length} tool call{s.toolCalls.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </button>
            {isExpanded && s.outputText && (
              <div className="px-3 pb-3 border-t border-slate-800">
                <pre className="text-xs text-slate-400 mt-2 whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {s.outputText}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
