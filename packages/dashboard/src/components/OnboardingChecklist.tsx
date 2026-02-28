'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react';

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  href: string;
  check: (data: OnboardingData) => boolean;
}

interface OnboardingData {
  hasProvider: boolean;
  agentCount: number;
  hasRun: boolean;
  hasChannel: boolean;
  knowledgeCount: number;
}

const CHECKLIST: ChecklistItem[] = [
  {
    id: 'provider',
    label: 'Connect an AI provider',
    description: 'Set up Anthropic, OpenAI, or Ollama to power your agents.',
    href: '/settings/providers',
    check: (d) => d.hasProvider,
  },
  {
    id: 'agent',
    label: 'Create your first agent',
    description: 'Define an agent with a role, tools, and charter.',
    href: '/agents/new',
    check: (d) => d.agentCount > 0,
  },
  {
    id: 'run',
    label: 'Run an agent',
    description: 'Trigger your first agent session to see it in action.',
    href: '/agents',
    check: (d) => d.hasRun,
  },
  {
    id: 'knowledge',
    label: 'Add knowledge files',
    description: 'Upload company docs, brand guidelines, or SOPs to the knowledge base.',
    href: '/knowledge',
    check: (d) => d.knowledgeCount > 0,
  },
  {
    id: 'channel',
    label: 'Connect a channel',
    description: 'Wire up Slack, Discord, Telegram, or email for agent communication.',
    href: '/channels',
    check: (d) => d.hasChannel,
  },
];

const STORAGE_KEY = 'abf_onboarding_dismissed';

export function OnboardingChecklist({ data }: { data: OnboardingData }) {
  const [dismissed, setDismissed] = useState(true); // default hidden until we check localStorage
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setDismissed(stored === 'true');
  }, []);

  if (dismissed) return null;

  const completedCount = CHECKLIST.filter((item) => item.check(data)).length;
  const allDone = completedCount === CHECKLIST.length;

  function handleDismiss() {
    localStorage.setItem(STORAGE_KEY, 'true');
    setDismissed(true);
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <div>
            <h2 className="text-sm font-medium text-white">
              {allDone ? 'Setup Complete!' : 'Getting Started'}
            </h2>
            <p className="text-xs text-slate-500">
              {completedCount}/{CHECKLIST.length} steps completed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Progress bar */}
          <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / CHECKLIST.length) * 100}%` }}
            />
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-slate-500 hover:text-white transition-colors"
            title="Dismiss checklist"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="border-t border-slate-800">
          {CHECKLIST.map((item) => {
            const done = item.check(data);
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 border-b border-slate-800 last:border-b-0 transition-colors ${
                  done ? 'opacity-60' : 'hover:bg-slate-800/50'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                    done
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-slate-800 border border-slate-700'
                  }`}
                >
                  {done && <Check size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${done ? 'text-slate-500 line-through' : 'text-white'}`}>
                    {item.label}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{item.description}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
