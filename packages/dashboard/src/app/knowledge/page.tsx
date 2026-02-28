'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { Plus, Save, Trash2, FileText } from 'lucide-react';

export default function KnowledgePage() {
  const { data: files, error, mutate } = useSWR('knowledge', () => api.knowledge.list(), {
    refreshInterval: 10000,
  });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  function selectFile(filename: string) {
    const file = files?.find((f) => f.filename === filename);
    if (file) {
      setSelectedFile(filename);
      setEditorContent(file.content);
      setDirty(false);
      setActionError(null);
      setActionSuccess(null);
    }
  }

  async function handleSave() {
    if (!selectedFile) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.knowledge.update(selectedFile, editorContent);
      setDirty(false);
      setActionSuccess('Saved successfully');
      mutate();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) {
      setActionError(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    const filename = newFileName.trim();
    if (!filename) return;
    const finalName = filename.endsWith('.md') ? filename : `${filename}.md`;
    setActionError(null);
    try {
      await api.knowledge.create({ filename: finalName, content: `# ${finalName.replace('.md', '')}\n\n` });
      setShowNewFile(false);
      setNewFileName('');
      await mutate();
      selectFile(finalName);
      setActionSuccess('File created');
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) {
      setActionError(`Failed to create: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleDelete(filename: string) {
    setDeleting(null);
    setActionError(null);
    try {
      await api.knowledge.delete(filename);
      if (selectedFile === filename) {
        setSelectedFile(null);
        setEditorContent('');
        setDirty(false);
      }
      mutate();
      setActionSuccess('File deleted');
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) {
      setActionError(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Knowledge Base</h1>
        <button
          type="button"
          onClick={() => setShowNewFile(true)}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={14} />
          New File
        </button>
      </div>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          Failed to load knowledge files: {error.message}
        </div>
      )}

      {actionError && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300 text-xs ml-4">Dismiss</button>
        </div>
      )}

      {actionSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-green-400 text-sm">
          {actionSuccess}
        </div>
      )}

      {/* New file prompt */}
      {showNewFile && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Create New File</h3>
          <div className="flex gap-2">
            <input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="filename.md"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <button
              type="button"
              onClick={handleCreate}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setShowNewFile(false); setNewFileName(''); }}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6" style={{ minHeight: '500px' }}>
        {/* Left panel: file list */}
        <div className="w-full md:w-64 md:flex-shrink-0 space-y-1">
          <h2 className="text-sm font-medium text-slate-400 mb-2">Files</h2>
          {files && files.length === 0 && (
            <p className="text-sm text-slate-500">No knowledge files yet.</p>
          )}
          {files?.map((file) => (
            <div key={file.filename} className="group relative">
              <button
                type="button"
                onClick={() => selectFile(file.filename)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                  selectedFile === file.filename
                    ? 'bg-sky-500/10 text-sky-400 font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <FileText size={14} className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{file.filename}</div>
                  <div className="text-xs text-slate-500">{formatSize(file.size)}</div>
                </div>
              </button>
              {/* Delete button on hover */}
              {deleting === file.filename ? (
                <div className="absolute right-0 top-0 bottom-0 flex items-center gap-1 pr-1">
                  <button
                    type="button"
                    onClick={() => handleDelete(file.filename)}
                    className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(null)}
                    className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleting(file.filename)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
                  aria-label={`Delete ${file.filename}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Right panel: editor */}
        <div className="flex-1 flex flex-col">
          {selectedFile ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium text-slate-400">
                  Editing: <span className="text-white">{selectedFile}</span>
                  {dirty && <span className="text-amber-400 ml-2">(unsaved)</span>}
                </h2>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
              <textarea
                value={editorContent}
                onChange={(e) => {
                  setEditorContent(e.target.value);
                  setDirty(true);
                }}
                className="flex-1 w-full bg-slate-800 border border-slate-700 rounded-md px-4 py-3 text-sm font-mono focus:outline-none focus:border-sky-500 resize-none"
                spellCheck={false}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-slate-500 text-sm">Select a file to edit, or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
