export interface OrgNode {
  id: string;
  name: string;
  displayName: string;
  role: string;
  description: string;
  status: string;
  roleArchetype?: string;
  team?: string;
  isCeo?: boolean;
  children: OrgNode[];
}

interface AgentInput {
  config: {
    id: string;
    name: string;
    displayName: string;
    role: string;
    description: string;
    team?: string;
    reportsTo?: string;
    roleArchetype?: string;
  };
  state?: { status?: string } | null;
}

interface TeamInput {
  id: string;
  name: string;
  orchestrator?: string;
  members?: string[];
}

export function buildOrgTree(agents: AgentInput[], teams: TeamInput[]): OrgNode {
  // Lookup maps: by id and by name
  const byId = new Map<string, AgentInput>();
  const byName = new Map<string, AgentInput>();
  for (const a of agents) {
    byId.set(a.config.id, a);
    byName.set(a.config.name, a);
  }

  // Orchestrator IDs from team definitions
  const orchestratorIds = new Set<string>();
  const teamOrchMap = new Map<string, string>(); // team name/id → orchestrator agent id
  for (const t of teams) {
    if (t.orchestrator) {
      const orch = byId.get(t.orchestrator) ?? byName.get(t.orchestrator);
      if (orch) {
        orchestratorIds.add(orch.config.id);
        teamOrchMap.set(t.name, orch.config.id);
        teamOrchMap.set(t.id, orch.config.id);
      }
    }
  }

  // Build child map: parentId → children[]
  const childMap = new Map<string, OrgNode[]>();
  const rootChildren: OrgNode[] = [];

  function toNode(a: AgentInput): OrgNode {
    return {
      id: a.config.id,
      name: a.config.name,
      displayName: a.config.displayName,
      role: a.config.role,
      description: a.config.description,
      status: a.state?.status ?? 'idle',
      roleArchetype: a.config.roleArchetype,
      team: a.config.team,
      children: [],
    };
  }

  // First pass: determine parent for each agent
  for (const a of agents) {
    const node = toNode(a);
    let parentId: string | null = null;

    // 1. Explicit reportsTo
    if (a.config.reportsTo) {
      const parent = byId.get(a.config.reportsTo) ?? byName.get(a.config.reportsTo);
      if (parent) parentId = parent.config.id;
    }

    // 2. Team membership: non-orchestrators parent to team orchestrator
    if (!parentId && a.config.team && !orchestratorIds.has(a.config.id)) {
      const orchId = teamOrchMap.get(a.config.team);
      if (orchId && orchId !== a.config.id) {
        parentId = orchId;
      }
    }

    if (parentId) {
      if (!childMap.has(parentId)) childMap.set(parentId, []);
      childMap.get(parentId)!.push(node);
    } else {
      rootChildren.push(node);
    }
  }

  // Second pass: attach children recursively
  function attachChildren(node: OrgNode): void {
    const kids = childMap.get(node.id);
    if (kids) {
      node.children = kids;
      for (const k of kids) attachChildren(k);
    }
  }

  for (const node of rootChildren) attachChildren(node);

  // CEO root
  return {
    id: '__ceo__',
    name: 'ceo',
    displayName: 'You',
    role: 'CEO',
    description: '',
    status: 'active',
    isCeo: true,
    children: rootChildren,
  };
}
