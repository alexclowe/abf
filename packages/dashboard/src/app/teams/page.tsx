'use client';

import useSWR from 'swr';
import { api } from '@/lib/api';
import { Users, Plus } from 'lucide-react';
import Link from 'next/link';

export default function TeamsPage() {
  const { data: teams, error } = useSWR('teams', () => api.teams.list(), { refreshInterval: 3000 });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Teams</h1>
        <Link
          href="/teams/new"
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={14} />
          New Team
        </Link>
      </div>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load teams: {error.message}
        </div>
      )}

      {teams && teams.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <p className="text-slate-400 mb-3">No teams configured yet.</p>
          <Link
            href="/teams/new"
            className="inline-block px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            Create your first team
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {teams?.map((team) => (
          <Link key={team.id} href={`/teams/${team.name}`} className="block">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-700 transition-colors">
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
          </Link>
        ))}
      </div>
    </div>
  );
}
