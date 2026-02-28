'use client';

interface ActionMultiSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  actions: readonly ActionOption[];
  className?: string;
}

interface ActionOption {
  readonly id: string;
  readonly label: string;
  readonly category: string;
}

const COMMON_ACTIONS: readonly ActionOption[] = [
  { id: 'read_data', label: 'Read Data', category: 'Data' },
  { id: 'write_data', label: 'Write Data', category: 'Data' },
  { id: 'delete_data', label: 'Delete Data', category: 'Data' },
  { id: 'database_query', label: 'Database Query', category: 'Data' },
  { id: 'database_write', label: 'Database Write', category: 'Data' },
  { id: 'write_draft', label: 'Write Draft', category: 'Content' },
  { id: 'write_report', label: 'Write Report', category: 'Content' },
  { id: 'publish_content', label: 'Publish Content', category: 'Content' },
  { id: 'web_search', label: 'Web Search', category: 'External' },
  { id: 'web_browse', label: 'Web Browse', category: 'External' },
  { id: 'send_email', label: 'Send Email', category: 'Communication' },
  { id: 'send_client_email', label: 'Send Client Email', category: 'Communication' },
  { id: 'send_alert', label: 'Send Alert', category: 'Communication' },
  { id: 'modify_billing', label: 'Modify Billing', category: 'Admin' },
  { id: 'access_credentials', label: 'Access Credentials', category: 'Admin' },
] as const;

// Group actions by category
const CATEGORIES = [...new Set(COMMON_ACTIONS.map((a) => a.category))];

export function ActionMultiSelect({
  label,
  value,
  onChange,
  actions = COMMON_ACTIONS,
  className,
}: ActionMultiSelectProps) {
  const selected = new Set(
    value.split(',').map((s) => s.trim()).filter(Boolean),
  );

  function toggle(actionId: string) {
    const next = new Set(selected);
    if (next.has(actionId)) {
      next.delete(actionId);
    } else {
      next.add(actionId);
    }
    onChange([...next].join(', '));
  }

  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    items: actions.filter((a) => a.category === cat),
  }));

  return (
    <div className={className}>
      <label className="text-sm text-slate-400 block mb-2">{label}</label>
      <div className="space-y-2">
        {grouped.map((group) => (
          <div key={group.category}>
            <span className="text-xs text-slate-500 font-medium">{group.category}</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {group.items.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => toggle(action.id)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    selected.has(action.id)
                      ? 'bg-sky-600/20 text-sky-400 border border-sky-600/30'
                      : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Show raw value for custom actions not in presets */}
      {[...selected].some((s) => !actions.some((a) => a.id === s)) && (
        <p className="text-xs text-slate-500 mt-2">
          Custom: {[...selected].filter((s) => !actions.some((a) => a.id === s)).join(', ')}
        </p>
      )}
    </div>
  );
}

export { COMMON_ACTIONS };
export type { ActionOption };
