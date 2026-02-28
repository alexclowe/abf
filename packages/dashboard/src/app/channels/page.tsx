'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { MessageSquare, Mail, Hash, Send, Globe } from 'lucide-react';

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? '';

function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  const apiKey = process.env.NEXT_PUBLIC_ABF_API_KEY;
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
  return h;
}

interface ChannelStatus {
  type: string;
  connected: boolean;
  configured: boolean;
}

interface ChannelRoute {
  channel: string;
  agent: string;
  pattern?: string;
  respondInChannel: boolean;
}

async function fetchChannels(): Promise<ChannelStatus[]> {
  const res = await fetch(`${BASE}/api/channels`, { headers: headers() });
  if (!res.ok) return [];
  return res.json();
}

async function fetchRoutes(): Promise<ChannelRoute[]> {
  const res = await fetch(`${BASE}/api/channels/routes`, { headers: headers() });
  if (!res.ok) return [];
  return res.json();
}

const CHANNEL_INFO: Record<string, { label: string; desc: string; icon: typeof MessageSquare; tokenLabel: string; placeholder: string }> = {
  telegram: {
    label: 'Telegram',
    desc: 'Connect a Telegram bot to receive and send messages.',
    icon: Send,
    tokenLabel: 'Bot Token',
    placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
  },
  slack: {
    label: 'Slack',
    desc: 'Connect a Slack bot for bidirectional messaging.',
    icon: Hash,
    tokenLabel: 'Bot Token (xoxb-...)',
    placeholder: 'xoxb-your-slack-bot-token',
  },
  discord: {
    label: 'Discord',
    desc: 'Connect a Discord bot for server messaging.',
    icon: MessageSquare,
    tokenLabel: 'Bot Token',
    placeholder: 'your-discord-bot-token',
  },
  email: {
    label: 'Email',
    desc: 'Send and receive email via SMTP/IMAP.',
    icon: Mail,
    tokenLabel: 'SMTP Password',
    placeholder: 'smtp-password',
  },
};

export default function ChannelsPage() {
  const { data: channels, mutate: reloadChannels } = useSWR('channels', fetchChannels, { refreshInterval: 10_000 });
  const { data: routes } = useSWR('channel-routes', fetchRoutes, { refreshInterval: 10_000 });
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function handleConnect(type: string) {
    if (!token.trim()) return;
    try {
      const res = await fetch(`${BASE}/api/channels/${type}`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus('Connected! Restart runtime to activate.');
        setConfiguring(null);
        setToken('');
        reloadChannels();
      } else {
        setStatus(`Error: ${data.error ?? 'Unknown'}`);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleDisconnect(type: string) {
    try {
      await fetch(`${BASE}/api/channels/${type}`, {
        method: 'DELETE',
        headers: headers(),
      });
      reloadChannels();
      setStatus(`${type} disconnected.`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Channels</h1>
      <p className="text-slate-400 text-sm">Connect messaging platforms for bidirectional agent communication.</p>

      {status && (
        <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-3 text-sky-400 text-sm">
          {status}
        </div>
      )}

      {/* Channel Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(CHANNEL_INFO).map(([type, info]) => {
          const Icon = info.icon;
          const ch = channels?.find((c) => c.type === type);
          const isConnected = ch?.connected ?? false;
          const isConfigured = ch?.configured ?? false;

          return (
            <div key={type} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon size={18} className="text-slate-400" />
                  <h3 className="font-medium">{info.label}</h3>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  isConnected
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : isConfigured
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-slate-700 text-slate-400'
                }`}>
                  {isConnected ? 'Connected' : isConfigured ? 'Configured' : 'Not Connected'}
                </span>
              </div>
              <p className="text-sm text-slate-400 mb-3">{info.desc}</p>

              {configuring === type ? (
                <div className="space-y-2">
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={info.placeholder}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleConnect(type)}
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-xs font-medium transition-colors"
                    >
                      Connect with Token
                    </button>
                    {['slack', 'discord'].includes(type) && (
                      <a
                        href={`${BASE}/auth/oauth/${type}/start`}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs font-medium transition-colors inline-flex items-center"
                      >
                        Connect with OAuth
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => { setConfiguring(null); setToken(''); }}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md text-xs font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  {isConfigured ? (
                    <button
                      type="button"
                      onClick={() => handleDisconnect(type)}
                      className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/20 rounded-md text-xs font-medium transition-colors"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfiguring(type)}
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-xs font-medium transition-colors"
                    >
                      Configure
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Google Workspace Integration */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-slate-400" />
            <h3 className="font-medium">Google Workspace</h3>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            channels?.find((c) => c.type === 'google')?.connected
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-slate-700 text-slate-400'
          }`}>
            {channels?.find((c) => c.type === 'google')?.connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>
        <p className="text-sm text-slate-400 mb-3">
          Connect Google Workspace to give agents access to Gmail, Calendar, Drive, and Sheets through a single OAuth flow.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {['Gmail', 'Calendar', 'Drive', 'Sheets'].map((svc) => (
            <span key={svc} className="text-xs px-2 py-0.5 bg-slate-800 text-slate-400 rounded">
              {svc}
            </span>
          ))}
        </div>
        {channels?.find((c) => c.type === 'google')?.connected ? (
          <button
            type="button"
            onClick={() => handleDisconnect('google')}
            className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/20 rounded-md text-xs font-medium transition-colors"
          >
            Disconnect Google
          </button>
        ) : (
          <a
            href={`${BASE}/auth/oauth/google/start`}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1"
          >
            <Globe size={14} />
            Connect with Google
          </a>
        )}
      </div>

      {/* Routing Rules */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-400 mb-3">Routing Rules</h3>
        {routes && routes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="pb-2 font-medium">Channel</th>
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium">Pattern</th>
                  <th className="pb-2 font-medium">Reply</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((route, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="py-2 capitalize">{route.channel}</td>
                    <td className="py-2 font-mono">{route.agent}</td>
                    <td className="py-2 text-slate-400">{route.pattern ?? '*'}</td>
                    <td className="py-2">{route.respondInChannel ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No routing rules configured. Routes determine which agent handles messages from each channel.
          </p>
        )}
      </div>
    </div>
  );
}
