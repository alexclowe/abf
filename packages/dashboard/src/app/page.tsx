'use client';

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useEventStream } from '@/lib/use-event-stream';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AgentStatusBadge } from '@/components/AgentStatusBadge';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { OrgChart } from '@/components/OrgChart';
import { ActionFeed } from '@/components/ActionFeed';
import { buildOrgTree } from '@/lib/org-tree';
import { Bot, DollarSign, MessageCircle } from 'lucide-react';
import type { OnboardingData } from '@/components/OnboardingChecklist';
import { getOnboardingState, updateOnboardingState } from '@/lib/onboarding';

function parseSeedFrontmatter(content: string): { name?: string; description?: string; industry?: string; stage?: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return null;
  const pairs: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) pairs[key.trim()] = rest.join(':').trim();
  }
  return { name: pairs['company_name'], description: pairs['company_description'], industry: pairs['industry'], stage: pairs['stage'] };
}

function parseBuildPlanSummary(content: string): { goal: string; phases: number; steps: number; firstPhaseName: string | null } | null {
  const lines = content.split('\n');
  let goal = '';
  let pastHeading = false;
  for (const line of lines) {
    if (line.startsWith('#')) { pastHeading = true; continue; }
    if (pastHeading && line.trim()) { goal = line.trim(); break; }
  }
  const phaseHeadings = lines
    .filter(l => /^##\s/.test(l))
    .map(l => l.replace(/^##\s+/, '').replace(/^Phase:\s*/i, '').trim());
  const phases = phaseHeadings.length;
  const steps = lines.filter(l => /^###\s/.test(l)).length;
  if (!goal && phases === 0) return null;
  return { goal: goal || 'Build plan', phases, steps, firstPhaseName: phaseHeadings[0] ?? null };
}

/** Handles ?fresh=1 query param to force-refresh SWR after setup wizard redirect. */
function FreshDataReloader() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { mutate } = useSWRConfig();

  useEffect(() => {
    if (searchParams.get('fresh') === '1') {
      void mutate(() => true);
      router.replace('/');
    }
  }, [searchParams, mutate, router]);

  return null;
}

export default function OverviewPage() {
  const router = useRouter();
  const { data: stream } = useEventStream();

  const sseHasAgents = !!stream?.agents?.[0]?.config;
  const sseHasStatus = stream?.status?.activeSessions !== undefined;
  const sseHasSessions = !!stream?.sessions;

  const { data: swrStatus } = useSWR(!sseHasStatus ? 'status' : null, () => api.status(), { refreshInterval: 10_000, dedupingInterval: 5_000 });
  const { data: swrAgents } = useSWR(!sseHasAgents ? 'agents' : null, () => api.agents.list(), { refreshInterval: 10_000, dedupingInterval: 5_000 });
  const { data: swrSessions } = useSWR(!sseHasSessions ? 'sessions' : null, () => api.sessions.active(), { refreshInterval: 10_000, dedupingInterval: 5_000 });

  const status = sseHasStatus ? stream!.status : swrStatus;
  const agents = (sseHasAgents ? stream!.agents : swrAgents) as { config: Record<string, any>; state?: Record<string, any> | null }[] | undefined;
  const sessions = sseHasSessions ? stream!.sessions : swrSessions;

  const { data: authStatus } = useSWR('auth-status', () => api.auth.status(), { revalidateOnFocus: false });
  const { data: knowledgeFiles } = useSWR('knowledge', () => api.knowledge.list(), { revalidateOnFocus: false });
  const { data: teams } = useSWR('teams', () => api.teams.list(), { revalidateOnFocus: false });
  const { data: projectConfig, mutate: mutateConfig } = useSWR('config', () => api.config.get(), { revalidateOnFocus: false });

  const seedFile = useMemo(() => knowledgeFiles?.find(f => f.filename === 'seed.md'), [knowledgeFiles]);
  const buildPlanFile = useMemo(() => knowledgeFiles?.find(f => f.filename === 'build-plan.md'), [knowledgeFiles]);
  const seedMeta = useMemo(() => seedFile ? parseSeedFrontmatter(seedFile.content) : null, [seedFile]);
  const buildPlanSummary = useMemo(() => buildPlanFile ? parseBuildPlanSummary(buildPlanFile.content) : null, [buildPlanFile]);
  const isSeed = !!seedFile;

  const onboardingState = useMemo(() => getOnboardingState(projectConfig), [projectConfig]);

  const handleDismissChecklist = useCallback(async () => {
    await updateOnboardingState({ dismissed: true });
    void mutateConfig();
  }, [mutateConfig]);

  const onboardingData = useMemo<OnboardingData>(() => {
    const hasProvider = authStatus
      ? Object.values(authStatus).some((s) => s.connected)
      : false;
    const agentCount = agents?.length ?? 0;
    const hasRun = agents?.some((a) => (a.state?.sessionsCompleted ?? 0) > 0) ?? false;
    const knowledgeCount = knowledgeFiles?.length ?? 0;
    return {
      hasProvider, agentCount, hasRun, hasChannel: false, knowledgeCount,
      isSeed,
      hasBuildPlan: !!buildPlanFile,
      buildPlanReviewed: onboardingState.build_plan_reviewed,
      firstTaskSent: onboardingState.first_task_sent,
      companyName: typeof projectConfig?.name === 'string' ? projectConfig.name : seedMeta?.name,
    };
  }, [authStatus, agents, knowledgeFiles, isSeed, buildPlanFile, onboardingState, seedMeta]);

  const [startingPhase, setStartingPhase] = useState(false);

  const builderAgent = useMemo(
    () => agents?.find(a => a.config.name === 'builder' || a.config.role === 'Build Orchestrator'),
    [agents],
  );

  async function handleStartPhase1() {
    if (!builderAgent || !buildPlanSummary?.firstPhaseName) return;
    setStartingPhase(true);
    try {
      const task = `Begin Phase 1: ${buildPlanSummary.firstPhaseName}. Read the build plan from knowledge/build-plan.md and start executing the steps in Phase 1.`;
      await api.agents.run(builderAgent.config.id, task);
      if (!onboardingState.first_task_sent) {
        await updateOnboardingState({ first_task_sent: true });
        void mutateConfig();
      }
      router.push(`/agents/${builderAgent.config.id}/chat`);
    } finally {
      setStartingPhase(false);
    }
  }

  // Build org tree from agents + teams
  const orgTree = useMemo(() => {
    if (!agents || agents.length === 0) return null;
    return buildOrgTree(agents as any[], teams ?? []);
  }, [agents, teams]);

  // Agents with errors for the action feed
  const agentErrors = useMemo(() => {
    if (!agents) return [];
    return agents
      .filter((a) => (a.state?.errorCount ?? 0) > 0)
      .map((a) => ({
        id: a.config.id,
        name: a.config.name,
        displayName: a.config.displayName,
        errorCount: a.state?.errorCount as number,
      }));
  }, [agents]);

  return (
    <div className="p-6 space-y-6">
      <Suspense><FreshDataReloader /></Suspense>
      {/* Company header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{(typeof projectConfig?.name === 'string' && projectConfig.name) || seedMeta?.name || 'Your Team'}</h1>
          {seedMeta?.description && (
            <p className="text-slate-400 text-sm mt-1">{seedMeta.description}</p>
          )}
          {seedMeta?.industry && (
            <div className="flex items-center gap-2 mt-2">
              {seedMeta.industry && <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded">{seedMeta.industry}</span>}
              {seedMeta.stage && <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded">{seedMeta.stage}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Onboarding Checklist */}
      <OnboardingChecklist
        data={onboardingData}
        dismissed={onboardingState.dismissed}
        onDismiss={handleDismissChecklist}
        onStartPhase1={builderAgent ? handleStartPhase1 : undefined}
        startingPhase={startingPhase}
      />

      {/* Action feed — errors, pending approvals, escalations */}
      <ActionFeed agentErrors={agentErrors} />

      {/* Org Chart / Agent List */}
      {agents && agents.length > 0 ? (
        <>
          {/* Desktop: Org chart */}
          <div className="hidden md:block">
            {orgTree && <OrgChart root={orgTree} />}
          </div>
          {/* Mobile: Simple list with avatars */}
          <div className="md:hidden space-y-0 border border-slate-800 rounded-lg overflow-hidden">
            {agents.map((a, i) => (
              <Link
                key={a.config.id}
                href={`/agents/${a.config.id}`}
                className={`flex items-center gap-3 bg-slate-900 p-3 hover:bg-slate-800/50 transition-colors ${i < agents.length - 1 ? 'border-b border-slate-800' : ''}`}
              >
                <AgentAvatar name={a.config.name} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{a.config.displayName}</span>
                    <AgentStatusBadge status={a.state?.status ?? 'idle'} />
                  </div>
                  <p className="text-xs text-slate-500 truncate">{a.config.role}</p>
                </div>
                <Link
                  href={`/agents/${a.config.id}/chat`}
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-md hover:bg-slate-700 transition-colors text-slate-400 hover:text-sky-400"
                >
                  <MessageCircle size={14} />
                </Link>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <Bot size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400">No agents configured yet.</p>
          <p className="text-slate-500 text-sm mt-2">
            Set up your first agents using the Setup Wizard.
          </p>
          <a
            href="/setup"
            className="inline-block mt-4 px-6 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            Get Started
          </a>
        </div>
      )}

      {/* Footer stats */}
      <div className="flex items-center gap-6 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Bot size={12} />
          Agents: {status?.agents ?? 0}
        </span>
        <span>Active: {sessions?.length ?? status?.activeSessions ?? 0}</span>
        <span className="flex items-center gap-1">
          <DollarSign size={12} />
          Cost today: $0.00
        </span>
      </div>
    </div>
  );
}
