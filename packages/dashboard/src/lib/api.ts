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
} from './types';

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? 'http://localhost:3000';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

  providers: {
    list: () => get<ProviderStatus[]>('/api/providers'),
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
