'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import type { ProviderAuthConfig, ProviderAuthStatus } from '@/lib/types';
import { KeyRound, ExternalLink, Check, X, Loader2, Cpu, Trash2 } from 'lucide-react';

// ── Connect Modal ───────────────────────────────────────────────────

function ConnectModal({
  provider,
  onClose,
  onConnected,
}: {
  provider: ProviderAuthConfig;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await api.auth.connectKey(provider.id, key.trim());
      if (result.connected) {
        onConnected();
      } else {
        setError(result.error ?? 'Connection failed');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-xl">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-lg font-semibold">Connect {provider.displayName}</h2>
          <p className="text-sm text-slate-400 mt-1">
            Paste your API key below. It will be validated and stored securely in your local vault.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">API Key</label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={`${provider.keyPrefix}...`}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            {!key.startsWith(provider.keyPrefix) && key.length > 0 && (
              <p className="text-xs text-amber-400 mt-1">
                Key should start with &ldquo;{provider.keyPrefix}&rdquo;
              </p>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <a
              href={provider.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
            >
              Get an API key <ExternalLink size={12} />
            </a>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !key.trim()}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                {loading ? 'Validating...' : 'Connect'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Provider Card ───────────────────────────────────────────────────

function ProviderCard({
  config,
  status,
  onConnect,
  onDisconnect,
}: {
  config: ProviderAuthConfig;
  status?: ProviderAuthStatus;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = status?.connected ?? false;
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  async function handleDisconnect() {
    setDisconnecting(true);
    setDisconnectError('');
    try {
      await api.auth.disconnect(config.id);
      onDisconnect();
    } catch (err) {
      setDisconnectError((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-slate-600'}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{config.displayName}</span>
              {config.optional && (
                <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">optional</span>
              )}
            </div>
            {config.description && (
              <p className="text-xs text-slate-500 mt-0.5">{config.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <span className="text-xs text-green-400 flex items-center gap-1">
                <Check size={12} /> Connected
              </span>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                title="Disconnect"
              >
                <Trash2 size={14} />
              </button>
            </>
          ) : (
            <button
              onClick={onConnect}
              className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-xs font-medium transition-colors"
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {disconnectError && (
        <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to disconnect: {disconnectError}
        </div>
      )}
    </div>
  );
}

// ── Ollama Card ─────────────────────────────────────────────────────

function OllamaCard({ status }: { status?: ProviderAuthStatus }) {
  const detected = status?.connected ?? false;
  const models = status?.models as { name: string }[] | undefined;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${detected ? 'bg-green-400' : 'bg-slate-600'}`} />
          <div>
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-slate-400" />
              <span className="text-sm font-medium">Ollama (Local)</span>
              <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">zero config</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {detected
                ? 'Running locally — no API key needed'
                : 'Not detected. Install from ollama.com and start it.'}
            </p>
          </div>
        </div>

        {detected ? (
          <span className="text-xs text-green-400 flex items-center gap-1">
            <Check size={12} /> Detected
          </span>
        ) : (
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 border border-slate-700 hover:border-slate-600 text-slate-300 rounded-md text-xs font-medium transition-colors flex items-center gap-1"
          >
            Install <ExternalLink size={12} />
          </a>
        )}
      </div>

      {detected && models && models.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <p className="text-xs text-slate-500 mb-2">Available models:</p>
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <span
                key={m.name}
                className="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md"
              >
                {m.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────

export default function ProvidersPage() {
  const { data: configs } = useSWR('auth-providers', () => api.auth.providers(), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const { data: statuses, mutate: mutateStatus } = useSWR(
    'auth-status',
    () => api.auth.status(),
    { refreshInterval: 30_000 },
  );

  const [connectingProvider, setConnectingProvider] = useState<ProviderAuthConfig | null>(null);

  const providerConfigs = configs ?? [];
  const ollamaStatus = statuses?.['ollama'];

  // Count connected providers
  const connectedCount = providerConfigs.filter((p) => statuses?.[p.id]?.connected).length
    + (ollamaStatus?.connected ? 1 : 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <KeyRound size={24} className="text-sky-400" />
            Providers
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Connect at least one LLM provider to power your agents.
            {connectedCount > 0 && (
              <span className="text-green-400 ml-2">{connectedCount} connected</span>
            )}
          </p>
        </div>
      </div>

      {/* API Key Providers */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Cloud Providers</h2>
        {providerConfigs.length === 0 && !statuses && (
          <div className="text-slate-500 text-sm">Loading...</div>
        )}
        {providerConfigs.map((config) => (
          <ProviderCard
            key={config.id}
            config={config}
            status={statuses?.[config.id]}
            onConnect={() => setConnectingProvider(config)}
            onDisconnect={() => mutateStatus()}
          />
        ))}
      </section>

      {/* Ollama */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Local Models</h2>
        <OllamaCard status={ollamaStatus} />
      </section>

      {/* Security note */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-xs text-slate-400 space-y-1">
        <p className="font-medium text-slate-300">How keys are stored</p>
        <p>
          Keys are validated against the provider&apos;s API, then encrypted with AES-256-GCM and stored in your local vault
          (~/.abf/credentials.enc). When available, the encryption key is stored in your OS keychain (macOS Keychain,
          GNOME Keyring, Windows Credential Manager). Keys never leave your machine.
        </p>
      </div>

      {/* Connect Modal */}
      {connectingProvider && (
        <ConnectModal
          provider={connectingProvider}
          onClose={() => setConnectingProvider(null)}
          onConnected={() => {
            setConnectingProvider(null);
            mutateStatus();
          }}
        />
      )}
    </div>
  );
}
