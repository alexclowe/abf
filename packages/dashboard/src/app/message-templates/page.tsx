'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import type { MessageTemplateConfig } from '@/lib/types';

interface TemplateForm {
  name: string;
  description: string;
  channel: string;
  subject: string;
  body: string;
  variables: string;
}

const EMPTY_FORM: TemplateForm = {
  name: '',
  description: '',
  channel: 'email',
  subject: '',
  body: '',
  variables: '',
};

const CHANNELS = ['email', 'slack', 'discord', 'webhook'];

function TemplateFormPanel({
  form,
  onChange,
  onSubmit,
  onCancel,
  isEdit,
  saving,
}: {
  form: TemplateForm;
  onChange: (form: TemplateForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isEdit: boolean;
  saving: boolean;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-slate-400">{isEdit ? 'Edit Template' : 'New Template'}</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-white transition-colors" aria-label="Close form">
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
            placeholder="welcome-email"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Channel</label>
          <select
            value={form.channel}
            onChange={(e) => onChange({ ...form, channel: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
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

      {form.channel === 'email' && (
        <div>
          <label className="text-sm text-slate-400 block mb-1">Subject</label>
          <input
            value={form.subject}
            onChange={(e) => onChange({ ...form, subject: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            placeholder="Email subject line with {{variable}} placeholders"
          />
        </div>
      )}

      <div>
        <label className="text-sm text-slate-400 block mb-1">Body</label>
        <textarea
          value={form.body}
          onChange={(e) => onChange({ ...form, body: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-none font-mono"
          rows={6}
          placeholder={"Use {{variable}} syntax for dynamic content.\nExample: Hello {{name}}, welcome to {{company}}!"}
        />
      </div>

      <div>
        <label className="text-sm text-slate-400 block mb-1">Variables (comma-separated)</label>
        <input
          value={form.variables}
          onChange={(e) => onChange({ ...form, variables: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          placeholder="name, company, date"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={saving || !form.name || !form.body}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
        >
          {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  );
}

export default function MessageTemplatesPage() {
  const { data: templates, error, mutate } = useSWR('message-templates', () => api.messageTemplates.list(), {
    refreshInterval: 10000,
  });

  const [showForm, setShowForm] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingName(null);
    setShowForm(true);
    setActionError(null);
  }

  function startEdit(template: MessageTemplateConfig) {
    setForm({
      name: template.name,
      description: template.description ?? '',
      channel: template.channel,
      subject: template.subject ?? '',
      body: template.body,
      variables: template.variables.join(', '),
    });
    setEditingName(template.name);
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
        channel: form.channel,
        body: form.body,
        variables: form.variables
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      };
      if (form.description) body.description = form.description;
      if (form.subject && form.channel === 'email') body.subject = form.subject;

      if (editingName) {
        await api.messageTemplates.update(editingName, body);
      } else {
        await api.messageTemplates.create(body);
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
      await api.messageTemplates.delete(name);
      mutate();
    } catch (e) {
      setActionError(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function channelBadge(channel: string) {
    const colors: Record<string, string> = {
      email: 'bg-blue-500/10 text-blue-400',
      slack: 'bg-purple-500/10 text-purple-400',
      discord: 'bg-indigo-500/10 text-indigo-400',
      webhook: 'bg-amber-500/10 text-amber-400',
    };
    return colors[channel] ?? 'bg-slate-700 text-slate-300';
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Message Templates</h1>
        <button
          onClick={startCreate}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={14} />
          New Template
        </button>
      </div>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load templates: {error.message}
        </div>
      )}

      {actionError && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      {showForm && (
        <TemplateFormPanel
          form={form}
          onChange={setForm}
          onSubmit={handleSubmit}
          onCancel={cancelForm}
          isEdit={!!editingName}
          saving={saving}
        />
      )}

      {templates && templates.length === 0 && !showForm && (
        <div className="text-center py-12 text-slate-400">
          No message templates configured. Click &quot;New Template&quot; to create one.
        </div>
      )}

      {templates && templates.length > 0 && (
        <div className="space-y-3">
          {templates.map((template) => (
            <div key={template.name} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">{template.name}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${channelBadge(template.channel)}`}>
                    {template.channel}
                  </span>
                </div>
                <div className="flex gap-1">
                  {deleting === template.name ? (
                    <>
                      <button
                        onClick={() => handleDelete(template.name)}
                        className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs transition-colors"
                      >
                        Confirm Delete
                      </button>
                      <button
                        onClick={() => setDeleting(null)}
                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(template)}
                        className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition-colors"
                        aria-label={`Edit ${template.name}`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setDeleting(template.name)}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        aria-label={`Delete ${template.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {template.description && (
                <p className="text-sm text-slate-400 mb-2">{template.description}</p>
              )}

              {template.subject && (
                <div className="text-sm mb-1">
                  <span className="text-slate-500">Subject: </span>
                  <span className="text-slate-300">{template.subject}</span>
                </div>
              )}

              <div className="bg-slate-800 rounded-md p-3 mt-2">
                <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono">{template.body}</pre>
              </div>

              {template.variables.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-slate-500">Variables:</span>
                  <div className="flex flex-wrap gap-1">
                    {template.variables.map((v) => (
                      <span key={v} className="text-xs bg-slate-800 text-sky-400 px-2 py-0.5 rounded font-mono">
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
