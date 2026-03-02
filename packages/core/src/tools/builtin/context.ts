/**
 * BuiltinToolContext -- dependencies injected into all built-in tool factories.
 * Created once in factory.ts and passed to createBuiltinTools().
 */

import type { ICredentialVault } from '../../credentials/index.js';
import type { PluginWithConfig } from '../../messaging/router.js';
import type { IApprovalStore } from '../../types/approval.js';
import type { IDatastore } from '../../types/datastore.js';

export interface BuiltinToolContext {
	/** Credential vault for API keys (web-search, knowledge-search). */
	readonly vault: ICredentialVault;
	/** Absolute path to the project root directory. */
	readonly projectRoot: string;
	/** Messaging plugins for send-message tool (direct channel routing). */
	readonly messagingPlugins: readonly PluginWithConfig[];
	/** Approval queue for tools with requiresApproval. */
	readonly approvalStore?: IApprovalStore | undefined;
	/** Business database for agent data operations. */
	readonly datastore?: IDatastore | undefined;
	/** Message templates for send-message tool. */
	readonly messageTemplates?: import('../../messaging/templates.js').MessageTemplateRegistry | undefined;
	/** Task plan store for plan-task tool. */
	readonly taskPlanStore?: import('../../types/task-plan.js').ITaskPlanStore | undefined;
	/** Whether running in ABF Cloud mode (dashboard-managed credentials). */
	readonly isCloud: boolean;
	/** ABF Cloud proxy endpoint (e.g. 'https://api.abf.cloud/v1'). Set when isCloud or cloud config present. */
	readonly cloudEndpoint?: string | undefined;
	/** Virtual mailbox store for inter-agent communication. */
	readonly mailboxStore?: import('../../mailbox/types.js').IMailboxStore | undefined;
	/** Shared agents map for recipient validation (agent-email tool). */
	readonly agentsMap?: ReadonlyMap<string, import('../../types/agent.js').AgentConfig> | undefined;
}
