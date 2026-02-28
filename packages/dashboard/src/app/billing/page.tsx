'use client';

import { useState } from 'react';
import useSWR from 'swr';

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? '';

function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  const apiKey = process.env.NEXT_PUBLIC_ABF_API_KEY;
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
  return h;
}

async function fetchBalance() {
  const res = await fetch(`${BASE}/api/billing/balance`, { headers: headers() });
  if (!res.ok) throw new Error(res.statusText);
  return res.json() as Promise<{ balanceCents: number; lifetimeUsageCents: number; lastTopUp: string | null }>;
}

async function fetchUsage() {
  const res = await fetch(`${BASE}/api/billing/usage`, { headers: headers() });
  if (!res.ok) throw new Error(res.statusText);
  return res.json() as Promise<{
    records: Array<{ agentId: string; provider: string; model: string; costCents: number; timestamp: string; inputTokens: number; outputTokens: number }>;
    byAgent: Record<string, { totalCents: number; sessions: number; tokens: number }>;
    totalRecords: number;
  }>;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function BillingPage() {
  const { data: balance, error: balError } = useSWR('billing-balance', fetchBalance, { refreshInterval: 10_000 });
  const { data: usage, error: usageError } = useSWR('billing-usage', fetchUsage, { refreshInterval: 10_000 });
  const [topUpAmount, setTopUpAmount] = useState('5.00');
  const [topUpStatus, setTopUpStatus] = useState<string | null>(null);

  async function handleTopUp() {
    const cents = Math.round(Number.parseFloat(topUpAmount) * 100);
    if (cents <= 0 || Number.isNaN(cents)) return;
    try {
      await fetch(`${BASE}/api/billing/topup`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: cents, source: 'manual' }),
      });
      setTopUpStatus('Credits added!');
      setTimeout(() => setTopUpStatus(null), 3000);
    } catch (e) {
      setTopUpStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (balError) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Billing</h1>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 text-center text-slate-400">
          Billing is not enabled. Set <code className="text-sky-400">ABF_BILLING_MODE=proxy</code> to enable usage tracking.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-sm text-slate-400">Balance</h3>
          <p className="text-3xl font-bold text-emerald-400 mt-1">
            {balance ? formatCents(balance.balanceCents) : '...'}
          </p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-sm text-slate-400">Lifetime Usage</h3>
          <p className="text-3xl font-bold text-sky-400 mt-1">
            {balance ? formatCents(balance.lifetimeUsageCents) : '...'}
          </p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-sm text-slate-400">Last Top-Up</h3>
          <p className="text-lg font-medium text-slate-300 mt-1">
            {balance?.lastTopUp ? new Date(balance.lastTopUp).toLocaleDateString() : 'Never'}
          </p>
        </div>
      </div>

      {/* Top Up */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-400 mb-3">Add Credits</h3>
        <div className="flex gap-2 items-center">
          <span className="text-slate-400">$</span>
          <input
            value={topUpAmount}
            onChange={(e) => setTopUpAmount(e.target.value)}
            type="number"
            min="1"
            step="1"
            className="w-32 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          />
          <button
            type="button"
            onClick={handleTopUp}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            Add Credits
          </button>
          {topUpStatus && <span className="text-sm text-sky-400">{topUpStatus}</span>}
        </div>
      </div>

      {/* Usage by Agent */}
      {usage && Object.keys(usage.byAgent).length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Usage by Agent</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium">Sessions</th>
                  <th className="pb-2 font-medium">Tokens</th>
                  <th className="pb-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(usage.byAgent).map(([agent, data]) => (
                  <tr key={agent} className="border-t border-slate-800">
                    <td className="py-2 font-mono">{agent}</td>
                    <td className="py-2">{data.sessions}</td>
                    <td className="py-2">{data.tokens.toLocaleString()}</td>
                    <td className="py-2 text-right text-sky-400">{formatCents(data.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Usage */}
      {usage && usage.records.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">
            Recent Usage ({usage.totalRecords} records)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 font-medium">Tokens</th>
                  <th className="pb-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.records.slice(-20).reverse().map((r, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="py-2 text-slate-400">{new Date(r.timestamp).toLocaleTimeString()}</td>
                    <td className="py-2 font-mono">{r.agentId}</td>
                    <td className="py-2 text-slate-400">{r.model}</td>
                    <td className="py-2">{(r.inputTokens + r.outputTokens).toLocaleString()}</td>
                    <td className="py-2 text-right text-sky-400">{formatCents(r.costCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {usageError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load usage data.
        </div>
      )}
    </div>
  );
}
