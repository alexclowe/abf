'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import type { AgentListItem, KPIReport } from '@/lib/types';
import { TrendingUp } from 'lucide-react';
import clsx from 'clsx';

export default function KPIsPage() {
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const { data: agents } = useSWR('agents-list', () => api.agents.list());
  const { data: kpis } = useSWR(
    ['kpis', selectedAgent],
    () => api.kpis.list(selectedAgent || undefined),
    { refreshInterval: 5000 },
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">KPI Dashboard</h1>

      {/* Agent filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400">Filter by agent:</label>
        <select
          value={selectedAgent}
          onChange={e => setSelectedAgent(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
        >
          <option value="">All Agents</option>
          {agents?.map((a: AgentListItem) => (
            <option key={a.config.id} value={a.config.id}>
              {a.config.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* KPI table */}
      {!kpis || kpis.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center text-slate-400">
          <TrendingUp size={32} className="mx-auto mb-3 text-slate-600" />
          <p>No KPI data yet.</p>
          <p className="text-sm mt-1">Run an agent to start tracking metrics.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Metric</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Value</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Target</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {[...kpis].reverse().map((kpi: KPIReport, i: number) => (
                <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-sky-400 text-xs">{kpi.metric}</td>
                  <td className="px-4 py-2.5">{kpi.value}</td>
                  <td className="px-4 py-2.5 text-slate-400">{kpi.target}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx(
                      'px-2 py-0.5 rounded-full text-xs font-medium',
                      kpi.met ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400',
                    )}>
                      {kpi.met ? 'met' : 'missed'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">
                    {new Date(kpi.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
