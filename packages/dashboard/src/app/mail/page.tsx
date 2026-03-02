'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import type { MailMessage, AgentListItem } from '@/lib/types';

export default function MailPage() {
  const [agentFilter, setAgentFilter] = useState('');
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);

  const { data: agents } = useSWR('agents-for-mail', () => api.agents.list());
  const { data: messages, error, mutate } = useSWR(
    `mail-${agentFilter}`,
    () => api.mail.list(agentFilter || undefined, 100),
    { refreshInterval: 10_000 },
  );
  const { data: threadMessages } = useSWR(
    selectedThread ? `mail-thread-${selectedThread}` : null,
    () => selectedThread ? api.mail.thread(selectedThread) : null,
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mail</h1>
        <div className="flex items-center gap-3">
          <select
            value={agentFilter}
            onChange={(e) => { setAgentFilter(e.target.value); setSelectedThread(null); }}
            className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-300"
          >
            <option value="">All Agents</option>
            {agents?.map((a: AgentListItem) => (
              <option key={a.config.id} value={a.config.name}>{a.config.displayName || a.config.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowCompose(true)}
            className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            Compose
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load mail: {error.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Message List */}
        <div className="space-y-2">
          {!messages && !error && (
            <div className="text-slate-400 text-sm">Loading...</div>
          )}

          {messages && messages.length === 0 && (
            <div className="text-slate-500 text-sm py-8 text-center">
              No messages yet. Agents will send mail to each other using the agent-email tool.
            </div>
          )}

          {messages?.map((msg: MailMessage) => (
            <button
              type="button"
              key={msg.id}
              onClick={() => setSelectedThread(msg.threadId)}
              className={`w-full text-left bg-slate-900 border rounded-lg p-3 transition-colors ${
                selectedThread === msg.threadId
                  ? 'border-sky-500/50 bg-sky-500/5'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {!msg.read && (
                    <span className="w-2 h-2 rounded-full bg-sky-400 flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium text-slate-200 truncate">
                    {msg.from}
                  </span>
                  <span className="text-slate-600">→</span>
                  <span className="text-sm text-slate-400 truncate">{msg.to}</span>
                </div>
                <span className="text-xs text-slate-500 flex-shrink-0">
                  {formatTimestamp(msg.timestamp)}
                </span>
              </div>
              <div className="text-sm font-medium text-slate-300 truncate">{msg.subject}</div>
              <div className="text-xs text-slate-500 truncate mt-0.5">
                {msg.body.slice(0, 100)}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  msg.source === 'agent'
                    ? 'bg-purple-500/10 text-purple-400'
                    : msg.source === 'human'
                      ? 'bg-sky-500/10 text-sky-400'
                      : 'bg-green-500/10 text-green-400'
                }`}>
                  {msg.source}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Thread View */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg">
          {!selectedThread ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Select a message to view the thread
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              <div className="p-4 flex items-center justify-between">
                <h2 className="text-sm font-medium text-slate-300">Thread</h2>
                <button
                  type="button"
                  onClick={() => setSelectedThread(null)}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Close
                </button>
              </div>
              {threadMessages?.map((msg: MailMessage) => (
                <div key={msg.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{msg.from}</span>
                      <span className="text-slate-600">→</span>
                      <span className="text-sm text-slate-400">{msg.to}</span>
                    </div>
                    <span className="text-xs text-slate-500">{formatTimestamp(msg.timestamp)}</span>
                  </div>
                  <div className="text-sm font-medium text-slate-300">{msg.subject}</div>
                  <div className="text-sm text-slate-400 whitespace-pre-wrap">{msg.body}</div>
                </div>
              ))}
              {threadMessages && threadMessages.length === 0 && (
                <div className="p-4 text-slate-500 text-sm">No messages in this thread.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <ComposeModal
          agents={agents ?? []}
          onClose={() => setShowCompose(false)}
          onSent={() => { setShowCompose(false); mutate(); }}
        />
      )}
    </div>
  );
}

function ComposeModal({
  agents,
  onClose,
  onSent,
}: {
  agents: AgentListItem[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function handleSend() {
    if (!to || !subject.trim() || !body.trim()) {
      setError('All fields are required');
      return;
    }
    setSending(true);
    setError('');
    try {
      await api.mail.send(to, { subject: subject.trim(), body: body.trim() });
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Compose Message</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-sm">
            Cancel
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="mail-to" className="block text-xs text-slate-400 mb-1">To</label>
            <select
              id="mail-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-300"
            >
              <option value="">Select agent...</option>
              {agents.map((a) => (
                <option key={a.config.id} value={a.config.name}>
                  {a.config.displayName || a.config.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mail-subject" className="block text-xs text-slate-400 mb-1">Subject</label>
            <input
              id="mail-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Message subject..."
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600"
            />
          </div>

          <div>
            <label htmlFor="mail-body" className="block text-xs text-slate-400 mb-1">Body</label>
            <textarea
              id="mail-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Write your message (supports markdown)..."
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 resize-none"
            />
          </div>
        </div>

        {error && (
          <div className="text-red-400 text-sm">{error}</div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="px-6 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString();
}
