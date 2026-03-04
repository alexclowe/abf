'use client';

import { useState } from 'react';
import type { UIMessage } from 'ai';
import { Copy, Check, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, AlertTriangle } from 'lucide-react';
import { MarkdownContent } from './MarkdownContent';

/** AI SDK v6: static tool parts have type "tool-{name}", dynamic ones have type "dynamic-tool" + toolName prop. */
function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

function getToolName(part: Record<string, unknown>): string {
  if (part['type'] === 'dynamic-tool') return (part['toolName'] as string) ?? 'tool';
  return ((part['type'] as string) ?? '').split('-').slice(1).join('-') || 'tool';
}

function isFilePart(part: { type: string }): boolean {
  return part.type === 'file';
}

function formatTimestamp(date?: Date | string): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1 rounded bg-slate-700/80 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
      title="Copy message"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function FeedbackButtons({ messageId, agentId }: { messageId: string; agentId?: string }) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  function handleFeedback(type: 'up' | 'down') {
    const next = feedback === type ? null : type;
    setFeedback(next);
    if (agentId && next) {
      const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? '';
      const API_KEY = process.env.NEXT_PUBLIC_ABF_API_KEY;
      fetch(`${BASE}/api/agents/${agentId}/chat/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify({ messageId, feedback: next }),
      }).catch(() => {});
    }
  }

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={() => handleFeedback('up')}
        className={`p-0.5 rounded ${feedback === 'up' ? 'text-green-400' : 'text-slate-500 hover:text-slate-300'}`}
        title="Good response"
      >
        <ThumbsUp size={12} />
      </button>
      <button
        type="button"
        onClick={() => handleFeedback('down')}
        className={`p-0.5 rounded ${feedback === 'down' ? 'text-red-400' : 'text-slate-500 hover:text-slate-300'}`}
        title="Bad response"
      >
        <ThumbsDown size={12} />
      </button>
    </div>
  );
}

function ApprovalCard({ approval }: { approval: { toolName?: string; approvalsUrl?: string; message?: string } }) {
  return (
    <div className="my-2 bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-amber-400" />
        <span className="text-amber-400 font-medium text-sm">Approval Required</span>
        {approval.toolName && (
          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded text-xs font-mono">
            {approval.toolName}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-400 mt-1">
        {approval.message ?? 'This tool requires your approval before the agent can proceed.'}
      </p>
      <a
        href={approval.approvalsUrl ?? '/approvals'}
        className="mt-2 inline-flex px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-md text-xs font-medium transition-colors"
      >
        Review &amp; Approve
      </a>
    </div>
  );
}

function ToolCallBadge({ part }: { part: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = getToolName(part);
  const state = part['state'] as string | undefined;
  const output = part['output'];

  // Detect approval card in tool output
  const isApproval = output && typeof output === 'object' && (output as Record<string, unknown>)['__abf_approval'];
  if (isApproval) {
    return <ApprovalCard approval={output as { toolName?: string; approvalsUrl?: string; message?: string }} />;
  }

  const isDone = state === 'output-available';
  const isError = state === 'output-error';
  const hasOutput = isDone && output !== undefined && output !== null;

  return (
    <div className="my-2 bg-slate-800/50 border border-slate-700 rounded-md text-xs">
      <button
        type="button"
        onClick={() => hasOutput && setExpanded(!expanded)}
        className={`flex items-center gap-2 w-full px-3 py-2 text-left ${hasOutput ? 'cursor-pointer hover:bg-slate-800/80' : 'cursor-default'}`}
      >
        {hasOutput ? (
          expanded ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />
        ) : (
          <span className="w-3" />
        )}
        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded font-mono">{toolName}</span>
        {isDone ? (
          <span className="text-green-400">completed</span>
        ) : isError ? (
          <span className="text-red-400">error</span>
        ) : (
          <span className="text-slate-500 animate-pulse">running...</span>
        )}
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-48' : 'max-h-0'}`}
      >
        {hasOutput && (
          <pre className="px-3 pb-2 text-slate-400 overflow-x-auto">
            {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
          </pre>
        )}
      </div>
      {isError && typeof part['errorText'] === 'string' && (
        <pre className="px-3 pb-2 text-red-400 overflow-x-auto max-h-32">
          {part['errorText']}
        </pre>
      )}
    </div>
  );
}

function FileParts({ part }: { part: Record<string, unknown> }) {
  const mediaType = part['mediaType'] as string | undefined;
  const url = part['url'] as string | undefined;

  if (!url) return null;

  if (mediaType?.startsWith('image/')) {
    return (
      <img
        src={url}
        alt="Upload"
        className="max-w-[200px] max-h-[200px] rounded-md object-cover my-1"
      />
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 bg-slate-700/50 rounded px-2 py-1 text-xs text-slate-300 my-1">
      <span>{mediaType ?? 'file'}</span>
    </div>
  );
}

export function ChatMessageBubble({
  message,
  isStreaming,
  agentId,
}: {
  message: UIMessage;
  isStreaming?: boolean;
  agentId?: string;
}) {
  const isUser = message.role === 'user';
  const hasContent = message.parts.some(
    (p) => (p.type === 'text' && p.text) || isToolPart(p),
  );

  // Collect all text parts for copy and markdown rendering
  const fullText = message.parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('');

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="flex flex-col gap-1 max-w-[85%]">
        <div
          className={`group relative rounded-lg px-4 py-3 text-sm overflow-hidden ${
            isUser
              ? 'bg-sky-600 text-white'
              : 'bg-slate-800 border border-slate-700 text-slate-200'
          }`}
        >
          {/* Copy button for assistant messages */}
          {!isUser && fullText && <CopyButton text={fullText} />}

          {message.parts.map((part, i) => {
            if (part.type === 'text') {
              if (isUser) {
                return (
                  <div key={i} className="whitespace-pre-wrap break-words">
                    {part.text}
                  </div>
                );
              }
              // Assistant messages get markdown rendering
              return (
                <MarkdownContent key={i} isStreaming={isStreaming}>
                  {part.text}
                </MarkdownContent>
              );
            }

            if (isToolPart(part)) {
              return <ToolCallBadge key={i} part={part as Record<string, unknown>} />;
            }

            if (isFilePart(part)) {
              return <FileParts key={i} part={part as Record<string, unknown>} />;
            }

            return null;
          })}

          {/* Thinking indicator */}
          {isStreaming && !hasContent && (
            <div className="flex items-center gap-1 text-slate-400">
              <span className="animate-pulse">Thinking</span>
              <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '0.3s' }}>.</span>
            </div>
          )}

          {/* Streaming cursor */}
          {isStreaming && hasContent && (
            <span className="inline-block w-1.5 h-4 bg-sky-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>

        {/* Footer: timestamp + feedback */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-slate-600">
            {formatTimestamp((message as unknown as { createdAt?: Date | string }).createdAt)}
          </span>
          {!isUser && (
            <FeedbackButtons messageId={message.id} agentId={agentId} />
          )}
        </div>
      </div>
    </div>
  );
}
