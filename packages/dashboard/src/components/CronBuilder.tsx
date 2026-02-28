'use client';

import { useState } from 'react';

interface CronBuilderProps {
  value: string;
  onChange: (cron: string) => void;
  className?: string;
}

interface CronPreset {
  label: string;
  cron: string;
  description: string;
}

const PRESETS: CronPreset[] = [
  { label: 'Every 15 minutes', cron: '*/15 * * * *', description: 'Runs 4 times per hour' },
  { label: 'Every 30 minutes', cron: '*/30 * * * *', description: 'Runs 2 times per hour' },
  { label: 'Every hour', cron: '0 * * * *', description: 'Runs at the top of each hour' },
  { label: 'Every 2 hours', cron: '0 */2 * * *', description: 'Runs 12 times per day' },
  { label: 'Every 6 hours', cron: '0 */6 * * *', description: 'Runs 4 times per day' },
  { label: 'Daily at 9 AM', cron: '0 9 * * *', description: 'Runs once per day at 9:00 AM' },
  { label: 'Daily at midnight', cron: '0 0 * * *', description: 'Runs once per day at 12:00 AM' },
  { label: 'Weekdays at 9 AM', cron: '0 9 * * 1-5', description: 'Mon-Fri at 9:00 AM' },
  { label: 'Weekly (Monday)', cron: '0 9 * * 1', description: 'Every Monday at 9:00 AM' },
  { label: 'Monthly (1st)', cron: '0 9 1 * *', description: '1st of each month at 9:00 AM' },
];

export function CronBuilder({ value, onChange, className }: CronBuilderProps) {
  const [mode, setMode] = useState<'preset' | 'custom'>(
    PRESETS.some((p) => p.cron === value) ? 'preset' : value ? 'custom' : 'preset',
  );

  const inputClass =
    'w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500';

  const matchingPreset = PRESETS.find((p) => p.cron === value);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => setMode('preset')}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            mode === 'preset' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Presets
        </button>
        <button
          type="button"
          onClick={() => setMode('custom')}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            mode === 'custom' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Custom
        </button>
      </div>

      {mode === 'preset' ? (
        <div className="space-y-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.cron}
              type="button"
              onClick={() => onChange(preset.cron)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                value === preset.cron
                  ? 'bg-sky-600/20 text-sky-400 border border-sky-600/30'
                  : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800 border border-transparent'
              }`}
            >
              <span className="font-medium">{preset.label}</span>
              <span className="text-slate-500 ml-2 text-xs">{preset.description}</span>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 */2 * * *"
            className={inputClass}
          />
          <p className="text-xs text-slate-500 mt-1">
            Format: minute hour day month weekday
            {matchingPreset && (
              <span className="text-sky-400 ml-2">= {matchingPreset.label}</span>
            )}
          </p>
        </div>
      )}

      {value && (
        <p className="text-xs text-slate-500 mt-2 font-mono">
          Cron: <span className="text-slate-300">{value}</span>
        </p>
      )}
    </div>
  );
}
