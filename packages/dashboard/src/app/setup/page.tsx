'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { api } from '@/lib/api';
import clsx from 'clsx';

type Step = 1 | 2 | 3 | 4;

const providers = [
  { id: 'anthropic', name: 'Anthropic (Claude)', desc: 'Best for reasoning and writing. Recommended.', needsKey: true, keyUrl: 'https://console.anthropic.com/keys' },
  { id: 'openai', name: 'OpenAI (GPT)', desc: 'Fast and reliable. Good alternative.', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'ollama', name: 'Ollama', desc: 'Free, runs on your computer. No internet required.', needsKey: false, keyUrl: null },
];

const templates = [
  { id: 'solo-founder', name: 'Solo Founder', desc: 'Minimal setup with a few core agents' },
  { id: 'saas', name: 'SaaS', desc: 'Full product team with engineering, support, and finance' },
  { id: 'marketing-agency', name: 'Marketing Agency', desc: 'Content, SEO, social media, and analytics agents' },
  { id: 'custom', name: 'Custom', desc: 'Start from scratch with an empty project' },
];

export default function SetupPage() {
  const router = useRouter();
  const { data: status } = useSWR('status', () => api.status(), { refreshInterval: 5000 });

  const [step, setStep] = useState<Step>(1);
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [template, setTemplate] = useState('');
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const selectedProvider = providers.find((p) => p.id === provider);

  async function handleCreate() {
    if (!projectName.trim() || !template || !provider) return;
    setCreating(true);
    setError('');
    try {
      // Store API key through vault v2 auth flow before project creation
      if (selectedProvider?.needsKey && apiKey) {
        await api.auth.connectKey(provider, apiKey);
      }

      await api.projects.create({
        template,
        projectName: projectName.trim(),
        provider,
      });
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Setup Wizard</h1>

      {/* Already configured shortcut */}
      {status?.configured && (
        <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-4 flex items-center justify-between">
          <span className="text-sky-400 text-sm">Already configured.</span>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-sky-400 hover:text-sky-300 underline"
          >
            Go to overview
          </button>
        </div>
      )}

      {/* Progress */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={clsx(
              'h-1.5 flex-1 rounded-full transition-colors',
              s <= step ? 'bg-sky-500' : 'bg-slate-800',
            )}
          />
        ))}
      </div>
      <p className="text-sm text-slate-500">Step {step} of 4</p>

      {/* Step 1: Provider */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Choose an AI Provider</h2>
          <div className="grid grid-cols-3 gap-3">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={clsx(
                  'border rounded-lg p-4 text-left transition-colors',
                  provider === p.id
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-slate-800 bg-slate-900 hover:border-slate-700',
                )}
              >
                <div className="font-medium text-sm">{p.name}</div>
                <div className="text-xs text-slate-400 mt-1">{p.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => provider && setStep(2)}
              disabled={!provider}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 2: API Key */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">API Configuration</h2>
          {selectedProvider?.needsKey ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-slate-400">{selectedProvider.name} API Key</label>
                {selectedProvider.keyUrl && (
                  <a
                    href={selectedProvider.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-sky-400 hover:text-sky-300"
                  >
                    Get your key &rarr;
                  </a>
                )}
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              />
              <p className="text-xs text-slate-500 mt-1">Stored encrypted locally. Never sent to ABF servers.</p>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <p className="text-sm text-slate-300">No API key needed for Ollama.</p>
              <p className="text-xs text-slate-500 mt-1">
                Make sure Ollama is running locally on port 11434.
              </p>
            </div>
          )}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={selectedProvider?.needsKey && !apiKey}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Template */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Choose a Template</h2>
          <div className="grid grid-cols-2 gap-3">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={clsx(
                  'border rounded-lg p-4 text-left transition-colors',
                  template === t.id
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-slate-800 bg-slate-900 hover:border-slate-700',
                )}
              >
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-slate-400 mt-1">{t.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => template && setStep(4)}
              disabled={!template}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Project name + Create */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Name Your Project</h2>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Project Name</label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-business"
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-sm space-y-1">
            <div><span className="text-slate-500">Provider:</span> <span>{selectedProvider?.name}</span></div>
            <div><span className="text-slate-500">Template:</span> <span>{templates.find((t) => t.id === template)?.name}</span></div>
          </div>
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(3)}
              className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={!projectName.trim() || creating}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              {creating ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
