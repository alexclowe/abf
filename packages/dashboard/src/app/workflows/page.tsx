'use client';

import useSWR from 'swr';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { WorkflowDefinition } from '@/lib/types';
import { GitBranch, Play, Plus } from 'lucide-react';
import Link from 'next/link';

function WorkflowGraph({ workflow }: { workflow: WorkflowDefinition }) {
  const completed = new Set<string>();
  const remaining = [...workflow.steps];
  const waves: typeof workflow.steps[] = [];
  while (remaining.length > 0) {
    const ready = remaining.filter(s => !s.dependsOn || s.dependsOn.every(d => completed.has(d)));
    if (ready.length === 0) { waves.push([...remaining]); break; }
    waves.push(ready);
    for (const s of ready) { completed.add(s.id); remaining.splice(remaining.indexOf(s), 1); }
  }

  return (
    <div className="flex items-start gap-4 overflow-x-auto py-2">
      {waves.map((wave, wi) => (
        <div key={wi} className="flex flex-col gap-2 min-w-[160px]">
          {wave.map(step => (
            <div key={step.id} className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs">
              <div className="font-mono text-sky-400 font-medium">{step.agent}</div>
              <div className="text-slate-400 mt-1 truncate" title={step.task}>{step.task.slice(0, 60)}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function WorkflowsPage() {
  const { data: workflows, error } = useSWR('workflows', () => api.workflows.list(), { refreshInterval: 10000 });
  const [running, setRunning] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const handleRun = async (name: string) => {
    setRunning(name);
    setRunError(null);
    try {
      await api.workflows.run(name, {});
    } catch (e) {
      setRunError(`Failed to run "${name}": ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workflows</h1>
        <Link
          href="/workflows/new"
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={14} />
          New Workflow
        </Link>
      </div>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load workflows: {error.message}
        </div>
      )}

      {runError && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{runError}</span>
          <button type="button" onClick={() => setRunError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      {workflows && workflows.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <p className="text-slate-400 mb-3">No workflows configured yet.</p>
          <Link
            href="/workflows/new"
            className="inline-block px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            Create your first workflow
          </Link>
        </div>
      )}

      {workflows?.map(wf => (
        <div key={wf.name} className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GitBranch size={16} className="text-sky-400" />
              <h2 className="font-semibold">{wf.displayName}</h2>
              <span className="text-slate-500 text-sm font-mono">({wf.name})</span>
            </div>
            <button
              type="button"
              onClick={() => void handleRun(wf.name)}
              disabled={running === wf.name}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md text-sm font-medium transition-colors"
            >
              <Play size={12} />
              {running === wf.name ? 'Starting...' : 'Run'}
            </button>
          </div>
          {wf.description && <p className="text-slate-400 text-sm mb-3">{wf.description}</p>}
          <WorkflowGraph workflow={wf} />
          <div className="mt-2 text-xs text-slate-500">{wf.steps.length} steps · on failure: {wf.onFailure}</div>
        </div>
      ))}
    </div>
  );
}
