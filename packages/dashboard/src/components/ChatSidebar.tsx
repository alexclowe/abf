'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

interface ConversationMeta {
  id: string;
  agentId: string;
  title: string;
  lastAccessed: number;
  messageCount: number;
}

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? '';
const API_KEY = process.env.NEXT_PUBLIC_ABF_API_KEY;

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (API_KEY) h['Authorization'] = `Bearer ${API_KEY}`;
  return h;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

interface ChatSidebarProps {
  agentId: string;
  onSelectConversation: (convId: string) => void;
  onNewConversation: () => void;
  onClose: () => void;
}

export function ChatSidebar({
  agentId,
  onSelectConversation,
  onNewConversation,
  onClose,
}: ChatSidebarProps) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}/api/agents/${agentId}/conversations`, { headers: apiHeaders() })
      .then((r) => r.json())
      .then((data: ConversationMeta[]) => {
        setConversations(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agentId]);

  function deleteConversation(convId: string) {
    fetch(`${BASE}/api/agents/${agentId}/conversations/${convId}`, {
      method: 'DELETE',
      headers: apiHeaders(),
    })
      .then(() => {
        setConversations((prev) => prev.filter((c) => c.id !== convId));
      })
      .catch(() => {});
  }

  return (
    <div className="w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Conversations
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewConversation}
            className="p-1 text-slate-400 hover:text-white transition-colors"
            title="New conversation"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white transition-colors"
            title="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="px-3 py-4 text-center text-xs text-slate-500">Loading...</div>
        )}
        {!loading && conversations.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-slate-500">
            No conversations yet
          </div>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className="group flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50 cursor-pointer transition-colors"
            onClick={() => onSelectConversation(conv.id)}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-300 truncate">
                {conv.title || 'Untitled'}
              </p>
              <p className="text-[10px] text-slate-600">
                {formatRelativeTime(conv.lastAccessed)}
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteConversation(conv.id);
              }}
              className="p-1 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
              title="Delete conversation"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
