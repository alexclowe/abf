'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AgentForm, type AgentFormData } from '@/components/AgentForm';

interface Archetype {
  name: string;
  temperature: number;
  tools: string[];
  allowedActions: string[];
  forbiddenActions: string[];
}

export default function EditAgentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [initialData, setInitialData] = useState<Partial<AgentFormData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [agent, archs] = await Promise.all([
          api.agents.get(id),
          api.archetypes.list(),
        ]);
        setArchetypes(archs);

        const config = agent.config;
        setInitialData({
          name: config.name,
          displayName: config.displayName,
          role: config.role,
          description: config.description ?? '',
          roleArchetype: '',
          provider: config.provider,
          model: config.model,
          temperature: config.temperature ?? 0.3,
          team: config.team ?? '',
          reportsTo: config.reportsTo ?? '',
          tools: config.tools.join(', '),
          triggers: config.triggers.map((t) => ({
            type: t.type,
            schedule: t.schedule,
            task: t.task,
            from: t.from,
          })),
          allowedActions: config.behavioralBounds.allowedActions.join(', '),
          forbiddenActions: config.behavioralBounds.forbiddenActions.join(', '),
          maxCostPerSession: typeof config.behavioralBounds.maxCostPerSession === 'number'
            ? `$${(config.behavioralBounds.maxCostPerSession / 100).toFixed(2)}`
            : `${config.behavioralBounds.maxCostPerSession}`,
          requiresApproval: (
            (config.behavioralBounds as unknown as Record<string, unknown>)['requiresApproval'] as string[]
            ?? config.behavioralBounds.requires_approval
            ?? []
          ).join(', '),
          charter: config.charter ?? '',
          kpis: config.kpis.map((k) => ({
            metric: k.metric,
            target: k.target,
            review: k.review,
          })),
        });
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleSubmit(body: Record<string, unknown>) {
    await api.agents.update(id, body);
    router.push(`/agents/${id}`);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.agents.delete(id);
      router.push('/agents');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-slate-400">Loading agent...</div>;
  }

  if (loadError) {
    return (
      <div className="p-6">
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load agent: {loadError}
        </div>
        <Link href="/agents" className="text-slate-400 hover:text-white transition-colors text-sm mt-4 inline-block">
          &larr; Back to Agents
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href={`/agents/${id}`} className="text-slate-400 hover:text-white transition-colors text-sm">
              &larr; {initialData?.displayName ?? id}
            </Link>
          </div>
          <h1 className="text-2xl font-bold mt-1">Edit Agent</h1>
          <p className="text-slate-400 text-sm mt-1">
            Update configuration for <span className="text-white">{initialData?.displayName}</span>.
          </p>
        </div>

        {/* Delete button */}
        <div>
          {!deleteConfirm ? (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Delete Agent
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-400">Are you sure?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
              >
                {deleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-sm font-medium transition-colors border border-slate-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {initialData && (
        <AgentForm
          initialData={initialData}
          archetypes={archetypes}
          onSubmit={handleSubmit}
          submitLabel="Save Changes"
          isEdit
        />
      )}
    </div>
  );
}
