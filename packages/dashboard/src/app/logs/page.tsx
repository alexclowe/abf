'use client';

import { api } from '@/lib/api';
import clsx from 'clsx';
import { useState } from 'react';
import useSWR from 'swr';

const severityColor: Record<string, string> = {
	info: 'text-blue-400 bg-blue-500/10',
	warn: 'text-yellow-400 bg-yellow-500/10',
	error: 'text-red-400 bg-red-500/10',
	security: 'text-purple-400 bg-purple-500/10',
};

const SEVERITY_LEVELS = ['info', 'warn', 'error', 'security'] as const;

export default function LogsPage() {
	const [agentFilter, setAgentFilter] = useState('');
	const [severityFilter, setSeverityFilter] = useState('');
	const [expandedRow, setExpandedRow] = useState<number | null>(null);
	const { data: entries, error } = useSWR(
		['audit', agentFilter],
		() => api.audit.query({ agentId: agentFilter || undefined, limit: 100 }),
		{ refreshInterval: 5000 },
	);

	const filteredEntries = entries?.filter((e) => !severityFilter || e.severity === severityFilter);

	return (
		<div className="p-6 space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">Audit Logs</h1>
				<div className="flex gap-2 items-center">
					<div className="flex gap-1">
						<button
							type="button"
							onClick={() => setSeverityFilter('')}
							className={clsx(
								'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
								!severityFilter ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400 hover:text-white hover:bg-slate-800',
							)}
						>
							All
						</button>
						{SEVERITY_LEVELS.map((s) => (
							<button
								type="button"
								key={s}
								onClick={() => setSeverityFilter(severityFilter === s ? '' : s)}
								className={clsx(
									'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
									severityFilter === s ? severityColor[s] : 'text-slate-400 hover:text-white hover:bg-slate-800',
								)}
							>
								{s}
							</button>
						))}
					</div>
					<input
						value={agentFilter}
						onChange={(e) => setAgentFilter(e.target.value)}
						placeholder="Filter by agent ID..."
						className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm w-48 focus:outline-none focus:border-sky-500"
					/>
				</div>
			</div>

			{error && (
				<div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
					Failed to load logs: {error.message}
				</div>
			)}

			{entries && entries.length === 0 && (
				<div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
					<p className="text-slate-400">No audit entries found.</p>
				</div>
			)}

			{filteredEntries && filteredEntries.length > 0 && (
				<div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-800 text-slate-500 text-xs">
								<th className="text-left p-3 font-medium">Timestamp</th>
								<th className="text-left p-3 font-medium">Event</th>
								<th className="text-left p-3 font-medium">Agent</th>
								<th className="text-left p-3 font-medium">Severity</th>
								<th className="text-left p-3 font-medium">Details</th>
							</tr>
						</thead>
						<tbody>
							{filteredEntries.map((entry, i) => (
								<tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer" onClick={() => setExpandedRow(expandedRow === i ? null : i)}>
									<td className="p-3 text-xs text-slate-500 font-mono whitespace-nowrap">
										{new Date(entry.timestamp).toLocaleString()}
									</td>
									<td className="p-3 font-mono text-xs">{entry.eventType}</td>
									<td className="p-3 text-sky-400 text-xs">{entry.agentId}</td>
									<td className="p-3">
										<span
											className={clsx(
												'px-2 py-0.5 rounded-full text-xs font-medium',
												severityColor[entry.severity] ?? 'text-slate-400',
											)}
										>
											{entry.severity}
										</span>
									</td>
									<td className="p-3 text-xs text-slate-400 max-w-xs truncate">
										{expandedRow === i
											? <pre className="whitespace-pre-wrap font-mono">{JSON.stringify(entry.details, null, 2)}</pre>
											: JSON.stringify(entry.details)
										}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{filteredEntries && filteredEntries.length === 0 && entries && entries.length > 0 && (
				<div className="text-slate-500 text-sm">No logs match the selected severity filter.</div>
			)}
		</div>
	);
}
