'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { api } from '@/lib/api';
import { ChatMessageBubble } from '@/components/ChatMessage';
import { ChatInput } from '@/components/ChatInput';
import { ChatSidebar } from '@/components/ChatSidebar';
import {
  Send,
  Square,
  Trash2,
  ArrowLeft,
  RefreshCw,
  Download,
  MessageSquare,
} from 'lucide-react';

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? '';
const API_KEY = process.env.NEXT_PUBLIC_ABF_API_KEY;

// ─── Suggested Prompts ───────────────────────────────────────────────

const ROLE_PROMPTS: Record<string, string[]> = {
  monitor: [
    'What should we be monitoring right now?',
    'Give me a status report',
    'Are there any anomalies to investigate?',
    'What has changed since last check?',
  ],
  writer: [
    'Draft a blog post about...',
    'Review and improve this content',
    'Write a social media post about...',
    'Summarize the key points of...',
  ],
  analyst: [
    'Analyze recent trends in...',
    'Generate a performance report',
    'What insights can you draw from...',
    'Compare these metrics...',
  ],
  researcher: [
    'Research the latest developments in...',
    'Find information about...',
    'What are the key findings on...',
    'Summarize recent research on...',
  ],
  'customer-support': [
    'Help me draft a response to...',
    'What is the best way to handle...',
    'Create a FAQ entry for...',
    'Analyze common support issues',
  ],
  orchestrator: [
    'What is the status of all agents?',
    'Which tasks need attention?',
    'Coordinate a review of...',
    'What are the team priorities?',
  ],
};

const DEFAULT_PROMPTS = [
  'What can you help me with?',
  'What are your capabilities?',
  'Give me a summary of your recent work',
  'What should we focus on today?',
];

function getSuggestedPrompts(role?: string): string[] {
  if (!role) return DEFAULT_PROMPTS;
  const lower = role.toLowerCase();
  for (const [key, prompts] of Object.entries(ROLE_PROMPTS)) {
    if (lower.includes(key)) return prompts;
  }
  return DEFAULT_PROMPTS;
}

// ─── ChatBody ────────────────────────────────────────────────────────

function ChatBody({ agentId, onClear }: { agentId: string; onClear: () => void }) {
  const { data: agent } = useSWR(agentId ? `agent-${agentId}` : null, () => api.agents.get(agentId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { messages, sendMessage, setMessages, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: `${BASE}/api/agents/${agentId}/chat`,
      headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
    }),
  });
  const isLoading = status === 'submitted' || status === 'streaming';

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    (text: string, files?: Array<{ type: 'file'; mediaType: string; url: string }>) => {
      if (!text.trim() && (!files || files.length === 0)) return;
      if (isLoading) return;

      const parts: Array<{ type: 'text'; text: string } | { type: 'file'; mediaType: string; url: string }> = [];
      if (files && files.length > 0) {
        parts.push(...files);
      }
      parts.push({ type: 'text', text: text.trim() });

      sendMessage({ parts });
    },
    [isLoading, sendMessage],
  );

  function handleRegenerate() {
    // Find the last user message
    const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === 'user');
    if (lastUserIdx === -1) return;
    const userIdx = messages.length - 1 - lastUserIdx;
    const lastUserMsg = messages[userIdx];
    if (!lastUserMsg) return;

    // Get the text from the last user message
    const userText = lastUserMsg.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('');

    // Remove everything after (and including) the last assistant message
    setMessages(messages.slice(0, userIdx));

    // Re-send
    setTimeout(() => {
      sendMessage({ text: userText });
    }, 50);
  }

  function handleExport() {
    const agentName = agent?.config.displayName ?? agentId;
    const lines = messages.map((msg) => {
      const text = msg.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { type: 'text'; text: string }).text)
        .join('');
      const role = msg.role === 'user' ? 'You' : agentName;
      return `**${role}**: ${text}`;
    });
    const content = lines.join('\n\n---\n\n');
    const date = new Date().toISOString().slice(0, 10);
    const filename = `chat-${agentId}-${date}.md`;

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Check if last message is an assistant message (for regenerate button)
  const lastMsg = messages[messages.length - 1];
  const showRegenerate = !isLoading && lastMsg?.role === 'assistant';

  const suggestedPrompts = getSuggestedPrompts(agent?.config.role);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      {sidebarOpen && (
        <ChatSidebar
          agentId={agentId}
          onSelectConversation={() => {
            // For v1: start new conversation (full reload with message history is v2)
            onClear();
          }}
          onNewConversation={onClear}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-slate-400 hover:text-white transition-colors"
              title="Toggle conversations"
            >
              <MessageSquare size={18} />
            </button>
            <Link
              href={`/agents/${agentId}`}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-sm font-medium">
                Chat with {agent?.config.displayName ?? agentId}
              </h1>
              <p className="text-xs text-slate-500">
                {agent?.config.role ?? 'Agent'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors"
                title="Export conversation"
              >
                <Download size={14} />
                Export
              </button>
            )}
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors"
              title="Clear conversation"
            >
              <Trash2 size={14} />
              Clear
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-4 max-w-lg">
                <p className="text-slate-500 text-sm">
                  Send a message to start chatting with {agent?.config.displayName ?? 'this agent'}.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="bg-slate-800/50 border border-slate-700 hover:border-sky-500 rounded-lg p-3 text-left text-sm text-slate-300 hover:text-white transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              isStreaming={isLoading && msg === messages[messages.length - 1] && msg.role === 'assistant'}
              agentId={agentId}
            />
          ))}

          {/* Regenerate button */}
          {showRegenerate && (
            <div className="flex justify-start pl-4">
              <button
                onClick={handleRegenerate}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-300 text-xs transition-colors"
              >
                <RefreshCw size={12} />
                Regenerate
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 text-red-400 text-xs">
            {error.message}
          </div>
        )}

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          onStop={stop}
          agentId={agentId}
        />
      </div>
    </div>
  );
}

export default function AgentChatPage() {
  const { id } = useParams<{ id: string }>();
  const [chatKey, setChatKey] = useState(0);

  return (
    <ChatBody
      key={chatKey}
      agentId={id}
      onClear={() => setChatKey((k) => k + 1)}
    />
  );
}
