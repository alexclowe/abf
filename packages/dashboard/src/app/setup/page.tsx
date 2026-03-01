'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { api } from '@/lib/api';
import type {
  CompanyPlan,
  AgentPlan,
  InterviewAnswer,
} from '@/lib/types';
import clsx from 'clsx';
import {
  ChevronDown,
  ChevronRight,
  X,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Lightbulb,
  ClipboardPaste,
  LayoutTemplate,
  Users,
  Bot,
  Shield,
  BookOpen,
  GitBranch,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type CompanyTypeChoice = 'new-idea' | 'has-document' | 'existing-company' | 'template';
type SeedInputTab = 'paste' | 'upload';

const TOTAL_STEPS = 6;

const providers = [
  { id: 'abf-cloud', name: 'ABF Cloud', desc: 'We handle everything. No API keys needed.', needsKey: false, keyUrl: null, isCloud: true },
  { id: 'anthropic', name: 'Anthropic (Claude)', desc: 'Best for reasoning and writing. Recommended.', needsKey: true, keyUrl: 'https://console.anthropic.com/keys', isCloud: false },
  { id: 'openai', name: 'OpenAI (GPT)', desc: 'Fast and reliable. Good alternative.', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', isCloud: false },
  { id: 'ollama', name: 'Ollama', desc: 'Free, runs on your computer. No internet required.', needsKey: false, keyUrl: null, isCloud: false },
];

const templates = [
  { id: 'solo-founder', name: 'Solo Founder', desc: 'Minimal setup with a few core agents' },
  { id: 'saas', name: 'SaaS', desc: 'Full product team with engineering, support, and finance' },
  { id: 'marketing-agency', name: 'Marketing Agency', desc: 'Content, SEO, social media, and analytics agents' },
  { id: 'custom', name: 'Custom', desc: 'Start from scratch with an empty project' },
];

const companyTypeOptions: { id: CompanyTypeChoice; letter: string; title: string; desc: string; icon: typeof Lightbulb }[] = [
  { id: 'new-idea', letter: 'A', title: 'Start a new company from an idea', desc: 'I have a business idea and want AI agents to help build it', icon: Lightbulb },
  { id: 'has-document', letter: 'B', title: 'I have a business plan or seed document', desc: "I've already written up my company plan", icon: FileText },
  { id: 'existing-company', letter: 'C', title: 'Set up agents for my existing company', desc: 'I want to add AI agents to my current business', icon: Building2 },
  { id: 'template', letter: 'D', title: 'Use a template (quick start)', desc: 'Just give me a pre-built agent team to customize', icon: LayoutTemplate },
];

const priorityColors: Record<string, string> = {
  required: 'bg-red-500/20 text-red-400 border-red-500/30',
  important: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'nice-to-have': 'bg-slate-700/50 text-slate-400 border-slate-600/30',
};

// ── Shared UI Components ─────────────────────────────────────────────────

function NavButtons({
  onBack,
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
  nextVariant = 'primary',
  loading = false,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextVariant?: 'primary' | 'success';
  loading?: boolean;
}) {
  const nextCls = nextVariant === 'success'
    ? 'bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500'
    : 'bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500';

  return (
    <div className="flex justify-between">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
        >
          Back
        </button>
      ) : (
        <div />
      )}
      {onNext && (
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || loading}
          className={clsx('px-4 py-2 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2', nextCls)}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {nextLabel}
        </button>
      )}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-slate-900 border border-slate-800 rounded-lg p-4', className)}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-slate-400 mb-2">{children}</h3>;
}

// ── Expandable Agent Row ─────────────────────────────────────────────────

function AgentRow({
  agent,
  onRemove,
}: {
  agent: AgentPlan;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-slate-500">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{agent.displayName}</span>
            <span className="text-xs text-slate-500 font-mono">{agent.name}</span>
          </div>
          <div className="text-xs text-slate-400 truncate">{agent.role}</div>
        </div>
        <span className="text-xs text-slate-500">{agent.team}</span>
        <span className="text-xs text-slate-500">{agent.tools.length} tools</span>
        <span className="text-xs text-slate-500">{agent.kpis.length} KPIs</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-slate-600 hover:text-red-400 transition-colors p-1"
          title="Remove agent"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-slate-800 px-4 py-3 space-y-3 bg-slate-950/50">
          <div>
            <SectionTitle>Charter Preview</SectionTitle>
            <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
              {agent.charter.length > 500 ? agent.charter.slice(0, 500) + '...' : agent.charter}
            </pre>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <SectionTitle>Allowed Actions</SectionTitle>
              <div className="flex flex-wrap gap-1">
                {agent.behavioralBounds.allowedActions.map((a) => (
                  <span key={a} className="text-xs bg-green-500/10 text-green-400 rounded px-2 py-0.5">{a}</span>
                ))}
              </div>
            </div>
            <div>
              <SectionTitle>Forbidden Actions</SectionTitle>
              <div className="flex flex-wrap gap-1">
                {agent.behavioralBounds.forbiddenActions.map((a) => (
                  <span key={a} className="text-xs bg-red-500/10 text-red-400 rounded px-2 py-0.5">{a}</span>
                ))}
              </div>
            </div>
          </div>
          <div>
            <SectionTitle>Tools</SectionTitle>
            <div className="flex flex-wrap gap-1">
              {agent.tools.map((t) => (
                <span key={t} className="text-xs bg-slate-800 text-slate-300 rounded px-2 py-0.5 font-mono">{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Interview Chat Interface ─────────────────────────────────────────────

function InterviewChat({
  provider,
  onComplete,
  onBack,
}: {
  provider: string;
  onComplete: (seedText: string) => void;
  onBack: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InterviewAnswer[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [scrollToBottom]);

  // Start interview on mount
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const res = await api.seed.interviewStart({ companyType: 'new', provider });
        if (cancelled) return;
        setSessionId(res.sessionId);
        setCurrentQuestion(res.step.question);
        setProgress(res.step.progress);
        setStarting(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStarting(false);
      }
    }
    start();
    return () => { cancelled = true; };
  }, [provider]);

  async function handleSubmit() {
    if (!answer.trim() || !sessionId || loading) return;
    const userAnswer = answer.trim();
    setAnswer('');
    setLoading(true);
    setError('');

    // Add to local messages
    setMessages((prev) => [...prev, { question: currentQuestion ?? '', answer: userAnswer, timestamp: new Date().toISOString() }]);
    setCurrentQuestion(null);

    try {
      const step = await api.seed.interviewRespond(sessionId, userAnswer);
      if (step.complete && step.seedText) {
        onComplete(step.seedText);
      } else {
        setCurrentQuestion(step.question);
        setProgress(step.progress);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (starting) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Tell us about your idea</h2>
        <div className="flex items-center gap-3 text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin" />
          Starting interview...
        </div>
        <NavButtons onBack={onBack} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tell us about your idea</h2>
        {progress && <span className="text-xs text-slate-500">{progress}</span>}
      </div>

      {/* Chat messages */}
      <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 max-h-96 overflow-y-auto space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className="space-y-2">
            {/* Question (left) */}
            <div className="flex justify-start">
              <div className="bg-slate-800 rounded-lg rounded-tl-none px-4 py-2 max-w-[80%]">
                <p className="text-sm text-slate-200">{msg.question}</p>
              </div>
            </div>
            {/* Answer (right) */}
            <div className="flex justify-end">
              <div className="bg-sky-600/20 border border-sky-500/20 rounded-lg rounded-tr-none px-4 py-2 max-w-[80%]">
                <p className="text-sm text-sky-100">{msg.answer}</p>
              </div>
            </div>
          </div>
        ))}

        {/* Current question */}
        {currentQuestion && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-lg rounded-tl-none px-4 py-2 max-w-[80%]">
              <p className="text-sm text-slate-200">{currentQuestion}</p>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-lg rounded-tl-none px-4 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      {currentQuestion && !loading && (
        <div className="flex gap-2">
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer..."
            className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
            autoFocus
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!answer.trim()}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            Send
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <NavButtons onBack={onBack} />
    </div>
  );
}

// ── Seed Document Input (paste/upload) ───────────────────────────────────

function SeedDocumentInput({
  isExistingCompany,
  onAnalyze,
  onBack,
}: {
  isExistingCompany: boolean;
  onAnalyze: (seedText: string) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<SeedInputTab>('paste');
  const [pasteText, setPasteText] = useState('');
  const [uploadedText, setUploadedText] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const heading = isExistingCompany ? 'Describe your company' : 'Upload your business plan';
  const helperText = isExistingCompany
    ? 'Include: what your company does, key roles, metrics you track, and what you would like AI agents to handle.'
    : 'Paste your seed document or upload a file. We will analyze it to generate your agent team.';

  const activeText = tab === 'paste' ? pasteText : uploadedText;

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);

    try {
      // Read file as text (for .txt and .md) or base64
      const isPlainText = file.name.endsWith('.txt') || file.name.endsWith('.md');

      if (isPlainText) {
        const text = await file.text();
        setUploadedText(text);
        setUploadFileName(file.name);
      } else {
        // For .docx and .pdf, read as base64 and send to the upload endpoint
        const buffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        const ext = file.name.split('.').pop() ?? 'txt';
        const res = await api.seed.upload({ text: base64, format: ext });
        setUploadedText(res.text);
        setUploadFileName(file.name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <p className="text-sm text-slate-400">{helperText}</p>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setTab('paste')}
          className={clsx(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2',
            tab === 'paste'
              ? 'border-sky-400 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-white',
          )}
        >
          <ClipboardPaste className="w-4 h-4" />
          Paste Text
        </button>
        <button
          type="button"
          onClick={() => setTab('upload')}
          className={clsx(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2',
            tab === 'upload'
              ? 'border-sky-400 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-white',
          )}
        >
          <Upload className="w-4 h-4" />
          Upload File
        </button>
      </div>

      {/* Paste tab */}
      {tab === 'paste' && (
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={isExistingCompany
            ? 'Describe your company, what it does, the roles you need, and what AI agents should handle...'
            : 'Paste your business plan, pitch deck text, or seed document here...'
          }
          rows={14}
          className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-none font-mono"
        />
      )}

      {/* Upload tab */}
      {tab === 'upload' && (
        <div className="space-y-3">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 rounded-lg p-8 text-center cursor-pointer hover:border-slate-600 transition-colors"
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                <span className="text-sm text-slate-400">Processing file...</span>
              </div>
            ) : uploadFileName ? (
              <div className="flex flex-col items-center gap-2">
                <FileText className="w-8 h-8 text-sky-400" />
                <span className="text-sm text-sky-400">{uploadFileName}</span>
                <span className="text-xs text-slate-500">Click to replace</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-slate-500" />
                <span className="text-sm text-slate-400">Click to upload a file</span>
                <span className="text-xs text-slate-500">Accepts .txt, .md, .docx, .pdf</span>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.docx,.pdf"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Preview uploaded text */}
          {uploadedText && (
            <div>
              <SectionTitle>Extracted Text Preview</SectionTitle>
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-48 overflow-y-auto">
                <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono">
                  {uploadedText.length > 2000 ? uploadedText.slice(0, 2000) + '\n\n[... truncated for preview]' : uploadedText}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <NavButtons
        onBack={onBack}
        onNext={() => activeText.trim() && onAnalyze(activeText.trim())}
        nextLabel="Analyze"
        nextDisabled={!activeText.trim()}
      />
    </div>
  );
}

// ── Plan Review Step ─────────────────────────────────────────────────────

function PlanReview({
  plan,
  onApply,
  onBack,
  onUpdatePlan,
}: {
  plan: CompanyPlan;
  onApply: () => void;
  onBack: () => void;
  onUpdatePlan: (plan: CompanyPlan) => void;
}) {
  function removeAgent(name: string) {
    const updated = {
      ...plan,
      agents: plan.agents.filter((a) => a.name !== name),
      teams: plan.teams.map((t) => ({
        ...t,
        members: t.members.filter((m) => m !== name),
      })),
    };
    onUpdatePlan(updated);
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">Review Your Company Plan</h2>

      {/* Company Overview */}
      <Card>
        <div className="flex items-start gap-3">
          <Building2 className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-base">{plan.company.name}</h3>
            <p className="text-sm text-slate-400 mt-1">{plan.company.description}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
              {plan.company.industry && (
                <span>Industry: <span className="text-slate-300">{plan.company.industry}</span></span>
              )}
              {plan.company.stage && (
                <span>Stage: <span className="text-slate-300">{plan.company.stage}</span></span>
              )}
              {plan.company.revenueModel && (
                <span>Revenue: <span className="text-slate-300">{plan.company.revenueModel}</span></span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Agent Team */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-5 h-5 text-sky-400" />
          <h3 className="text-sm font-semibold">Agent Team ({plan.agents.length} agents)</h3>
        </div>
        <div className="space-y-2">
          {plan.agents.map((agent) => (
            <AgentRow
              key={agent.name}
              agent={agent}
              onRemove={() => removeAgent(agent.name)}
            />
          ))}
        </div>
      </div>

      {/* Teams */}
      {plan.teams.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-5 h-5 text-sky-400" />
            <h3 className="text-sm font-semibold">Teams ({plan.teams.length})</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {plan.teams.map((team) => (
              <Card key={team.name}>
                <div className="font-medium text-sm">{team.displayName}</div>
                <div className="text-xs text-slate-400 mt-1">{team.description}</div>
                <div className="text-xs text-slate-500 mt-2">
                  Orchestrator: <span className="text-slate-300">{team.orchestrator}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Members: <span className="text-slate-300">{team.members.join(', ')}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge Files */}
      {Object.keys(plan.knowledge).length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-5 h-5 text-sky-400" />
            <h3 className="text-sm font-semibold">Knowledge Files ({Object.keys(plan.knowledge).length})</h3>
          </div>
          <Card>
            <div className="space-y-1">
              {Object.keys(plan.knowledge).map((filename) => (
                <div key={filename} className="flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-slate-500" />
                  <span className="font-mono text-xs text-slate-300">{filename}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Tool Gaps */}
      {plan.toolGaps.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-sm font-semibold">Tool Gaps ({plan.toolGaps.length})</h3>
          </div>
          <Card className="space-y-3">
            <p className="text-xs text-slate-500">
              These capabilities were mentioned but need custom tools.
            </p>
            {plan.toolGaps.map((gap, i) => (
              <div key={i} className="flex items-start gap-3 border-t border-slate-800 pt-3 first:border-0 first:pt-0">
                <span className={clsx('text-xs px-2 py-0.5 rounded border shrink-0 mt-0.5', priorityColors[gap.priority])}>
                  {gap.priority}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{gap.capability}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{gap.suggestion}</div>
                  <div className="text-xs text-slate-600 mt-0.5">Referenced in: {gap.mentionedIn}</div>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Workflows */}
      {plan.workflows.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="w-5 h-5 text-sky-400" />
            <h3 className="text-sm font-semibold">Workflows ({plan.workflows.length})</h3>
          </div>
          <div className="space-y-2">
            {plan.workflows.map((wf) => (
              <Card key={wf.name}>
                <div className="font-medium text-sm">{wf.displayName}</div>
                <div className="text-xs text-slate-400 mt-1">{wf.description}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {wf.steps.length} steps - On failure: {wf.onFailure}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Escalation Rules */}
      {plan.escalationRules.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-sky-400" />
            <h3 className="text-sm font-semibold">Escalation Rules ({plan.escalationRules.length})</h3>
          </div>
          <Card>
            <div className="space-y-2">
              {plan.escalationRules.map((rule, i) => (
                <div key={i} className="text-sm border-l-2 border-sky-500/30 pl-3">
                  <div className="text-slate-300">{rule.description}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Condition: <span className="font-mono">{rule.condition}</span>
                    {' -> '} Target: <span className="text-slate-400">{rule.target}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <NavButtons
        onBack={onBack}
        onNext={onApply}
        nextLabel="Create Company"
        nextVariant="success"
        nextDisabled={plan.agents.length === 0}
      />
    </div>
  );
}

// ── Creating Step (Step 6) ───────────────────────────────────────────────

function CreatingStep({
  plan,
  provider,
  apiKey,
}: {
  plan: CompanyPlan;
  provider: string;
  apiKey: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'creating' | 'done' | 'error'>('creating');
  const [filesWritten, setFilesWritten] = useState<string[]>([]);
  const [createdAgents, setCreatedAgents] = useState<{ id: string; name: string; displayName: string; role: string }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function apply() {
      try {
        // Store API key first if needed
        const selectedProvider = providers.find((p) => p.id === provider);
        if (selectedProvider?.needsKey && apiKey) {
          await api.auth.connectKey(provider, apiKey);
        }

        const res = await api.seed.apply({ plan, provider });
        if (cancelled) return;
        setFilesWritten(res.filesWritten);
        setCreatedAgents(res.agents);
        setStatus('done');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    }

    apply();
    return () => { cancelled = true; };
  }, [plan, provider, apiKey]);

  if (status === 'creating') {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">Creating Your Company</h2>
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-sky-500/20 rounded-full" />
            <div className="w-16 h-16 border-4 border-sky-500 border-t-transparent rounded-full animate-spin absolute inset-0" />
          </div>
          <div className="text-center">
            <p className="text-sm text-slate-300">Setting up {plan.company.name}...</p>
            <p className="text-xs text-slate-500 mt-1">
              Writing agent definitions, knowledge files, and configurations
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
        <p className="text-sm text-slate-400">
          You can try again or go back to review the plan.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="w-6 h-6 text-green-400" />
        <h2 className="text-lg font-semibold">Company Created</h2>
      </div>

      <Card>
        <SectionTitle>Agents Created ({createdAgents.length})</SectionTitle>
        <div className="space-y-1">
          {createdAgents.map((agent) => (
            <div key={agent.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-sky-400" />
                <span className="font-medium">{agent.displayName}</span>
              </div>
              <span className="text-xs text-slate-500">{agent.role}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>Files Written ({filesWritten.length})</SectionTitle>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {filesWritten.map((f) => (
            <div key={f} className="text-xs text-slate-400 font-mono flex items-center gap-2">
              <FileText className="w-3 h-3 text-slate-600 shrink-0" />
              {f}
            </div>
          ))}
        </div>
      </Card>

      <button
        type="button"
        onClick={() => router.push('/')}
        className="w-full px-4 py-3 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
      >
        Go to Dashboard
      </button>
    </div>
  );
}

// ── Main Setup Page ──────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const { data: status } = useSWR('status', () => api.status(), { refreshInterval: 5000 });

  // Shared state
  const [step, setStep] = useState<Step>(1);
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [cloudToken, setCloudToken] = useState('');
  const [error, setError] = useState('');

  // Step 3: company type
  const [companyType, setCompanyType] = useState<CompanyTypeChoice | ''>('');

  // Template flow (Option D)
  const [template, setTemplate] = useState('');
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);

  // Seed flow (Options A/B/C)
  const [, setSeedText] = useState('');
  const [plan, setPlan] = useState<CompanyPlan | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Cloud / env-key detection
  const [keyFromEnv, setKeyFromEnv] = useState(false);
  const isCloud = status?.isCloud ?? false;

  // Auto-skip to step 3 when provider is already connected via env var
  useEffect(() => {
    if (!status) return;
    if (status.providerConnected && status.connectedProvider && step === 1) {
      setProvider(status.connectedProvider);
      setKeyFromEnv(true);
      setStep(3);
    }
  }, [status, step]);

  const selectedProvider = providers.find((p) => p.id === provider);

  // Determine total steps for progress bar based on flow
  const isTemplateFlow = companyType === 'template';
  // Template flow: 1-2-3-templateSelect-projectName (maps to steps 1,2,3,4(template),5(create))
  // Seed flow: 1-2-3-4(seed)-5(review)-6(create)
  const totalSteps = step <= 3 ? TOTAL_STEPS : (isTemplateFlow ? 5 : TOTAL_STEPS);
  const displayStep = isTemplateFlow && step > 3 ? Math.min(step, 5) : step;

  // Handle template-flow create
  async function handleTemplateCreate() {
    if (!projectName.trim() || !template || !provider) return;
    setCreating(true);
    setError('');
    try {
      if (selectedProvider?.needsKey && apiKey) {
        await api.auth.connectKey(provider, apiKey);
      }
      await api.projects.create({
        template,
        projectName: projectName.trim(),
        provider,
      });
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  // Handle seed analysis
  async function handleAnalyze(text: string) {
    setSeedText(text);
    setAnalyzing(true);
    setError('');
    try {
      const result = await api.seed.analyze({ seedText: text, provider });
      setPlan(result);
      setStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  // Handle interview complete -> analyze the seed text
  async function handleInterviewComplete(generatedSeedText: string) {
    setSeedText(generatedSeedText);
    setAnalyzing(true);
    setError('');
    try {
      const result = await api.seed.analyze({ seedText: generatedSeedText, provider });
      setPlan(result);
      setStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  // Back handler for step 4 (seed flow)
  function handleSeedBack() {
    setStep(3);
    setSeedText('');
    setPlan(null);
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Setup Wizard</h1>

      {/* Already configured shortcut */}
      {status?.configured && (
        <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-4 flex items-center justify-between">
          <span className="text-sky-400 text-sm">Already configured.</span>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="text-sm text-sky-400 hover:text-sky-300 underline"
          >
            Go to overview
          </button>
        </div>
      )}

      {/* Progress bar */}
      <div className="flex gap-2">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
          <div
            key={s}
            className={clsx(
              'h-1.5 flex-1 rounded-full transition-colors',
              s <= displayStep ? 'bg-sky-500' : 'bg-slate-800',
            )}
          />
        ))}
      </div>
      <p className="text-sm text-slate-500">Step {displayStep} of {totalSteps}</p>

      {/* ── Step 1: Provider ─────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">How would you like to run your AI agents?</h2>

          {/* Cloud option */}
          <div>
            <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wide">Easiest</p>
            {providers.filter((p) => p.isCloud).map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={clsx(
                  'w-full border rounded-lg p-4 text-left transition-colors',
                  provider === p.id
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-slate-800 bg-slate-900 hover:border-slate-700',
                )}
              >
                <div className="font-medium text-sm">{p.name}</div>
                <div className="text-xs text-slate-400 mt-1">{p.desc}</div>
              </button>
            ))}
          </div>

          {/* Self-hosted options */}
          <div>
            <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wide">Bring Your Own Key</p>
            <div className="grid grid-cols-3 gap-3">
              {providers.filter((p) => !p.isCloud).map((p) => {
                const disabled = isCloud && p.id === 'ollama';
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => !disabled && setProvider(p.id)}
                    disabled={disabled}
                    className={clsx(
                      'border rounded-lg p-4 text-left transition-colors',
                      disabled
                        ? 'border-slate-800 bg-slate-900/50 opacity-50 cursor-not-allowed'
                        : provider === p.id
                          ? 'border-sky-500 bg-sky-500/10'
                          : 'border-slate-800 bg-slate-900 hover:border-slate-700',
                    )}
                  >
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {disabled ? 'Not available on cloud hosting' : p.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <NavButtons
            onNext={() => provider && setStep(2)}
            nextDisabled={!provider}
          />
        </div>
      )}

      {/* ── Step 2: API Key / Cloud Token ──────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {selectedProvider?.isCloud ? 'ABF Cloud Setup' : 'API Configuration'}
          </h2>
          {selectedProvider?.isCloud ? (
            <div>
              <label className="block text-sm text-slate-400 mb-1">ABF Cloud Token</label>
              <input
                type="password"
                value={cloudToken}
                onChange={(e) => setCloudToken(e.target.value)}
                placeholder="abf_live_..."
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                Get your token at <span className="text-sky-400">cloud.abf.dev</span>. We handle all AI provider access for you.
              </p>
              <Card className="mt-3">
                <p className="text-sm text-slate-300">What you get with ABF Cloud:</p>
                <ul className="text-xs text-slate-400 mt-2 space-y-1">
                  <li>Access to Claude, GPT-4, and other top models</li>
                  <li>No API keys to manage — just one token</li>
                  <li>Usage-based pricing — pay only for what you use</li>
                  <li>Automatic model updates and fallback</li>
                </ul>
              </Card>
            </div>
          ) : selectedProvider?.needsKey && isCloud ? (
            <div className="space-y-3">
              <Card>
                <p className="text-sm text-slate-300 font-medium mb-3">Set your API key in your hosting dashboard</p>
                <ol className="text-sm text-slate-400 space-y-2 list-decimal list-inside">
                  <li>Go to your service&apos;s <span className="text-white">Environment</span> settings</li>
                  <li>Add <code className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-400 text-xs">
                    {provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}
                  </code> with your key</li>
                  <li>The service will restart automatically with the key applied</li>
                </ol>
                {selectedProvider.keyUrl && (
                  <a
                    href={selectedProvider.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-3 text-xs text-sky-400 hover:text-sky-300"
                  >
                    Get your {selectedProvider.name} key &rarr;
                  </a>
                )}
              </Card>
              <p className="text-xs text-slate-500">
                After setting the environment variable, this page will detect it automatically.
              </p>
            </div>
          ) : selectedProvider?.needsKey ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-slate-400">{selectedProvider.name} API Key</label>
                {selectedProvider.keyUrl && (
                  <a
                    href={selectedProvider.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-sky-400 hover:text-sky-300"
                  >
                    Get your key &rarr;
                  </a>
                )}
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              />
              <p className="text-xs text-slate-500 mt-1">Stored encrypted locally. Never sent to ABF servers.</p>
            </div>
          ) : (
            <Card>
              <p className="text-sm text-slate-300">No API key needed for Ollama.</p>
              <p className="text-xs text-slate-500 mt-1">
                Make sure Ollama is running locally on port 11434.
              </p>
            </Card>
          )}
          <NavButtons
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={
              selectedProvider?.isCloud ? !cloudToken :
              (isCloud && !!selectedProvider?.needsKey) ? true :
              (!!selectedProvider?.needsKey && !apiKey)
            }
          />
        </div>
      )}

      {/* ── Step 3: Company Type ─────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          {keyFromEnv && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
              <span className="text-green-400 text-sm">
                Connected to {selectedProvider?.name ?? provider} via environment variable
              </span>
            </div>
          )}
          <h2 className="text-lg font-semibold">What brings you to ABF?</h2>
          <div className="space-y-3">
            {companyTypeOptions.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setCompanyType(opt.id)}
                  className={clsx(
                    'w-full border rounded-lg p-4 text-left transition-colors flex items-start gap-4',
                    companyType === opt.id
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-slate-800 bg-slate-900 hover:border-slate-700',
                  )}
                >
                  <div className={clsx(
                    'w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold',
                    companyType === opt.id
                      ? 'bg-sky-500 text-white'
                      : 'bg-slate-800 text-slate-400',
                  )}>
                    {opt.letter}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className={clsx('w-4 h-4', companyType === opt.id ? 'text-sky-400' : 'text-slate-500')} />
                      <span className="font-medium text-sm">{opt.title}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">{opt.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <NavButtons
            onBack={() => setStep(2)}
            onNext={() => {
              if (!companyType) return;
              setStep(4);
            }}
            nextDisabled={!companyType}
          />
        </div>
      )}

      {/* ── Step 4: Seed / Interview / Template ──────────────────────── */}
      {step === 4 && companyType === 'new-idea' && !analyzing && (
        <InterviewChat
          provider={provider}
          onComplete={handleInterviewComplete}
          onBack={handleSeedBack}
        />
      )}

      {step === 4 && companyType === 'has-document' && (
        <div className={analyzing ? 'hidden' : undefined}>
          <SeedDocumentInput
            isExistingCompany={false}
            onAnalyze={handleAnalyze}
            onBack={handleSeedBack}
          />
        </div>
      )}

      {step === 4 && companyType === 'existing-company' && (
        <div className={analyzing ? 'hidden' : undefined}>
          <SeedDocumentInput
            isExistingCompany={true}
            onAnalyze={handleAnalyze}
            onBack={handleSeedBack}
          />
        </div>
      )}

      {/* Analysis error shown on step 4 when not in analyzing state */}
      {step === 4 && !analyzing && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Analyzing state (shown during seed analysis from any seed path) */}
      {step === 4 && analyzing && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Analyzing your document</h2>
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-sky-500/20 rounded-full" />
              <div className="w-16 h-16 border-4 border-sky-500 border-t-transparent rounded-full animate-spin absolute inset-0" />
            </div>
            <div className="text-center">
              <p className="text-sm text-slate-300">The AI is reading your seed document...</p>
              <p className="text-xs text-slate-500 mt-1">
                Extracting company structure, agent roles, workflows, and tools
              </p>
            </div>
          </div>
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Template flow: Template Selection (step 4) */}
      {step === 4 && companyType === 'template' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Choose a Template</h2>
          <div className="grid grid-cols-2 gap-3">
            {templates.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={clsx(
                  'border rounded-lg p-4 text-left transition-colors',
                  template === t.id
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-slate-800 bg-slate-900 hover:border-slate-700',
                )}
              >
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-slate-400 mt-1">{t.desc}</div>
              </button>
            ))}
          </div>
          <NavButtons
            onBack={() => setStep(3)}
            onNext={() => template && setStep(5)}
            nextDisabled={!template}
          />
        </div>
      )}

      {/* ── Step 5: Review Plan / Template Project Name ──────────────── */}

      {/* Seed flow: Plan Review */}
      {step === 5 && !isTemplateFlow && plan && (
        <PlanReview
          plan={plan}
          onApply={() => setStep(6)}
          onBack={() => {
            setStep(4);
            setPlan(null);
          }}
          onUpdatePlan={setPlan}
        />
      )}

      {/* Template flow: Project Name + Create */}
      {step === 5 && isTemplateFlow && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Name Your Project</h2>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Project Name</label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-business"
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <Card>
            <div className="text-sm space-y-1">
              <div><span className="text-slate-500">Provider:</span> <span>{selectedProvider?.name}</span></div>
              <div><span className="text-slate-500">Template:</span> <span>{templates.find((t) => t.id === template)?.name}</span></div>
            </div>
          </Card>
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
          <NavButtons
            onBack={() => setStep(4)}
            onNext={handleTemplateCreate}
            nextLabel={creating ? 'Creating...' : 'Create Project'}
            nextVariant="success"
            nextDisabled={!projectName.trim()}
            loading={creating}
          />
        </div>
      )}

      {/* ── Step 6: Creating (Seed flow only) ────────────────────────── */}
      {step === 6 && plan && (
        <CreatingStep
          plan={plan}
          provider={provider}
          apiKey={apiKey}
        />
      )}
    </div>
  );
}
