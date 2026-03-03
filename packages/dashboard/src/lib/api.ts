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
  CompanyPlan,
  InterviewStep,
  InterviewSession,
  SeedUploadResponse,
  SeedApplyResponse,
  SeedInterviewStartResponse,
} from './types';

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? '';

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
  if (!res.ok) {
    const errBody = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(errBody?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
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
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; agent: { id: string; name: string; displayName: string } }>('/api/agents', body),
    update: (id: string, body: Record<string, unknown>) =>
      put<{ success: boolean }>(`/api/agents/${id}`, body),
    delete: (id: string) => del<{ success: boolean }>(`/api/agents/${id}`),
    sessions: (id: string) => get<SessionResult[]>(`/api/agents/${id}/sessions`),
    generateCharter: (body: { name: string; role: string; description?: string; tools?: string }) =>
      post<{ charter: string }>('/api/agents/generate-charter', body),
  },

  sessions: {
    active: () => get<WorkSession[]>('/api/sessions'),
    get: (id: string) => get<SessionResult>(`/api/sessions/${id}`),
  },

  teams: {
    list: () => get<TeamConfig[]>('/api/teams'),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; team: TeamConfig }>('/api/teams', body),
    update: (id: string, body: Record<string, unknown>) =>
      put<{ success: boolean }>(`/api/teams/${id}`, body),
    delete: (id: string) => del<{ success: boolean }>(`/api/teams/${id}`),
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
    approve: (id: string, permanent?: boolean) =>
      post<{ approved: boolean; persisted?: boolean }>(`/api/approvals/${id}/approve`, permanent ? { permanent: true } : undefined),
    reject: (id: string) => post<{ rejected: boolean }>(`/api/approvals/${id}/reject`),
    answer: (id: string, answer: string) => post<{ answered: boolean }>(`/api/approvals/${id}/answer`, { answer }),
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

  seed: {
    upload: (body: { text?: string; format?: string }) =>
      post<SeedUploadResponse>('/api/seed/upload', body),
    analyze: (body: { seedText: string; provider?: string; model?: string }) =>
      post<CompanyPlan>('/api/seed/analyze', body),
    apply: (body: { plan: CompanyPlan; provider?: string; model?: string }) =>
      post<SeedApplyResponse>('/api/seed/apply', body),
    interviewStart: (body: { companyType: 'new' | 'existing'; provider?: string; model?: string }) =>
      post<SeedInterviewStartResponse>('/api/seed/interview/start', body),
    interviewRespond: (sessionId: string, answer: string) =>
      post<InterviewStep>(`/api/seed/interview/${sessionId}/respond`, { answer }),
    interviewGet: (sessionId: string) =>
      get<InterviewSession>(`/api/seed/interview/${sessionId}`),
    reanalyze: (body: { originalSeedText: string; updatedSeedText: string; currentPlan: CompanyPlan; provider?: string; model?: string }) =>
      post<CompanyPlan>('/api/seed/reanalyze', body),
  },

  kpis: {
    list: (agentId?: string) => {
      const qs = agentId ? `?agentId=${agentId}` : '';
      return get<import('./types').KPIReport[]>(`/api/kpis${qs}`);
    },
  },

  knowledge: {
    list: () => get<import('./types').KnowledgeFile[]>('/api/knowledge'),
    get: (filename: string) => get<{ filename: string; content: string }>(`/api/knowledge/${filename}`),
    create: (body: { filename: string; content: string }) =>
      post<{ success: boolean; filename: string }>('/api/knowledge', body),
    update: (filename: string, content: string) =>
      put<{ success: boolean }>(`/api/knowledge/${filename}`, { content }),
    delete: (filename: string) => del<{ success: boolean }>(`/api/knowledge/${filename}`),
  },

  monitors: {
    list: () => get<import('./types').MonitorConfig[]>('/api/monitors'),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; name: string }>('/api/monitors', body),
    update: (name: string, body: Record<string, unknown>) =>
      put<{ success: boolean }>(`/api/monitors/${name}`, body),
    delete: (name: string) => del<{ success: boolean }>(`/api/monitors/${name}`),
  },

  messageTemplates: {
    list: () => get<import('./types').MessageTemplateConfig[]>('/api/message-templates'),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; name: string }>('/api/message-templates', body),
    update: (name: string, body: Record<string, unknown>) =>
      put<{ success: boolean }>(`/api/message-templates/${name}`, body),
    delete: (name: string) => del<{ success: boolean }>(`/api/message-templates/${name}`),
  },

  config: {
    get: () => get<Record<string, unknown>>('/api/config'),
    update: (body: Record<string, unknown>) =>
      put<{ success: boolean }>('/api/config', body),
  },

  notifications: {
    getConfig: () => get<{
      onApproval: boolean;
      onAlert: boolean;
      channel: string;
      configured: boolean;
      maskedCredential: string;
    }>('/api/notifications/config'),
    updateConfig: (body: {
      onApproval?: boolean;
      onAlert?: boolean;
      channel?: string;
      credential?: string;
      telegramBotToken?: string;
      telegramChatId?: string;
    }) => put<{ success: boolean }>('/api/notifications/config', body),
  },

  alerts: {
    list: () => get<EscalationItem[]>('/api/alerts'),
    resolve: (id: string) => post<{ resolved: boolean }>(`/api/alerts/${id}/resolve`),
  },

  mail: {
    list: (agent?: string, limit?: number) => {
      const qs = new URLSearchParams();
      if (agent) qs.set('agent', agent);
      if (limit) qs.set('limit', String(limit));
      return get<import('./types').MailMessage[]>(`/api/mail?${qs}`);
    },
    inbox: (agentName: string, opts?: { unread?: boolean; limit?: number }) => {
      const qs = new URLSearchParams();
      if (opts?.unread) qs.set('unread', 'true');
      if (opts?.limit) qs.set('limit', String(opts.limit));
      return get<import('./types').MailMessage[]>(`/api/mail/${agentName}?${qs}`);
    },
    sent: (agentName: string, limit?: number) => {
      const qs = limit ? `?limit=${limit}` : '';
      return get<import('./types').MailMessage[]>(`/api/mail/${agentName}/sent${qs}`);
    },
    get: (messageId: string) =>
      get<import('./types').MailMessage>(`/api/mail/message/${messageId}`),
    thread: (threadId: string) =>
      get<import('./types').MailMessage[]>(`/api/mail/thread/${threadId}`),
    send: (agentName: string, body: { subject: string; body: string; from?: string }) =>
      post<import('./types').MailMessage>(`/api/mail/${agentName}`, body),
    markAllRead: (agentName: string) =>
      post<{ markedRead: number }>(`/api/mail/${agentName}/read`),
  },

  workflows: {
    list: () => get<import('./types').WorkflowDefinition[]>('/api/workflows'),
    get: (name: string) => get<import('./types').WorkflowDefinition>(`/api/workflows/${name}`),
    run: (name: string, input?: Record<string, unknown>) =>
      post<{ runId: string }>(`/api/workflows/${name}/run`, { input }),
    getRun: (runId: string) => get<import('./types').WorkflowRun>(`/api/workflows/runs/${runId}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; name: string }>('/api/workflows', body),
    update: (name: string, body: Record<string, unknown>) =>
      put<{ success: boolean }>(`/api/workflows/${name}`, body),
    delete: (name: string) => del<{ success: boolean }>(`/api/workflows/${name}`),
  },
};
