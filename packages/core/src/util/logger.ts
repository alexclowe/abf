/**
 * Structured logger wrapping pino.
 */

import pino from 'pino';
import type { LogLevel } from '../types/common.js';

export interface LoggerOptions {
	readonly level: LogLevel;
	readonly format: 'json' | 'pretty';
	readonly name?: string | undefined;
}

export function createLogger(options: LoggerOptions): pino.Logger {
	const pinoOptions: pino.LoggerOptions = {
		name: options.name ?? 'abf',
		level: options.level,
	};

	if (options.format === 'pretty') {
		pinoOptions.transport = { target: 'pino-pretty', options: { colorize: true } };
	}

	return pino(pinoOptions);
}
