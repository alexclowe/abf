/**
 * Seed-to-Company types — the structured output of analyzing a seed document.
 *
 * The CompanyPlan is the intermediate representation between a free-form
 * seed document and the generated YAML files. The analyzer produces it,
 * the user reviews it, and the apply step writes it to disk.
 */

// ─── Company Plan (top-level output of the analyzer) ─────────────────

export interface CompanyPlan {
	/** Company metadata extracted from the seed doc. */
	company: CompanyInfo;

	/** Agent definitions — the AI employees. */
	agents: AgentPlan[];

	/** Team groupings. */
	teams: TeamPlan[];

	/** Knowledge base files to generate. Key = filename (e.g. "company.md"), value = content. */
	knowledge: Record<string, string>;

	/** Suggested workflows. */
	workflows: WorkflowPlan[];

	/** Global escalation rules (applied across agents). */
	escalationRules: EscalationRule[];

	/** Capabilities mentioned in the seed doc that don't map to built-in ABF tools. */
	toolGaps: ToolGap[];

	/** ISO timestamp of when this plan was generated. */
	generatedAt: string;

	/** Version tracking for seed doc iterations. */
	seedVersion: number;

	/** The raw seed document text (preserved for reference). */
	seedText: string;
}

// ─── Company Info ────────────────────────────────────────────────────

export interface CompanyInfo {
	name: string;
	description: string;
	mission?: string;
	targetCustomer?: string;
	revenueModel?: string;
	industry?: string;
	stage?: 'idea' | 'pre-launch' | 'launched' | 'growing' | 'established';
}

// ─── Agent Plan ──────────────────────────────────────────────────────

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

// ─── Team Plan ───────────────────────────────────────────────────────

export interface TeamPlan {
	name: string;
	displayName: string;
	description: string;
	orchestrator: string;
	members: string[];
}

// ─── Workflow Plan ───────────────────────────────────────────────────

export interface WorkflowPlan {
	name: string;
	displayName: string;
	description: string;
	steps: WorkflowStepPlan[];
	timeout: number;
	onFailure: 'stop' | 'skip' | 'escalate';
}

export interface WorkflowStepPlan {
	id: string;
	agent: string;
	task: string;
	dependsOn?: string[];
}

// ─── Escalation Rules ────────────────────────────────────────────────

export interface EscalationRule {
	condition: string;
	target: 'human' | string;
	description: string;
}

// ─── Tool Gaps ───────────────────────────────────────────────────────

export interface ToolGap {
	/** The capability mentioned in the seed doc (e.g. "Stripe payment processing"). */
	capability: string;
	/** Where in the seed doc it was mentioned. */
	mentionedIn: string;
	/** Suggestion for how to address: built-in tool, MCP server, or custom tool. */
	suggestion: string;
	/** Priority: how critical is this for the business to function. */
	priority: 'required' | 'important' | 'nice-to-have';
}

// ─── Interview Types ─────────────────────────────────────────────────

export interface InterviewSession {
	id: string;
	status: 'active' | 'completed' | 'abandoned';
	companyType: 'new' | 'existing';
	answers: InterviewAnswer[];
	/** Generated seed doc text once interview is complete. */
	seedText?: string;
	createdAt: string;
	updatedAt: string;
}

export interface InterviewAnswer {
	question: string;
	answer: string;
	timestamp: string;
}

export interface InterviewStep {
	/** The next question to ask (null if interview is complete). */
	question: string | null;
	/** Progress indicator (e.g. "3 of 8"). */
	progress: string;
	/** Whether the interview is complete and a seed doc is ready. */
	complete: boolean;
	/** The generated seed doc (only present when complete = true). */
	seedText?: string;
}

// ─── Seed Document Metadata ──────────────────────────────────────────

export interface SeedMetadata {
	/** Current version number (increments on each re-analysis). */
	version: number;
	/** When the seed doc was first ingested. */
	originalDate: string;
	/** When the seed doc was last re-analyzed. */
	lastAnalyzed: string;
	/** Hash of the seed text for change detection. */
	textHash: string;
}
