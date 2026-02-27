'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { Save, Trash2 } from 'lucide-react';
import Link from 'next/link';

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: teams, error } = useSWR('teams', () => api.teams.list(), { refreshInterval: 5000 });
  const { data: agentsList } = useSWR('agents', () => api.agents.list(), { revalidateOnFocus: false });
  const agentNames = agentsList?.map((a) => a.config.name) ?? [];

  const team = teams?.find((t) => t.id === id || t.name === id);

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [orchestrator, setOrchestrator] = useState('');
  const [members, setMembers] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  function startEditing() {
    if (!team) return;
    setDisplayName(team.displayName);
    setDescription(team.description);
    setOrchestrator(team.orchestrator);
    setMembers(team.members.join(', '));
    setEditing(true);
    setActionError(null);
    setActionSuccess(null);
  }

  async function handleSave() {
    if (!team) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.teams.update(team.id ?? team.name, {
        displayName: displayName.trim(),
        description: description.trim(),
        orchestrator: orchestrator.trim(),
        members: members
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
      });
      setEditing(false);
      setActionSuccess('Team updated successfully');
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) {
      setActionError(`Failed to update: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!team) return;
    setActionError(null);
    try {
      await api.teams.delete(team.id ?? team.name);
      router.push('/teams');
    } catch (e) {
      setActionError(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load teams: {error.message}
        </div>
      </div>
    );
  }

  if (!teams) {
    return <div className="p-6 text-slate-400 text-sm">Loading...</div>;
  }

  if (!team) {
    return (
      <div className="p-6 space-y-4">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Team not found: {id}
        </div>
        <Link href="/teams" className="text-sky-400 hover:text-sky-300 text-sm">
          Back to Teams
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{team.displayName}</h1>
            <span className="text-sm text-slate-500 font-mono">({team.name})</span>
          </div>
          <p className="text-slate-400 mt-1">{team.description}</p>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <button
              onClick={startEditing}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Edit Team
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>

      {actionError && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      {actionSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-green-400 text-sm">
          {actionSuccess}
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-sm text-red-400 mb-3">
            Are you sure you want to delete team &quot;{team.displayName}&quot;? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Yes, Delete
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Team details / edit form */}
      {editing ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-slate-400 mb-2">Edit Team</h2>

          <div>
            <label className="text-sm text-slate-400 block mb-1">Display Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-sm text-slate-400 block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-none"
              rows={2}
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
              />
            )}
          </div>

          <div>
            <label className="text-sm text-slate-400 block mb-1">Members (comma-separated)</label>
            <input
              value={members}
              onChange={(e) => setMembers(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
            {agentNames.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Available: {agentNames.join(', ')}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Name</dt>
                <dd className="font-mono">{team.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Display Name</dt>
                <dd>{team.displayName}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Orchestrator</dt>
                <dd className="text-sky-400">{team.orchestrator || '-'}</dd>
              </div>
            </dl>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Members ({team.members.length})</h3>
            {team.members.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {team.members.map((member) => (
                  <Link
                    key={member}
                    href={`/agents/${member}`}
                    className="px-2 py-1 bg-slate-800 text-sky-400 hover:bg-slate-700 rounded text-sm transition-colors"
                  >
                    {member}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No members assigned.</p>
            )}
          </div>
        </div>
      )}

      <div className="pt-2">
        <Link href="/teams" className="text-sm text-sky-400 hover:text-sky-300 transition-colors">
          Back to Teams
        </Link>
      </div>
    </div>
  );
}
