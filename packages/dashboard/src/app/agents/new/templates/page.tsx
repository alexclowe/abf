'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Archetype {
  name: string;
  temperature: number;
  tools: string[];
  allowedActions: string[];
  forbiddenActions: string[];
}

function toTitleCase(s: string): string {
  return s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function TemplateGalleryPage() {
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.archetypes
      .list()
      .then((data) => {
        setArchetypes(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Link href="/agents/new" className="text-slate-400 hover:text-white transition-colors text-sm">
            &larr; Create Agent
          </Link>
        </div>
        <h1 className="text-2xl font-bold mt-1">Agent Templates</h1>
        <p className="text-slate-400 text-sm mt-1">
          Browse pre-configured archetypes. Each template sets up tools, permissions, and behavioral bounds for you.
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load archetypes: {error}
        </div>
      )}

      {loading && (
        <div className="text-slate-400 text-sm">Loading templates...</div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {archetypes.map((arch) => (
            <div
              key={arch.name}
              className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col justify-between hover:border-slate-700 transition-colors"
            >
              <div>
                <h2 className="text-lg font-semibold text-white">{toTitleCase(arch.name)}</h2>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                  <span>{arch.tools.length} tool{arch.tools.length !== 1 ? 's' : ''}</span>
                  <span>Temp {arch.temperature}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {arch.tools.map((tool) => (
                    <span
                      key={tool}
                      className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-400"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-4">
                <Link
                  href={`/agents/new?archetype=${arch.name}`}
                  className="block w-full text-center px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
                >
                  Use This Template
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
