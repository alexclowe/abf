'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Square, Paperclip, Mic, MicOff } from 'lucide-react';
import { FilePreview } from './FilePreview';
import { SLASH_COMMANDS, type SlashCommand } from '@/lib/slash-commands';

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = 'image/*,.pdf,.txt,.md,.csv';

interface ChatInputProps {
  onSend: (text: string, files?: Array<{ type: 'file'; mediaType: string; url: string }>) => void;
  isLoading: boolean;
  onStop: () => void;
  agentId: string;
}

interface AgentOption {
  id: string;
  name: string;
  displayName: string;
  role: string;
}

async function fileToDataUrl(file: File): Promise<{ type: 'file'; mediaType: string; url: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ type: 'file', mediaType: file.type, url: reader.result as string });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatInput({ onSend, isLoading, onStop, agentId }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<ReturnType<typeof createRecognition> | null>(null);

  // Auto-resize textarea on content change
  function resizeTextarea() {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }

  // Fetch agents for @mentions (cached)
  useEffect(() => {
    const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? '';
    const API_KEY = process.env.NEXT_PUBLIC_ABF_API_KEY;
    fetch(`${BASE}/api/agents`, {
      headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
    })
      .then((r) => r.json())
      .then((data: AgentOption[]) => setAgents(data))
      .catch(() => {});
  }, []);

  function addFiles(newFiles: File[]) {
    const valid = newFiles.filter((f) => f.size <= MAX_FILE_SIZE);
    setFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if ((!input.trim() && files.length === 0) || isLoading) return;

    // Check for slash commands
    if (input.startsWith('/')) {
      const parts = input.split(' ');
      const cmdName = parts[0]!.slice(1);
      const cmd = SLASH_COMMANDS.find((c) => c.name === cmdName);
      if (cmd) {
        const args = parts.slice(1).join(' ');
        cmd.execute(args, agentId);
        setInput('');
        setShowSlashMenu(false);
        return;
      }
    }

    let fileParts: Array<{ type: 'file'; mediaType: string; url: string }> | undefined;
    if (files.length > 0) {
      fileParts = await Promise.all(files.map(fileToDataUrl));
    }

    onSend(input.trim(), fileParts);
    setInput('');
    setFiles([]);
    setShowSlashMenu(false);
    setShowMentionMenu(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInput(val);
    resizeTextarea();

    // Slash command detection
    if (val.startsWith('/')) {
      const filter = val.slice(1).split(' ')[0] ?? '';
      setSlashFilter(filter);
      setShowSlashMenu(!val.includes(' ')); // Hide after first space (args entered)
    } else {
      setShowSlashMenu(false);
    }

    // @mention detection
    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0 && (lastAt === 0 || val[lastAt - 1] === ' ')) {
      const afterAt = val.slice(lastAt + 1);
      if (!afterAt.includes(' ')) {
        setMentionFilter(afterAt);
        setShowMentionMenu(true);
        return;
      }
    }
    setShowMentionMenu(false);
  }

  function insertMention(agent: AgentOption) {
    const lastAt = input.lastIndexOf('@');
    const before = input.slice(0, lastAt);
    setInput(`${before}@${agent.name} `);
    setShowMentionMenu(false);
    textareaRef.current?.focus();
  }

  function selectSlashCommand(cmd: SlashCommand) {
    setInput(`/${cmd.name} `);
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  }

  // Drag and drop handlers
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    addFiles(dropped);
  }

  // Paste handler for images
  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.files;
    if (items.length > 0) {
      e.preventDefault();
      addFiles(Array.from(items));
    }
  }

  // Voice input
  const hasSpeech = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  function toggleVoice() {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const recognition = createRecognition();
    if (!recognition) return;

    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i]![0]!.transcript;
      }
      setInput((prev) => {
        // Replace from the start of voice input
        const base = prev.replace(/\[voice\].*$/, '');
        return base + transcript;
      });
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.start();
    setIsRecording(true);
  }

  // Filter data
  const filteredSlashCommands = SLASH_COMMANDS.filter((c) =>
    c.name.startsWith(slashFilter),
  );

  const filteredAgents = agents.filter(
    (a) =>
      a.id !== agentId &&
      (a.name.toLowerCase().includes(mentionFilter.toLowerCase()) ||
        a.displayName.toLowerCase().includes(mentionFilter.toLowerCase())),
  );

  return (
    <div
      className="relative border-t border-slate-800 bg-slate-900"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragging && (
        <div className="absolute inset-0 bg-sky-500/10 border-2 border-dashed border-sky-500 rounded-lg z-10 flex items-center justify-center">
          <span className="text-sky-400 text-sm font-medium">Drop files here</span>
        </div>
      )}

      {/* Slash command menu */}
      {showSlashMenu && filteredSlashCommands.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 bg-slate-800 border border-slate-700 rounded-lg shadow-lg py-1 w-64 z-20">
          {filteredSlashCommands.map((cmd) => (
            <button
              type="button"
              key={cmd.name}
              onClick={() => selectSlashCommand(cmd)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-700 transition-colors"
            >
              <span className="text-sky-400 font-mono">/{cmd.name}</span>
              <span className="text-slate-400 ml-2">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* @mention menu */}
      {showMentionMenu && filteredAgents.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 bg-slate-800 border border-slate-700 rounded-lg shadow-lg py-1 w-64 z-20">
          {filteredAgents.slice(0, 6).map((agent) => (
            <button
              type="button"
              key={agent.id}
              onClick={() => insertMention(agent)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-700 transition-colors"
            >
              <span className="text-sky-400">@{agent.name}</span>
              <span className="text-slate-500 ml-2 text-xs">{agent.role}</span>
            </button>
          ))}
        </div>
      )}

      {/* File previews */}
      <FilePreview files={files} onRemove={removeFile} />

      {/* Input area */}
      <div className="flex items-end gap-2 p-4">
        {/* File upload button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 p-2 text-slate-400 hover:text-white transition-colors"
          title="Attach files"
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              addFiles(Array.from(e.target.files));
              e.target.value = '';
            }
          }}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type a message... (/ for commands, @ to mention)"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-sky-500 placeholder-slate-500 resize-none min-h-[42px] max-h-[200px]"
          rows={1}
          disabled={isLoading}
        />

        {/* Voice input */}
        {hasSpeech && (
          <button
            type="button"
            onClick={toggleVoice}
            className={`flex-shrink-0 p-2 transition-colors ${
              isRecording
                ? 'text-red-400 animate-pulse'
                : 'text-slate-400 hover:text-white'
            }`}
            title={isRecording ? 'Stop recording' : 'Voice input'}
          >
            {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}

        {/* Send / Stop */}
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Square size={14} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() && files.length === 0}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Send size={14} />
            Send
          </button>
        )}
      </div>
    </div>
  );
}

// Create SpeechRecognition instance (browser-specific)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createRecognition(): any {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return SR ? new SR() : null;
}
