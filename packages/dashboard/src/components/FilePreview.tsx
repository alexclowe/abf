'use client';

import { X, FileText } from 'lucide-react';

interface FilePreviewProps {
  files: File[];
  onRemove: (index: number) => void;
}

export function FilePreview({ files, onRemove }: FilePreviewProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 pt-3">
      {files.map((file, i) => (
        <div
          key={`${file.name}-${i}`}
          className="relative group flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5"
        >
          {file.type.startsWith('image/') ? (
            <img
              src={URL.createObjectURL(file)}
              alt={file.name}
              className="w-12 h-12 object-cover rounded"
            />
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <FileText size={14} className="text-slate-400" />
              <span className="max-w-[120px] truncate">{file.name}</span>
            </div>
          )}
          <button
            onClick={() => onRemove(i)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center bg-slate-600 hover:bg-red-500 rounded-full text-white transition-colors"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
