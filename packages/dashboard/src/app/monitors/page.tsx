'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import type { MonitorConfig } from '@/lib/types';

interface MonitorForm {
  name: string;
  description: string;
  url: string;
  interval: string;
  agent: string;
  task: string;
  method: string;
}

const EMPTY_FORM: MonitorForm = {
  name: '',
  description: '',
  url: '',
  interval: '5m',
  agent: '',
  task: '',
  method: 'GET',
};

const INTERVALS = ['30s', '1m', '5m', '15m', '1h'];

function MonitorFormPanel({
  form,
  onChange,
  onSubmit,
  onCancel,
  isEdit,
  saving,
}: {
  form: MonitorForm;
  onChange: (form: MonitorForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isEdit: boolean;
  saving: boolean;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-slate-400">{isEdit ? 'Edit Monitor' : 'New Monitor'}</h3>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-white transition-colors" aria-label="Close form">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Name</label>
          <input
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            disabled={isEdit}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="my-monitor"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Description</label>
          <input
            value={form.description}
            onChange={(e) => onChange({ ...form, description: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            placeholder="Optional description"
          />
        </div>
      </div>

      <div>
        <label className="text-sm text-slate-400 block mb-1">URL</label>
        <input
          value={form.url}
          onChange={(e) => onChange({ ...form, url: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          placeholder="https://example.com/page"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Interval</label>
          <select
            value={form.interval}
            onChange={(e) => onChange({ ...form, interval: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          >
            {INTERVALS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Method</label>
          <select
            value={form.method}
            onChange={(e) => onChange({ ...form, method: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Agent</label>
          <input
            value={form.agent}
            onChange={(e) => onChange({ ...form, agent: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            placeholder="agent-name"
          />
        </div>
      </div>

      <div>
        <label className="text-sm text-slate-400 block mb-1">Task</label>
        <input
          value={form.task}
          onChange={(e) => onChange({ ...form, task: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          placeholder="Task to trigger on content change"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving || !form.name || !form.url || !form.agent || !form.task}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
        >
          {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  );
}

export default function MonitorsPage() {
  const { data: monitors, error, mutate } = useSWR('monitors', () => api.monitors.list(), {
    refreshInterval: 10000,
  });

  const [showForm, setShowForm] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState<MonitorForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingName(null);
    setShowForm(true);
    setActionError(null);
  }

  function startEdit(monitor: MonitorConfig) {
    setForm({
      name: monitor.name,
      description: monitor.description ?? '',
      url: monitor.url,
      interval: monitor.interval,
      agent: monitor.agent,
      task: monitor.task,
      method: monitor.method ?? 'GET',
    });
    setEditingName(monitor.name);
    setShowForm(true);
    setActionError(null);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingName(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit() {
    setSaving(true);
    setActionError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        url: form.url,
        interval: form.interval,
        agent: form.agent,
        task: form.task,
        method: form.method,
      };
      if (form.description) body.description = form.description;

      if (editingName) {
        await api.monitors.update(editingName, body);
      } else {
        await api.monitors.create(body);
      }
      cancelForm();
      mutate();
    } catch (e) {
      setActionError(`Failed to ${editingName ? 'update' : 'create'}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name: string) {
    setDeleting(null);
    setActionError(null);
    try {
      await api.monitors.delete(name);
      mutate();
    } catch (e) {
      setActionError(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Monitors</h1>
        <button
          type="button"
          onClick={startCreate}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={14} />
          New Monitor
        </button>
      </div>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load monitors: {error.message}
        </div>
      )}

      {actionError && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      {showForm && (
        <MonitorFormPanel
          form={form}
          onChange={setForm}
          onSubmit={handleSubmit}
          onCancel={cancelForm}
          isEdit={!!editingName}
          saving={saving}
        />
      )}

      {monitors && monitors.length === 0 && !showForm && (
        <div className="text-center py-12 text-slate-400">
          No monitors configured. Click &quot;New Monitor&quot; to start watching a URL.
        </div>
      )}

      {monitors && monitors.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Name</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase hidden sm:table-cell">URL</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Interval</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase hidden md:table-cell">Agent</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase hidden lg:table-cell">Task</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((monitor) => (
                <tr key={monitor.name} className="border-b border-slate-800 last:border-b-0">
                  <td className="px-4 py-3 text-sm font-medium">{monitor.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-400 max-w-[200px] truncate hidden sm:table-cell" title={monitor.url}>
                    {monitor.url}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="px-2 py-0.5 bg-slate-800 rounded text-xs font-mono">{monitor.interval}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-sky-400 hidden md:table-cell">{monitor.agent}</td>
                  <td className="px-4 py-3 text-sm text-slate-400 max-w-[150px] truncate hidden lg:table-cell" title={monitor.task}>
                    {monitor.task}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {deleting === monitor.name ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(monitor.name)}
                          className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(null)}
                          className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(monitor)}
                          className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition-colors"
                          aria-label={`Edit ${monitor.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(monitor.name)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                          aria-label={`Delete ${monitor.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
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
