import clsx from 'clsx';
import type { AgentStatus } from '@/lib/types';

const styles: Record<AgentStatus, string> = {
  idle: 'bg-slate-700 text-slate-300',
  active: 'bg-green-500/20 text-green-400 animate-pulse',
  waiting: 'bg-yellow-500/20 text-yellow-400',
  error: 'bg-red-500/20 text-red-400',
  disabled: 'bg-slate-800 text-slate-500',
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', styles[status])}>
      {status}
    </span>
  );
}
