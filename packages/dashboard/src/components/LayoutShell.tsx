'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Menu, X, Layers } from 'lucide-react';

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      {/* Mobile header bar */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-14 bg-slate-900 border-b border-slate-800 flex items-center px-4 z-40">
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 -ml-1.5 text-slate-400 hover:text-white rounded-md"
          aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
        >
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div className="flex items-center gap-2 ml-3">
          <Layers className="text-sky-400" size={18} />
          <span className="font-bold text-white text-sm tracking-wide">ABF Dashboard</span>
        </div>
      </header>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex min-h-screen">
        {/* Sidebar — slides in on mobile, always visible on desktop */}
        <div
          className={`fixed md:relative z-50 transition-transform duration-200 ease-in-out md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          }`}
        >
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </div>

        <main id="main-content" className="flex-1 overflow-auto pt-14 md:pt-0">
          {children}
        </main>
      </div>
    </>
  );
}
