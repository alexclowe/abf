'use client';

import useSWR from 'swr';
import { api } from '@/lib/api';
import { Users } from 'lucide-react';

export default function TeamsPage() {
  const { data: teams, error } = useSWR('teams', () => api.teams.list(), { refreshInterval: 3000 });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Teams</h1>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load teams: {error.message}
        </div>
      )}

      {teams && teams.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <p className="text-slate-400">No teams configured.</p>
        </div>
      )}

      <div className="space-y-3">
        {teams?.map((team) => (
          <div key={team.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              <Users size={16} className="text-sky-400" />
              <h2 className="font-medium">{team.displayName}</h2>
            </div>
            <p className="text-sm text-slate-400 mb-3">{team.description}</p>
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-slate-500">Orchestrator: </span>
                <span className="text-sky-400">{team.orchestrator}</span>
              </div>
              <div>
                <span className="text-slate-500">Members: </span>
                <span className="text-slate-300">{team.members.join(', ')}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
