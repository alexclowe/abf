'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { EventSnapshot } from './use-event-stream';

const BASE = process.env.NEXT_PUBLIC_ABF_API_URL ?? 'http://localhost:3000';

interface EventStreamContextValue {
	data: EventSnapshot | null;
	connected: boolean;
	error: string | null;
}

const EventStreamContext = createContext<EventStreamContextValue>({
	data: null,
	connected: false,
	error: null,
});

/**
 * Provides a single shared SSE connection to /api/events for all child pages.
 * Mount once in RootLayout so all pages share the same EventSource.
 */
export function EventStreamProvider({ children }: { children: ReactNode }) {
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
			retryRef.current = 1000;
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

	return (
		<EventStreamContext.Provider value={{ data, connected, error }}>
			{children}
		</EventStreamContext.Provider>
	);
}

/**
 * Read the shared SSE snapshot from context.
 * Must be used inside EventStreamProvider.
 */
export function useEventStream(): EventStreamContextValue {
	return useContext(EventStreamContext);
}
