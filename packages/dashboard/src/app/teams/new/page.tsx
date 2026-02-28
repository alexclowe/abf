'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { Plus, Trash2 } from 'lucide-react';

export default function NewTeamPage() {
  const router = useRouter();

  const { data: agentsList } = useSWR('agents', () => api.agents.list(), { revalidateOnFocus: false });
  const agentNames = agentsList?.map((a) => a.config.name) ?? [];

  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [orchestrator, setOrchestrator] = useState('');
  const [members, setMembers] = useState('');
  const [goals, setGoals] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addGoal() {
    setGoals([...goals, '']);
  }

  function removeGoal(index: number) {
    setGoals(goals.filter((_, i) => i !== index));
  }

  function updateGoal(index: number, value: string) {
    const updated = [...goals];
    updated[index] = value;
    setGoals(updated);
  }

  async function handleSubmit() {
    if (!name.trim() || !displayName.trim()) {
      setError('Name and display name are required.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body = {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        orchestrator: orchestrator.trim() || undefined,
        members: members
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
        goals: goals.filter((g) => g.trim()),
      };

      await api.teams.create(body);
      router.push('/teams');
    } catch (e) {
      setError(`Failed to create: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Create Team</h1>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Team Details</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-400 block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              placeholder="engineering"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 block mb-1">Display Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              placeholder="Engineering Team"
            />
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-400 block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-none"
            rows={2}
            placeholder="What this team is responsible for..."
          />
        </div>

        <div>
          <label className="text-sm text-slate-400 block mb-1">Orchestrator</label>
          {agentNames.length > 0 ? (
            <select
              value={orchestrator}
              onChange={(e) => setOrchestrator(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            >
              <option value="">Select orchestrator...</option>
              {agentNames.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          ) : (
            <input
              value={orchestrator}
              onChange={(e) => setOrchestrator(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              placeholder="orchestrator-agent-name"
            />
          )}
        </div>

        <div>
          <label className="text-sm text-slate-400 block mb-1">Members (comma-separated agent names)</label>
          <input
            value={members}
            onChange={(e) => setMembers(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            placeholder="agent-1, agent-2, agent-3"
          />
          {agentNames.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              Available: {agentNames.join(', ')}
            </p>
          )}
        </div>
      </div>

      {/* Goals */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-slate-400">Goals</h2>
          <button
            type="button"
            onClick={addGoal}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors flex items-center gap-1"
          >
            <Plus size={14} />
            Add Goal
          </button>
        </div>

        {goals.map((goal, index) => (
          <div key={index} className="flex gap-2">
            <input
              value={goal}
              onChange={(e) => updateGoal(index, e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              placeholder={`Goal ${index + 1}`}
            />
            {goals.length > 1 && (
              <button
                type="button"
                onClick={() => removeGoal(index)}
                className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                aria-label={`Remove goal ${index + 1}`}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push('/teams')}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
        >
          {saving ? 'Creating...' : 'Create Team'}
        </button>
      </div>
    </div>
  );
}
