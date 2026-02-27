// All types that mirror the ABF Gateway API responses.
// Do NOT import from @abf/core — these are independent definitions.

export type AgentStatus = 'idle' | 'active' | 'waiting' | 'error' | 'disabled';

export interface AgentState {
  id: string;
  status: AgentStatus;
  lastActive?: string;
  currentSessionCost: number;
  totalCost: number;
  sessionsCompleted: number;
  errorCount: number;
}

export interface BehavioralBounds {
  allowedActions: string[];
  forbiddenActions: string[];
  maxCostPerSession: number;
  requires_approval: string[];
}

export interface TriggerConfig {
  type: 'cron' | 'manual' | 'message' | 'webhook' | 'event';
  schedule?: string;
  task?: string;
  from?: string;
}

export interface KPIDefinition {
  metric: string;
  target: string;
  review: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  displayName: string;
  role: string;
  description: string;
  provider: string;
  model: string;
  temperature?: number;
  team?: string;
  reportsTo?: string;
  tools: string[];
  triggers: TriggerConfig[];
  behavioralBounds: BehavioralBounds;
  kpis: KPIDefinition[];
  charter: string;
}

export interface AgentListItem {
  config: AgentConfig;
  state?: AgentState;
}

export interface AgentDetail {
  config: AgentConfig;
  state?: AgentState;
  memory?: AgentMemoryContext;
}

export interface AgentMemoryContext {
  charter: string;
  history: MemoryEntry[];
  decisions: MemoryEntry[];
  knowledge: Record<string, string>;
  pendingMessages: number;
}

export interface MemoryEntry {
  layer: string;
  content: string;
  timestamp: string;
  checksum: string;
}

export interface ToolCall {
  toolId: string;
  arguments: Record<string, unknown>;
  agentId: string;
  timestamp: string;
}

export interface ToolResult {
  toolId: string;
  success: boolean;
  output: unknown;
  error?: string;
  cost?: number;
  durationMs: number;
}

export interface SessionResult {
  sessionId: string;
  agentId: string;
  status: 'completed' | 'failed' | 'timeout' | 'escalated';
  startedAt: string;
  completedAt: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost: number;
  error?: string;
}

export interface WorkSession {
  sessionId: string;
  agentId: string;
  startedAt: string;
}

export interface TeamConfig {
  id: string;
  name: string;
  displayName: string;
  description: string;
  orchestrator: string;
  members: string[];
}

export interface BusMessage {
  id: string;
  from: string;
  to: string;
  type: 'REQUEST' | 'RESPONSE' | 'ALERT' | 'ESCALATION' | 'STATUS' | 'BROADCAST';
  priority: 'low' | 'normal' | 'high' | 'critical';
  context: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface AuditEntry {
  timestamp: string;
  eventType: string;
  agentId: string;
  sessionId?: string;
  details: Record<string, unknown>;
  severity: 'info' | 'warn' | 'error' | 'security';
}

export interface EscalationItem {
  id: string;
  agentId: string;
  sessionId: string;
  type: string;
  message: string;
  target: string;
  timestamp: string;
  resolved: boolean;
}

// ── Approvals ───────────────────────────────────────────────────────

export interface ApprovalItem {
  id: string;
  agentId: string;
  sessionId: string;
  toolId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  resolvedAt?: string;
  resolvedBy?: string;
}

// ── Inbox ───────────────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  agentId: string;
  source: 'human' | 'webhook' | 'bus' | 'agent';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  subject: string;
  body: string;
  from?: string;
  createdAt: string;
  consumed: boolean;
}

export interface StatusResponse {
  version: string;
  uptime: number;
  name: string;
  agents: number;
  activeSessions: number;
  configured: boolean;
}

// ── Auth / Providers ──────────────────────────────────────────────────

export interface ProviderAuthConfig {
  id: string;
  displayName: string;
  keyPrefix: string;
  deepLink: string;
  optional: boolean;
  description?: string;
}

export interface ProviderAuthStatus {
  connected: boolean;
  optional?: boolean;
  description?: string;
  local?: boolean;
  models?: string[];
}

export interface OllamaDetectResponse {
  detected: boolean;
  models?: { name: string; size: number }[];
  baseUrl?: string;
}

export interface ConnectKeyResponse {
  connected: boolean;
  error?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
}

export interface ProviderStatus {
  id: string;
  name: string;
  slug: string;
  authType: string;
  models: ModelInfo[];
}

// ── KPI Reports ────────────────────────────────────────────────────────

export interface KPIReport {
  metric: string;
  value: string;
  target: string;
  met: boolean;
  timestamp: string;
}

// ── Workflows ──────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  agent: string;
  task: string;
  dependsOn?: string[];
  parallel?: boolean;
}

export interface WorkflowDefinition {
  name: string;
  displayName: string;
  description?: string;
  steps: WorkflowStep[];
  timeout?: number;
  onFailure: string;
}

export interface WorkflowStepResult {
  stepId: string;
  agentName: string;
  sessionId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowRun {
  id: string;
  workflowName: string;
  status: string;
  input: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  steps: WorkflowStepResult[];
}

// ── Seed-to-Company Types ──────────────────────────────────────────────
// Mirror of core/src/seed/types.ts — independent definitions for the dashboard.

export interface CompanyInfo {
  name: string;
  description: string;
  mission?: string;
  targetCustomer?: string;
  revenueModel?: string;
  industry?: string;
  stage?: 'idea' | 'pre-launch' | 'launched' | 'growing' | 'established';
}

export interface TriggerPlan {
  type: 'cron' | 'manual' | 'message' | 'webhook' | 'event' | 'heartbeat';
  schedule?: string;
  interval?: number;
  task: string;
  from?: string;
}

export interface KPIPlan {
  metric: string;
  target: string;
  review: 'daily' | 'weekly' | 'monthly';
}

export interface BoundsPlan {
  allowedActions: string[];
  forbiddenActions: string[];
  maxCostPerSession: string;
  requiresApproval: string[];
}

export interface AgentPlan {
  name: string;
  displayName: string;
  role: string;
  description: string;
  charter: string;
  provider: string;
  model: string;
  temperature: number;
  team: string;
  reportsTo: string | null;
  tools: string[];
  triggers: TriggerPlan[];
  kpis: KPIPlan[];
  behavioralBounds: BoundsPlan;
}

export interface TeamPlan {
  name: string;
  displayName: string;
  description: string;
  orchestrator: string;
  members: string[];
}

export interface WorkflowStepPlan {
  id: string;
  agent: string;
  task: string;
  dependsOn?: string[];
}

export interface WorkflowPlan {
  name: string;
  displayName: string;
  description: string;
  steps: WorkflowStepPlan[];
  timeout: number;
  onFailure: 'stop' | 'skip' | 'escalate';
}

export interface EscalationRule {
  condition: string;
  target: 'human' | string;
  description: string;
}

export interface ToolGap {
  capability: string;
  mentionedIn: string;
  suggestion: string;
  priority: 'required' | 'important' | 'nice-to-have';
}

export interface CompanyPlan {
  company: CompanyInfo;
  agents: AgentPlan[];
  teams: TeamPlan[];
  knowledge: Record<string, string>;
  workflows: WorkflowPlan[];
  escalationRules: EscalationRule[];
  toolGaps: ToolGap[];
  generatedAt: string;
  seedVersion: number;
  seedText: string;
}

export interface InterviewAnswer {
  question: string;
  answer: string;
  timestamp: string;
}

export interface InterviewSession {
  id: string;
  status: 'active' | 'completed' | 'abandoned';
  companyType: 'new' | 'existing';
  answers: InterviewAnswer[];
  seedText?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewStep {
  question: string | null;
  progress: string;
  complete: boolean;
  seedText?: string;
}

export interface SeedUploadResponse {
  text: string;
  wordCount: number;
}

export interface SeedApplyResponse {
  success: boolean;
  filesWritten: string[];
  agents: { id: string; name: string; displayName: string; role: string }[];
}

export interface SeedInterviewStartResponse {
  sessionId: string;
  step: InterviewStep;
}

// ── Knowledge Files ─────────────────────────────────────────────────

export interface KnowledgeFile {
  filename: string;
  content: string;
  size: number;
}

// ── Monitor Config ──────────────────────────────────────────────────

export interface MonitorConfig {
  name: string;
  description?: string;
  url: string;
  interval: string;
  agent: string;
  task: string;
  method?: string;
}

// ── Message Template Config ─────────────────────────────────────────

export interface MessageTemplateConfig {
  name: string;
  description?: string;
  channel: string;
  subject?: string;
  body: string;
  variables: string[];
}

// ── Archetype ───────────────────────────────────────────────────────

export interface ArchetypeInfo {
  name: string;
  temperature: number;
  tools: string[];
  allowedActions: string[];
  forbiddenActions: string[];
}
