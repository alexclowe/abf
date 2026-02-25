/**
 * BuiltinToolContext -- dependencies injected into all built-in tool factories.
 * Created once in factory.ts and passed to createBuiltinTools().
 */

import type { ICredentialVault } from '../../credentials/index.js';
import type { PluginWithConfig } from '../../messaging/router.js';

export interface BuiltinToolContext {
	/** Credential vault for API keys (web-search, knowledge-search). */
	readonly vault: ICredentialVault;
	/** Absolute path to the project root directory. */
	readonly projectRoot: string;
	/** Messaging plugins for send-message tool (direct channel routing). */
	readonly messagingPlugins: readonly PluginWithConfig[];
}
