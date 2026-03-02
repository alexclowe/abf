'use client';

import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { AgentAvatar } from './AgentAvatar';
import { AgentStatusBadge } from './AgentStatusBadge';
import type { OrgNode } from '@/lib/org-tree';
import type { AgentStatus } from '@/lib/types';

interface OrgChartNodeProps {
  node: OrgNode;
}

export function OrgChartNode({ node }: OrgChartNodeProps) {
  if (node.isCeo) {
    return (
      <div className="inline-flex flex-col items-center gap-1.5 px-5 py-3 bg-slate-900 border border-sky-600/40 rounded-lg">
        <AgentAvatar name="ceo" size={36} isCeo />
        <span className="font-semibold text-sky-300 text-sm">You</span>
        <span className="text-xs text-slate-500">CEO</span>
      </div>
    );
  }

  return (
    <Link
      href={`/agents/${node.id}`}
      className="group flex items-center gap-3 px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg hover:border-slate-500 transition-colors relative"
    >
      <AgentAvatar name={node.name} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{node.displayName}</span>
          <AgentStatusBadge status={(node.status as AgentStatus) ?? 'idle'} />
        </div>
        <p className="text-xs text-slate-500 truncate">{node.role}</p>
      </div>
      <Link
        href={`/agents/${node.id}/chat`}
        onClick={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-slate-700 transition-all text-slate-400 hover:text-sky-400 flex-shrink-0"
        title="Chat"
      >
        <MessageCircle size={14} />
      </Link>
    </Link>
  );
}
