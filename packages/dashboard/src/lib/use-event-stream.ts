'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? 'http://localhost:3000';

export interface EventSnapshot {
  status: { version: string; uptime: number; agents: number };
  runtime: Record<string, unknown>;
  agents: Record<string, unknown>[];
  escalations: { id: string; type: string; agentId: string; message: string; target: string; resolved: boolean; timestamp: string }[];
}

interface UseEventStreamResult {
  data: EventSnapshot | null;
  connected: boolean;
  error: string | null;
}

/**
 * Hook that opens a single SSE connection to /api/events.
 * Returns the latest snapshot, connection state, and any error.
 * Reconnects with exponential backoff on disconnect.
 */
export function useEventStream(): UseEventStreamResult {
  const [data, setData] = useState<EventSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(1000);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    const apiKey = process.env.NEXT_PUBLIC_ABF_API_KEY;
    const url = apiKey
      ? `${BASE}/api/events?token=${encodeURIComponent(apiKey)}`
      : `${BASE}/api/events`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
      retryRef.current = 1000; // reset backoff
    };

    es.addEventListener('snapshot', (event) => {
      try {
        const parsed = JSON.parse(event.data) as EventSnapshot;
        setData(parsed);
      } catch {
        // Ignore malformed events
      }
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      // Reconnect with exponential backoff (max 30s)
      const delay = retryRef.current;
      retryRef.current = Math.min(delay * 2, 30000);
      setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);

  return { data, connected, error };
}
