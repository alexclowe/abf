'use client';

import { OrgChartNode } from './OrgChartNode';
import type { OrgNode } from '@/lib/org-tree';

interface OrgChartProps {
  root: OrgNode;
}

export function OrgChart({ root }: OrgChartProps) {
  // CEO at top, then each direct child (orchestrator) as a team section
  // with their children (team members) in a wrapping grid below
  return (
    <div className="space-y-4">
      {/* CEO node centered */}
      <div className="flex justify-center">
        <OrgChartNode node={root} />
      </div>

      {/* Vertical connector from CEO */}
      {root.children.length > 0 && (
        <div className="flex justify-center">
          <div className="w-px h-6 bg-slate-700" />
        </div>
      )}

      {/* Team sections */}
      {root.children.length === 1 && root.children[0]!.children.length > 0 ? (
        // Single orchestrator: show orchestrator then members
        <SingleTeamSection node={root.children[0]!} />
      ) : root.children.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {root.children.map((child) => (
            <TeamSection key={child.id} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Single team — orchestrator centered, members in grid below */
function SingleTeamSection({ node }: { node: OrgNode }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <OrgChartNode node={node} />
      </div>
      {node.children.length > 0 && (
        <>
          <div className="flex justify-center">
            <div className="w-px h-6 bg-slate-700" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {node.children.map((child) => (
              <OrgChartNode key={child.id} node={child} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Multi-team — bordered card with orchestrator header + member grid */
function TeamSection({ node }: { node: OrgNode }) {
  const hasChildren = node.children.length > 0;

  if (!hasChildren) {
    // Leaf node (no team under them) — just render the card
    return <OrgChartNode node={node} />;
  }

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      {/* Orchestrator as section header */}
      <div className="border-b border-slate-800 bg-slate-900/50 p-2">
        <OrgChartNode node={node} />
      </div>
      {/* Team members */}
      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {node.children.map((child) => (
          <OrgChartNode key={child.id} node={child} />
        ))}
      </div>
    </div>
  );
}
