'use client';

import { useState, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useEventStream } from '@/lib/use-event-stream';
import { AgentStatusBadge } from '@/components/AgentStatusBadge';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { Bot, Play, DollarSign, Hammer, ArrowRight, Users, Rocket } from 'lucide-react';
import type { OnboardingData } from '@/components/OnboardingChecklist';
import { getOnboardingState, updateOnboardingState } from '@/lib/onboarding';
import Link from 'next/link';

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
  // Goal: first non-heading, non-empty line after the first heading
  let goal = '';
  let pastHeading = false;
  for (const line of lines) {
    if (line.startsWith('#')) { pastHeading = true; continue; }
    if (pastHeading && line.trim()) { goal = line.trim(); break; }
  }
  // Parse phase headings (format: "## Phase: {name}")
  const phaseHeadings = lines
    .filter(l => /^##\s/.test(l))
    .map(l => l.replace(/^##\s+/, '').replace(/^Phase:\s*/i, '').trim());
  const phases = phaseHeadings.length;
  const steps = lines.filter(l => /^###\s/.test(l)).length;
  if (!goal && phases === 0) return null;
  return { goal: goal || 'Build plan', phases, steps, firstPhaseName: phaseHeadings[0] ?? null };
}

export default function OverviewPage() {
  const { data: stream } = useEventStream();

  // Check if SSE snapshot has the data shapes this page needs
  const sseHasAgents = !!stream?.agents?.[0]?.config;
  const sseHasStatus = stream?.status?.activeSessions !== undefined;
  const sseHasSessions = !!stream?.sessions;

  // SWR polls only when SSE doesn't provide usable data for that field
  const { data: swrStatus } = useSWR(!sseHasStatus ? 'status' : null, () => api.status(), { refreshInterval: 10_000, dedupingInterval: 5_000 });
  const { data: swrAgents } = useSWR(!sseHasAgents ? 'agents' : null, () => api.agents.list(), { refreshInterval: 10_000, dedupingInterval: 5_000 });
  const { data: swrSessions } = useSWR(!sseHasSessions ? 'sessions' : null, () => api.sessions.active(), { refreshInterval: 10_000, dedupingInterval: 5_000 });

  const status = sseHasStatus ? stream!.status : swrStatus;
  const agents = (sseHasAgents ? stream!.agents : swrAgents) as { config: Record<string, any>; state?: Record<string, any> | null }[] | undefined;
  const sessions = sseHasSessions ? stream!.sessions : swrSessions;

  // Data for onboarding checklist + seed detection
  const { data: authStatus } = useSWR('auth-status', () => api.auth.status(), { revalidateOnFocus: false });
  const { data: knowledgeFiles } = useSWR('knowledge', () => api.knowledge.list(), { revalidateOnFocus: false });
  const { data: teams } = useSWR('teams', () => api.teams.list(), { revalidateOnFocus: false });
  const { data: projectConfig, mutate: mutateConfig } = useSWR('config', () => api.config.get(), { revalidateOnFocus: false });

  // Seed detection: check for seed.md and build-plan.md in knowledge files
  const seedFile = useMemo(() => knowledgeFiles?.find(f => f.filename === 'seed.md'), [knowledgeFiles]);
  const buildPlanFile = useMemo(() => knowledgeFiles?.find(f => f.filename === 'build-plan.md'), [knowledgeFiles]);
  const seedMeta = useMemo(() => seedFile ? parseSeedFrontmatter(seedFile.content) : null, [seedFile]);
  const buildPlanSummary = useMemo(() => buildPlanFile ? parseBuildPlanSummary(buildPlanFile.content) : null, [buildPlanFile]);
  const isSeed = !!seedFile;

  // Onboarding state from project config (server-side, works across browsers/devices)
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
      companyName: seedMeta?.name,
    };
  }, [authStatus, agents, knowledgeFiles, isSeed, buildPlanFile, onboardingState, seedMeta]);

  // Group agents by team
  const agentsByTeam = useMemo(() => {
    if (!agents) return null;
    const teamMap = new Map<string, typeof agents>();
    for (const a of agents) {
      const teamKey = a.config.team || '';
      if (!teamMap.has(teamKey)) teamMap.set(teamKey, []);
      teamMap.get(teamKey)!.push(a);
    }
    // Sort: named teams first (in teams order), then unassigned
    const sortedGroups: { key: string; displayName: string; agents: typeof agents }[] = [];
    if (teams) {
      for (const t of teams) {
        const teamAgents = teamMap.get(t.name) ?? teamMap.get(t.id);
        if (teamAgents) {
          sortedGroups.push({ key: t.name, displayName: t.displayName || t.name, agents: teamAgents });
          teamMap.delete(t.name);
          teamMap.delete(t.id);
        }
      }
    }
    // Remaining groups (teams not in team definitions, or unassigned)
    for (const [key, teamAgents] of teamMap) {
      sortedGroups.push({ key, displayName: key || 'Unassigned', agents: teamAgents });
    }
    return sortedGroups;
  }, [agents, teams]);

  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});
  const [activeInput, setActiveInput] = useState<string | null>(null);
  const [startingPhase, setStartingPhase] = useState(false);

  // Find the builder agent (always named 'builder' by the seed pipeline)
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
    } finally {
      setStartingPhase(false);
    }
  }

  function handleRunClick(agentId: string) {
    if (activeInput === agentId) {
      // Submit the task
      const task = taskInputs[agentId];
      if (task?.trim()) {
        void api.agents.run(agentId, task.trim());
        setActiveInput(null);
        setTaskInputs((prev) => ({ ...prev, [agentId]: '' }));
        // Mark first task sent for onboarding (only writes once)
        if (!onboardingState.first_task_sent) {
          void updateOnboardingState({ first_task_sent: true }).then(() => mutateConfig());
        }
      }
    } else {
      setActiveInput(agentId);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Company header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{seedMeta?.name || 'Your Team'}</h1>
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
      <OnboardingChecklist data={onboardingData} dismissed={onboardingState.dismissed} onDismiss={handleDismissChecklist} />

      {/* Build Plan card */}
      {isSeed && buildPlanSummary && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 p-2 bg-amber-500/10 rounded-md">
              <Hammer size={16} className="text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-white">Build Plan</h3>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{buildPlanSummary.goal}</p>
              <p className="text-xs text-slate-500 mt-1">
                {buildPlanSummary.phases} phase{buildPlanSummary.phases !== 1 ? 's' : ''}{buildPlanSummary.steps > 0 ? `, ${buildPlanSummary.steps} step${buildPlanSummary.steps !== 1 ? 's' : ''}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 mt-1">
              {builderAgent && buildPlanSummary.firstPhaseName && !onboardingState.first_task_sent && (
                <button
                  type="button"
                  onClick={handleStartPhase1}
                  disabled={startingPhase}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <Rocket size={12} />
                  {startingPhase ? 'Starting...' : `Start Phase 1`}
                </button>
              )}
              {onboardingState.first_task_sent && (
                <span className="text-xs text-green-400 flex items-center gap-1">
                  Phase 1 started
                </span>
              )}
              <Link
                href="/knowledge?file=build-plan.md"
                className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors"
              >
                View Plan <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Agent cards — grouped by team */}
      {agents && agents.length > 0 && agentsByTeam ? (
        <div className="space-y-0 border border-slate-800 rounded-lg overflow-hidden">
          {agentsByTeam.map((group, gi) => (
            <div key={group.key}>
              {/* Team header — only show when there are multiple groups */}
              {agentsByTeam.length > 1 && (
                <div className={`bg-slate-900/50 px-4 py-2 flex items-center gap-2 ${gi > 0 ? 'border-t border-slate-800' : ''}`}>
                  <Users size={12} className="text-slate-500" />
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{group.displayName}</span>
                  <span className="text-xs text-slate-600">{group.agents.length}</span>
                </div>
              )}
              {group.agents.map((a, i) => (
                <div
                  key={a.config.id}
                  className={`bg-slate-900 p-4 ${i < group.agents.length - 1 || gi < agentsByTeam.length - 1 ? 'border-b border-slate-800' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{a.config.displayName}</span>
                        <span className="text-slate-500">&middot;</span>
                        <span className="text-sm text-slate-400">{a.config.role}</span>
                        <AgentStatusBadge status={a.state?.status ?? 'idle'} />
                      </div>
                      <p className="text-sm text-slate-500">{a.config.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRunClick(a.config.id)}
                      className="ml-4 flex-shrink-0 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-1.5"
                    >
                      <Play size={12} />
                      Run
                    </button>
                  </div>
                  {activeInput === a.config.id && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        placeholder="What should this agent do?"
                        value={taskInputs[a.config.id] ?? ''}
                        onChange={(e) =>
                          setTaskInputs((prev) => ({ ...prev, [a.config.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRunClick(a.config.id);
                          if (e.key === 'Escape') setActiveInput(null);
                        }}
                        autoFocus
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleRunClick(a.config.id)}
                        disabled={!taskInputs[a.config.id]?.trim()}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md text-sm font-medium transition-colors"
                      >
                        Send
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveInput(null)}
                        className="px-2 py-1.5 text-slate-400 hover:text-white text-sm transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : agents && agents.length > 0 ? (
        /* Flat list fallback when teams haven't loaded yet */
        <div className="space-y-0 border border-slate-800 rounded-lg overflow-hidden">
          {agents.map((a, i) => (
            <div
              key={a.config.id}
              className={`bg-slate-900 p-4 ${i < agents.length - 1 ? 'border-b border-slate-800' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{a.config.displayName}</span>
                    <span className="text-slate-500">&middot;</span>
                    <span className="text-sm text-slate-400">{a.config.role}</span>
                    <AgentStatusBadge status={a.state?.status ?? 'idle'} />
                  </div>
                  <p className="text-sm text-slate-500">{a.config.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRunClick(a.config.id)}
                  className="ml-4 flex-shrink-0 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-1.5"
                >
                  <Play size={12} />
                  Run
                </button>
              </div>
              {activeInput === a.config.id && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    placeholder="What should this agent do?"
                    value={taskInputs[a.config.id] ?? ''}
                    onChange={(e) =>
                      setTaskInputs((prev) => ({ ...prev, [a.config.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRunClick(a.config.id);
                      if (e.key === 'Escape') setActiveInput(null);
                    }}
                    autoFocus
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleRunClick(a.config.id)}
                    disabled={!taskInputs[a.config.id]?.trim()}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md text-sm font-medium transition-colors"
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveInput(null)}
                    className="px-2 py-1.5 text-slate-400 hover:text-white text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
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
