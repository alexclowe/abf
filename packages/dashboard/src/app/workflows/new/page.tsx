'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { Plus, Trash2, Sparkles } from 'lucide-react';

interface StepForm {
  id: string;
  agent: string;
  task: string;
  dependsOn: string;
  parallel: boolean;
}

const EMPTY_STEP: StepForm = { id: '', agent: '', task: '', dependsOn: '', parallel: false };

interface WorkflowTemplate {
  name: string;
  displayName: string;
  description: string;
  steps: { id: string; agent: string; task: string; dependsOn?: string[] }[];
  timeout: number;
  onFailure: string;
}

export default function NewWorkflowPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<StepForm[]>([{ ...EMPTY_STEP }]);
  const [timeout, setTimeout_] = useState('');
  const [onFailure, setOnFailure] = useState('stop');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Try loading workflow templates
  const { data: templates } = useSWR<WorkflowTemplate[]>('workflow-templates', async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_ABF_API_URL ?? ''}/api/workflow-templates`, {
        cache: 'no-store',
      });
      if (!res.ok) return [];
      return res.json() as Promise<WorkflowTemplate[]>;
    } catch {
      return [];
    }
  }, { revalidateOnFocus: false });

  function addStep() {
    setSteps([...steps, { ...EMPTY_STEP }]);
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  function updateStep(index: number, field: keyof StepForm, value: string | boolean) {
    const updated = steps.map((s, i) =>
      i === index ? { ...s, [field]: value } as StepForm : s,
    );
    setSteps(updated);
  }

  function loadTemplate(template: WorkflowTemplate) {
    setName(template.name);
    setDisplayName(template.displayName);
    setDescription(template.description);
    setOnFailure(template.onFailure);
    if (template.timeout) setTimeout_(String(template.timeout));
    setSteps(
      template.steps.map((s) => ({
        id: s.id,
        agent: s.agent,
        task: s.task,
        dependsOn: s.dependsOn?.join(', ') ?? '',
        parallel: false,
      }))
    );
  }

  async function handleSubmit() {
    if (!name.trim() || !displayName.trim() || steps.length === 0) {
      setError('Name, display name, and at least one step are required.');
      return;
    }

    const invalidSteps = steps.filter((s) => !s.id.trim() || !s.agent.trim() || !s.task.trim());
    if (invalidSteps.length > 0) {
      setError('All steps must have an ID, agent, and task.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body = {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim() || undefined,
        timeout: timeout ? Number(timeout) : undefined,
        onFailure,
        steps: steps.map((s) => ({
          id: s.id.trim(),
          agent: s.agent.trim(),
          task: s.task.trim(),
          dependsOn: s.dependsOn
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean),
          parallel: s.parallel,
        })),
      };

      await api.workflows.create(body);
      router.push('/workflows');
    } catch (e) {
      setError(`Failed to create: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Create Workflow</h1>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      {/* Quick Start from Template */}
      {templates && templates.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h2 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
            <Sparkles size={14} className="text-amber-400" />
            Quick Start from Template
          </h2>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                type="button"
                key={t.name}
                onClick={() => loadTemplate(t)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors"
              >
                {t.displayName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Workflow details */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Workflow Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-400 block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              placeholder="my-workflow"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 block mb-1">Display Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              placeholder="My Workflow"
            />
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-none"
            rows={2}
            placeholder="What this workflow does..."
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-400 block mb-1">Timeout (ms, optional)</label>
            <input
              type="number"
              value={timeout}
              onChange={(e) => setTimeout_(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              placeholder="300000"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 block mb-1">On Failure</label>
            <select
              value={onFailure}
              onChange={(e) => setOnFailure(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            >
              <option value="stop">Stop</option>
              <option value="continue">Continue</option>
              <option value="retry">Retry</option>
            </select>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-slate-400">Steps ({steps.length})</h2>
          <button
            type="button"
            onClick={addStep}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors flex items-center gap-1"
          >
            <Plus size={14} />
            Add Step
          </button>
        </div>

        {steps.map((step, index) => (
          <div key={index} className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-mono">Step {index + 1}</span>
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                  aria-label={`Remove step ${index + 1}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Step ID</label>
                <input
                  value={step.id}
                  onChange={(e) => updateStep(index, 'id', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
                  placeholder="step-1"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Agent</label>
                <input
                  value={step.agent}
                  onChange={(e) => updateStep(index, 'agent', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
                  placeholder="agent-name"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Task</label>
              <input
                value={step.task}
                onChange={(e) => updateStep(index, 'task', e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
                placeholder="What the agent should do"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Depends On (comma-separated step IDs)</label>
                <input
                  value={step.dependsOn}
                  onChange={(e) => updateStep(index, 'dependsOn', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
                  placeholder="step-1, step-2"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={step.parallel}
                    onChange={(e) => updateStep(index, 'parallel', e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                  />
                  Parallel
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push('/workflows')}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
        >
          {saving ? 'Creating...' : 'Create Workflow'}
        </button>
      </div>
    </div>
  );
}
