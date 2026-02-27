import type { Metadata } from 'next';
import './globals.css';
import { LayoutShell } from '@/components/LayoutShell';
import { EventStreamProvider } from '@/lib/event-stream-provider';

export const metadata: Metadata = {
  title: 'ABF Dashboard',
  description: 'Agentic Business Framework — Agent Management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:bg-sky-600 focus:text-white focus:rounded-md focus:text-sm"
        >
          Skip to content
        </a>
        <EventStreamProvider>
          <LayoutShell>{children}</LayoutShell>
        </EventStreamProvider>
      </body>
    </html>
  );
}
