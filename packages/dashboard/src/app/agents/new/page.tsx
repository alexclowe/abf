'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AgentForm } from '@/components/AgentForm';

interface Archetype {
  name: string;
  temperature: number;
  tools: string[];
  allowedActions: string[];
  forbiddenActions: string[];
}

export default function NewAgentPage() {
  const router = useRouter();
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.archetypes
      .list()
      .then(setArchetypes)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function handleSubmit(body: Record<string, unknown>) {
    await api.agents.create(body);
    router.push('/agents');
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/agents" className="text-slate-400 hover:text-white transition-colors text-sm">
              &larr; Agents
            </Link>
          </div>
          <h1 className="text-2xl font-bold mt-1">Create New Agent</h1>
          <p className="text-slate-400 text-sm mt-1">
            Define a new AI agent with role, tools, triggers, and behavioral bounds.
          </p>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load archetypes: {loadError}
        </div>
      )}

      <AgentForm
        archetypes={archetypes}
        onSubmit={handleSubmit}
        submitLabel="Create Agent"
      />
    </div>
  );
}
