/**
 * Zod schema for team YAML definitions.
 */

import { z } from 'zod';
import type { AgentId, TeamId } from '../types/common.js';
import type { TeamConfig } from '../types/team.js';

export const teamYamlSchema = z.object({
	name: z.string(),
	display_name: z.string(),
	description: z.string(),
	orchestrator: z.string(),
	members: z.array(z.string()).default([]),
	goals: z.array(z.string()).default([]),
});

export type TeamYamlInput = z.input<typeof teamYamlSchema>;

export function transformTeamYaml(parsed: z.output<typeof teamYamlSchema>): TeamConfig {
	return {
		name: parsed.name,
		id: parsed.name as TeamId,
		displayName: parsed.display_name,
		description: parsed.description,
		orchestrator: parsed.orchestrator as AgentId,
		members: parsed.members as unknown as readonly AgentId[],
		goals: parsed.goals,
	};
}
