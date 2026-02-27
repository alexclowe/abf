'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { Save } from 'lucide-react';

interface ConfigState {
  name: string;
  version: string;
  storage_backend: string;
  storage_connection_string: string;
  bus_backend: string;
  bus_url: string;
  gateway_host: string;
  gateway_port: number;
  max_concurrent_sessions: number;
  session_timeout_ms: number;
}

function extractConfig(raw: Record<string, unknown>): ConfigState {
  const storage = (raw.storage ?? raw.datastore ?? {}) as Record<string, unknown>;
  const bus = (raw.bus ?? raw.message_bus ?? {}) as Record<string, unknown>;
  const gateway = (raw.gateway ?? {}) as Record<string, unknown>;
  const runtime = (raw.runtime ?? {}) as Record<string, unknown>;

  return {
    name: (raw.name as string) ?? '',
    version: (raw.version as string) ?? '',
    storage_backend: (storage.backend as string) ?? 'filesystem',
    storage_connection_string: (storage.connection_string as string) ?? '',
    bus_backend: (bus.backend as string) ?? 'in-process',
    bus_url: (bus.url as string) ?? (bus.redis_url as string) ?? '',
    gateway_host: (gateway.host as string) ?? '0.0.0.0',
    gateway_port: (gateway.port as number) ?? 3000,
    max_concurrent_sessions: (runtime.maxConcurrentSessions as number) ?? (runtime.max_concurrent_sessions as number) ?? 5,
    session_timeout_ms: (runtime.sessionTimeoutMs as number) ?? (runtime.session_timeout_ms as number) ?? 300000,
  };
}

export default function SettingsPage() {
  const { data: rawConfig, error, mutate } = useSWR('config', () => api.config.get(), {
    revalidateOnFocus: false,
  });

  const [config, setConfig] = useState<ConfigState | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (rawConfig && !config) {
      setConfig(extractConfig(rawConfig));
    }
  }, [rawConfig, config]);

  function update(field: keyof ConfigState, value: string | number) {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  }

  async function handleSave() {
    if (!config || !rawConfig) return;
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const body = {
        ...rawConfig,
        name: config.name,
        storage: {
          backend: config.storage_backend,
          ...(config.storage_backend === 'postgres' ? { connection_string: config.storage_connection_string } : {}),
        },
        bus: {
          backend: config.bus_backend,
          ...(config.bus_backend === 'redis' ? { url: config.bus_url } : {}),
        },
        gateway: {
          host: config.gateway_host,
          port: config.gateway_port,
        },
        runtime: {
          maxConcurrentSessions: config.max_concurrent_sessions,
          sessionTimeoutMs: config.session_timeout_ms,
        },
      };
      await api.config.update(body);
      setActionSuccess('Settings saved. Some changes may require a restart.');
      mutate();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (e) {
      setActionError(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load config: {error.message}
        </div>
      </div>
    );
  }

  if (!config) {
    return <div className="p-6 text-slate-400 text-sm">Loading...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Save size={14} />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {actionError && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      {actionSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-green-400 text-sm">
          {actionSuccess}
        </div>
      )}

      {/* General */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-400 mb-2">General</h2>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Project Name</label>
          <input
            value={config.name}
            onChange={(e) => update('name', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Version</label>
          <input
            value={config.version}
            readOnly
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
          />
        </div>
      </div>

      {/* Storage */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Storage</h2>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Backend</label>
          <select
            value={config.storage_backend}
            onChange={(e) => update('storage_backend', e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          >
            <option value="filesystem">Filesystem</option>
            <option value="postgres">PostgreSQL</option>
          </select>
        </div>
        {config.storage_backend === 'postgres' && (
          <div>
            <label className="text-sm text-slate-400 block mb-1">Connection String</label>
            <input
              value={config.storage_connection_string}
              onChange={(e) => update('storage_connection_string', e.target.value)}
              placeholder="postgresql://user:pass@host:5432/dbname"
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
        )}
      </div>

      {/* Message Bus */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Message Bus</h2>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Backend</label>
          <select
            value={config.bus_backend}
            onChange={(e) => update('bus_backend', e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
          >
            <option value="in-process">In-Process</option>
            <option value="redis">Redis / BullMQ</option>
          </select>
        </div>
        {config.bus_backend === 'redis' && (
          <div>
            <label className="text-sm text-slate-400 block mb-1">Redis URL</label>
            <input
              value={config.bus_url}
              onChange={(e) => update('bus_url', e.target.value)}
              placeholder="redis://localhost:6379"
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
        )}
      </div>

      {/* Gateway */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Gateway</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-400 block mb-1">Host</label>
            <input
              value={config.gateway_host}
              onChange={(e) => update('gateway_host', e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 block mb-1">Port</label>
            <input
              type="number"
              value={config.gateway_port}
              onChange={(e) => update('gateway_port', Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>
      </div>

      {/* Runtime */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Runtime</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-400 block mb-1">Max Concurrent Sessions</label>
            <input
              type="number"
              value={config.max_concurrent_sessions}
              onChange={(e) => update('max_concurrent_sessions', Number(e.target.value))}
              min={1}
              max={50}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 block mb-1">Session Timeout (ms)</label>
            <input
              type="number"
              value={config.session_timeout_ms}
              onChange={(e) => update('session_timeout_ms', Number(e.target.value))}
              min={10000}
              step={10000}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              {config.session_timeout_ms >= 60000
                ? `${(config.session_timeout_ms / 60000).toFixed(0)} minute${config.session_timeout_ms >= 120000 ? 's' : ''}`
                : `${(config.session_timeout_ms / 1000).toFixed(0)} seconds`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
