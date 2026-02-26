import type {
  StatusResponse,
  AgentListItem,
  AgentDetail,
  AgentMemoryContext,
  AgentConfig,
  WorkSession,
  SessionResult,
  TeamConfig,
  BusMessage,
  AuditEntry,
  EscalationItem,
  ProviderStatus,
  ProviderAuthConfig,
  ProviderAuthStatus,
  OllamaDetectResponse,
  ConnectKeyResponse,
} from './types';

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? 'http://localhost:3000';

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  const apiKey = process.env.NEXT_PUBLIC_ABF_API_KEY;
  if (apiKey) {
    h['Authorization'] = `Bearer ${apiKey}`;
  }
  return h;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store', headers: headers() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  status: () => get<StatusResponse>('/api/status'),
  health: () => get<{ status: string; agents: number; activeSessions: number; uptime: number }>('/health'),

  agents: {
    list: () => get<AgentListItem[]>('/api/agents'),
    get: (id: string) => get<AgentDetail>(`/api/agents/${id}`),
    memory: (id: string) => get<AgentMemoryContext>(`/api/agents/${id}/memory`),
    run: (id: string, task: string, payload?: Record<string, unknown>) =>
      post<{ sessionId: string }>(`/api/agents/${id}/run`, { task, payload }),
  },

  sessions: {
    active: () => get<WorkSession[]>('/api/sessions'),
    get: (id: string) => get<SessionResult>(`/api/sessions/${id}`),
  },

  teams: {
    list: () => get<TeamConfig[]>('/api/teams'),
  },

  messages: {
    get: (agentId: string) =>
      get<{ pending: BusMessage[]; history: BusMessage[] }>(`/api/messages/${agentId}`),
  },

  audit: {
    query: (params?: { agentId?: string; since?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.agentId) qs.set('agentId', params.agentId);
      if (params?.since) qs.set('since', params.since);
      if (params?.limit) qs.set('limit', String(params.limit));
      return get<AuditEntry[]>(`/api/audit?${qs}`);
    },
  },

  escalations: {
    list: () => get<EscalationItem[]>('/api/escalations'),
    resolve: (id: string) => post<{ resolved: boolean }>(`/api/escalations/${id}/resolve`),
  },

  approvals: {
    list: (status?: string, agentId?: string) => {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (agentId) qs.set('agentId', agentId);
      return get<import('./types').ApprovalItem[]>(`/api/approvals?${qs}`);
    },
    get: (id: string) => get<import('./types').ApprovalItem>(`/api/approvals/${id}`),
    approve: (id: string) => post<{ approved: boolean }>(`/api/approvals/${id}/approve`),
    reject: (id: string) => post<{ rejected: boolean }>(`/api/approvals/${id}/reject`),
  },

  providers: {
    list: () => get<ProviderStatus[]>('/api/providers'),
  },

  auth: {
    /** List available provider configs (display names, key prefixes, deep links) */
    providers: () => get<ProviderAuthConfig[]>('/auth/providers'),
    /** Connection status for all providers including Ollama */
    status: () => get<Record<string, ProviderAuthStatus>>('/auth/status'),
    /** Validate and store an API key */
    connectKey: (provider: string, key: string) =>
      post<ConnectKeyResponse>(`/auth/key/${provider}`, { key }),
    /** Remove a provider's stored key */
    disconnect: (provider: string) =>
      del<{ disconnected: boolean }>(`/auth/${provider}`),
    /** Dedicated Ollama probe with model details */
    ollamaDetect: () => get<OllamaDetectResponse>('/auth/ollama/detect'),
  },

  metrics: {
    runtime: () => get<Record<string, unknown>>('/api/metrics/runtime'),
    agents: () => get<Record<string, unknown>[]>('/api/metrics/agents'),
    kpis: (agentId?: string) => {
      const qs = agentId ? `?agentId=${agentId}` : '';
      return get<Record<string, unknown>[]>(`/api/metrics/kpis${qs}`);
    },
  },

  archetypes: {
    list: () =>
      get<
        {
          name: string;
          temperature: number;
          tools: string[];
          allowedActions: string[];
          forbiddenActions: string[];
        }[]
      >('/api/archetypes'),
  },

  inbox: {
    peek: (agentId: string) =>
      get<import('./types').InboxItem[]>(`/api/agents/${agentId}/inbox`),
    push: (agentId: string, body: { subject: string; body: string; priority?: string; from?: string }) =>
      post<{ id: string; queued: boolean }>(`/api/agents/${agentId}/inbox`, body),
  },

  projects: {
    create: (body: { template: string; projectName: string; provider: string; apiKey?: string }) =>
      post<{ success: boolean; agents: AgentConfig[] }>('/api/projects', body),
  },

  kpis: {
    list: (agentId?: string) => {
      const qs = agentId ? `?agentId=${agentId}` : '';
      return get<import('./types').KPIReport[]>(`/api/kpis${qs}`);
    },
  },

  workflows: {
    list: () => get<import('./types').WorkflowDefinition[]>('/api/workflows'),
    get: (name: string) => get<import('./types').WorkflowDefinition>(`/api/workflows/${name}`),
    run: (name: string, input?: Record<string, unknown>) =>
      post<{ runId: string }>(`/api/workflows/${name}/run`, { input }),
    getRun: (runId: string) => get<import('./types').WorkflowRun>(`/api/workflows/runs/${runId}`),
  },
};
