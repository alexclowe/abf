export interface SlashCommand {
  name: string;
  description: string;
  execute: (args: string, agentId: string) => void;
}

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? '';
const API_KEY = process.env.NEXT_PUBLIC_ABF_API_KEY;

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['Authorization'] = `Bearer ${API_KEY}`;
  return h;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'task',
    description: 'Send a task to this agent\'s inbox',
    execute: (args, agentId) => {
      if (!args.trim()) return;
      fetch(`${BASE}/api/agents/${agentId}/inbox`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ subject: args.trim(), body: args.trim(), priority: 'normal' }),
      }).catch(() => {});
    },
  },
  {
    name: 'clear',
    description: 'Clear the conversation',
    execute: () => {
      // This is handled by the chat page directly — triggers onClear
      window.location.reload();
    },
  },
  {
    name: 'export',
    description: 'Export this conversation as markdown',
    execute: () => {
      // Trigger export via custom event — picked up by chat page
      window.dispatchEvent(new CustomEvent('abf:export-chat'));
    },
  },
  {
    name: 'search',
    description: 'Search the knowledge base',
    execute: () => {
      // This is a no-op on the client — the text "Search the knowledge base for: ..."
      // gets sent as a regular chat message, which the agent handles with its tools.
      // The slash command menu just provides discoverability.
    },
  },
];
