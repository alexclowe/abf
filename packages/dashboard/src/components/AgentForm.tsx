'use client';

import { useState, useEffect, useCallback } from 'react';

// ── Types ───────────────────────────────────────────────────────────

interface Archetype {
  name: string;
  temperature: number;
  tools: string[];
  allowedActions: string[];
  forbiddenActions: string[];
}

interface TriggerEntry {
  type: 'cron' | 'manual' | 'message' | 'webhook' | 'event';
  schedule?: string;
  task?: string;
  from?: string;
}

interface KPIEntry {
  metric: string;
  target: string;
  review: string;
}

export interface AgentFormData {
  name: string;
  displayName: string;
  role: string;
  description: string;
  roleArchetype: string;
  provider: string;
  model: string;
  temperature: number;
  team: string;
  reportsTo: string;
  tools: string;
  triggers: TriggerEntry[];
  allowedActions: string;
  forbiddenActions: string;
  maxCostPerSession: string;
  requiresApproval: string;
  charter: string;
  kpis: KPIEntry[];
}

interface AgentFormProps {
  initialData?: Partial<AgentFormData>;
  archetypes: Archetype[];
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  submitLabel: string;
  isEdit?: boolean;
}

// ── Default model per provider ──────────────────────────────────────

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o',
  ollama: 'llama3.2',
};

const EMPTY_FORM: AgentFormData = {
  name: '',
  displayName: '',
  role: '',
  description: '',
  roleArchetype: '',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  temperature: 0.3,
  team: '',
  reportsTo: '',
  tools: 'web-search',
  triggers: [{ type: 'manual', task: 'default' }],
  allowedActions: 'read_data, write_draft',
  forbiddenActions: 'delete_data, modify_billing',
  maxCostPerSession: '$2.00',
  requiresApproval: '',
  charter: '',
  kpis: [],
};

// ── Component ───────────────────────────────────────────────────────

export function AgentForm({ initialData, archetypes, onSubmit, submitLabel, isEdit }: AgentFormProps) {
  const [form, setForm] = useState<AgentFormData>({ ...EMPTY_FORM, ...initialData });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync initial data when it arrives (for edit page loading)
  useEffect(() => {
    if (initialData) {
      setForm((prev) => ({ ...prev, ...initialData }));
    }
  }, [initialData]);

  const set = useCallback(<K extends keyof AgentFormData>(key: K, value: AgentFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Archetype selection ─────────────────────────────────────────

  function applyArchetype(arch: Archetype) {
    setForm((prev) => ({
      ...prev,
      roleArchetype: arch.name,
      temperature: arch.temperature,
      tools: arch.tools.join(', '),
      allowedActions: arch.allowedActions.join(', '),
      forbiddenActions: arch.forbiddenActions.join(', '),
    }));
  }

  function handleArchetypeChange(name: string) {
    if (name === 'custom' || name === '') {
      set('roleArchetype', name === 'custom' ? '' : '');
      return;
    }
    const arch = archetypes.find((a) => a.name === name);
    if (arch) applyArchetype(arch);
  }

  // ── Provider changes default model ──────────────────────────────

  function handleProviderChange(provider: string) {
    setForm((prev) => ({
      ...prev,
      provider,
      model: DEFAULT_MODELS[provider] ?? prev.model,
    }));
  }

  // ── Triggers ────────────────────────────────────────────────────

  function addTrigger() {
    setForm((prev) => ({
      ...prev,
      triggers: [...prev.triggers, { type: 'manual', task: '' }],
    }));
  }

  function removeTrigger(index: number) {
    setForm((prev) => ({
      ...prev,
      triggers: prev.triggers.filter((_, i) => i !== index),
    }));
  }

  function updateTrigger(index: number, field: string, value: string) {
    setForm((prev) => ({
      ...prev,
      triggers: prev.triggers.map((t, i) =>
        i === index ? { ...t, [field]: value } : t,
      ),
    }));
  }

  // ── KPIs ────────────────────────────────────────────────────────

  function addKPI() {
    setForm((prev) => ({
      ...prev,
      kpis: [...prev.kpis, { metric: '', target: '', review: 'weekly' }],
    }));
  }

  function removeKPI(index: number) {
    setForm((prev) => ({
      ...prev,
      kpis: prev.kpis.filter((_, i) => i !== index),
    }));
  }

  function updateKPI(index: number, field: string, value: string) {
    setForm((prev) => ({
      ...prev,
      kpis: prev.kpis.map((k, i) =>
        i === index ? { ...k, [field]: value } : k,
      ),
    }));
  }

  // ── Submit ──────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const splitList = (s: string) =>
        s.split(',').map((x) => x.trim()).filter(Boolean);

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        displayName: form.displayName.trim(),
        role: form.role.trim(),
        description: form.description.trim(),
        provider: form.provider,
        model: form.model.trim(),
        temperature: form.temperature,
        team: form.team.trim() || undefined,
        reportsTo: form.reportsTo.trim() || null,
        tools: splitList(form.tools),
        triggers: form.triggers.map((t) => {
          const trigger: Record<string, unknown> = { type: t.type };
          if (t.schedule) trigger.schedule = t.schedule;
          if (t.task) trigger.task = t.task;
          if (t.from) trigger.from = t.from;
          return trigger;
        }),
        behavioralBounds: {
          allowedActions: splitList(form.allowedActions),
          forbiddenActions: splitList(form.forbiddenActions),
          maxCostPerSession: form.maxCostPerSession.trim() || '$2.00',
          requiresApproval: splitList(form.requiresApproval),
        },
        charter: form.charter,
        kpis: form.kpis.filter((k) => k.metric.trim()),
      };

      if (form.roleArchetype) {
        body.roleArchetype = form.roleArchetype;
      }

      await onSubmit(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Quick-start archetype buttons ───────────────────────────────

  const inputClass =
    'w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500';
  const labelClass = 'text-sm text-slate-400';
  const sectionHeader = 'text-sm font-medium text-slate-400 mb-2';
  const card = 'bg-slate-900 border border-slate-800 rounded-lg p-4';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Quick Start Archetypes */}
      {!isEdit && archetypes.length > 0 && (
        <div className={card}>
          <h2 className={sectionHeader}>Quick Start - Pick an Archetype</h2>
          <p className="text-xs text-slate-500 mb-3">
            Select an archetype to pre-fill temperature, tools, and behavioral bounds. You can customize everything after.
          </p>
          <div className="flex flex-wrap gap-2">
            {archetypes.map((arch) => (
              <button
                key={arch.name}
                type="button"
                onClick={() => applyArchetype(arch)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  form.roleArchetype === arch.name
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                }`}
              >
                {arch.name.charAt(0).toUpperCase() + arch.name.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Basic Info */}
      <div className={card}>
        <h2 className={sectionHeader}>Basic Information</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Name *</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="scout"
              className={inputClass}
              required
              disabled={isEdit}
            />
            {isEdit && (
              <p className="text-xs text-slate-600 mt-1">Name cannot be changed after creation.</p>
            )}
          </div>
          <div>
            <label className={labelClass}>Display Name *</label>
            <input
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              placeholder="Research & Analytics"
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Role *</label>
            <input
              value={form.role}
              onChange={(e) => set('role', e.target.value)}
              placeholder="Citation Monitor"
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Role Archetype</label>
            <select
              value={form.roleArchetype || 'custom'}
              onChange={(e) => handleArchetypeChange(e.target.value)}
              className={inputClass}
            >
              <option value="custom">Custom</option>
              {archetypes.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name.charAt(0).toUpperCase() + a.name.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What this agent does..."
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>
      </div>

      {/* Model Configuration */}
      <div className={card}>
        <h2 className={sectionHeader}>Model Configuration</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Provider</label>
            <select
              value={form.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className={inputClass}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Model</label>
            <input
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
              placeholder="claude-sonnet-4-5"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Temperature</label>
            <input
              type="number"
              value={form.temperature}
              onChange={(e) => set('temperature', Number.parseFloat(e.target.value) || 0)}
              min={0}
              max={2}
              step={0.1}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Team & Reporting */}
      <div className={card}>
        <h2 className={sectionHeader}>Team & Reporting</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Team</label>
            <input
              value={form.team}
              onChange={(e) => set('team', e.target.value)}
              placeholder="product"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Reports To</label>
            <input
              value={form.reportsTo}
              onChange={(e) => set('reportsTo', e.target.value)}
              placeholder="atlas"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Tools */}
      <div className={card}>
        <h2 className={sectionHeader}>Tools</h2>
        <label className={labelClass}>Tool names (comma-separated)</label>
        <input
          value={form.tools}
          onChange={(e) => set('tools', e.target.value)}
          placeholder="web-search, database, llm-orchestration"
          className={inputClass}
        />
      </div>

      {/* Triggers */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <h2 className={sectionHeader + ' mb-0'}>Triggers</h2>
          <button
            type="button"
            onClick={addTrigger}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs font-medium transition-colors border border-slate-700"
          >
            + Add Trigger
          </button>
        </div>
        {form.triggers.length === 0 && (
          <p className="text-xs text-slate-500">No triggers defined. Click &quot;+ Add Trigger&quot; to add one.</p>
        )}
        <div className="space-y-3">
          {form.triggers.map((trigger, i) => (
            <div key={i} className="bg-slate-800/50 rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Trigger {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeTrigger(i)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500">Type</label>
                  <select
                    value={trigger.type}
                    onChange={(e) => updateTrigger(i, 'type', e.target.value)}
                    className={inputClass}
                  >
                    <option value="manual">Manual</option>
                    <option value="cron">Cron</option>
                    <option value="message">Message</option>
                    <option value="webhook">Webhook</option>
                    <option value="event">Event</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Task</label>
                  <input
                    value={trigger.task ?? ''}
                    onChange={(e) => updateTrigger(i, 'task', e.target.value)}
                    placeholder="default"
                    className={inputClass}
                  />
                </div>
                {trigger.type === 'cron' && (
                  <div>
                    <label className="text-xs text-slate-500">Schedule (cron)</label>
                    <input
                      value={trigger.schedule ?? ''}
                      onChange={(e) => updateTrigger(i, 'schedule', e.target.value)}
                      placeholder="0 */2 * * *"
                      className={inputClass}
                    />
                  </div>
                )}
                {trigger.type === 'message' && (
                  <div>
                    <label className="text-xs text-slate-500">From Agent</label>
                    <input
                      value={trigger.from ?? ''}
                      onChange={(e) => updateTrigger(i, 'from', e.target.value)}
                      placeholder="atlas"
                      className={inputClass}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Behavioral Bounds */}
      <div className={card}>
        <h2 className={sectionHeader}>Behavioral Bounds</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Allowed Actions (comma-separated)</label>
            <input
              value={form.allowedActions}
              onChange={(e) => set('allowedActions', e.target.value)}
              placeholder="read_data, write_draft"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Forbidden Actions (comma-separated)</label>
            <input
              value={form.forbiddenActions}
              onChange={(e) => set('forbiddenActions', e.target.value)}
              placeholder="delete_data, modify_billing"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Max Cost Per Session</label>
            <input
              value={form.maxCostPerSession}
              onChange={(e) => set('maxCostPerSession', e.target.value)}
              placeholder="$2.00"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Requires Approval (comma-separated)</label>
            <input
              value={form.requiresApproval}
              onChange={(e) => set('requiresApproval', e.target.value)}
              placeholder="publish_content, send_client_email"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Charter */}
      <div className={card}>
        <h2 className={sectionHeader}>Charter</h2>
        <textarea
          value={form.charter}
          onChange={(e) => set('charter', e.target.value)}
          placeholder={"# Agent Name — Role\n\nYou are Agent Name, the ...\n\n## Goals\n- ...\n\n## Guidelines\n- ..."}
          rows={10}
          className={`${inputClass} resize-y font-mono`}
        />
      </div>

      {/* KPIs */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <h2 className={sectionHeader + ' mb-0'}>KPIs</h2>
          <button
            type="button"
            onClick={addKPI}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs font-medium transition-colors border border-slate-700"
          >
            + Add KPI
          </button>
        </div>
        {form.kpis.length === 0 && (
          <p className="text-xs text-slate-500">No KPIs defined. Click &quot;+ Add KPI&quot; to add one.</p>
        )}
        <div className="space-y-3">
          {form.kpis.map((kpi, i) => (
            <div key={i} className="bg-slate-800/50 rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">KPI {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeKPI(i)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-slate-500">Metric</label>
                  <input
                    value={kpi.metric}
                    onChange={(e) => updateKPI(i, 'metric', e.target.value)}
                    placeholder="response_time"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Target</label>
                  <input
                    value={kpi.target}
                    onChange={(e) => updateKPI(i, 'target', e.target.value)}
                    placeholder="< 5 minutes"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Review</label>
                  <select
                    value={kpi.review}
                    onChange={(e) => updateKPI(i, 'review', e.target.value)}
                    className={inputClass}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
