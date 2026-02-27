import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { EventStreamProvider } from '@/lib/event-stream-provider';

export const metadata: Metadata = {
  title: 'ABF Dashboard',
  description: 'Agentic Business Framework — Agent Management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 flex min-h-screen">
        <EventStreamProvider>
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
        </EventStreamProvider>
      </body>
    </html>
  );
}
