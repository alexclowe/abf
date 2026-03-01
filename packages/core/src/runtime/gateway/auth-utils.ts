/**
 * Shared authentication utilities for gateway routes.
 */

import { timingSafeEqual } from 'node:crypto';

/** Timing-safe API key comparison to prevent timing attacks. */
export function isValidApiKey(received: string | undefined, required: string): boolean {
	if (!received) return false;
	const expected = `Bearer ${required}`;
	if (received.length !== expected.length) return false;
	return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

/** Escape HTML special characters to prevent XSS. */
export function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Validate that a resolved file path stays within the expected directory.
 * Prevents path traversal attacks (e.g., `../../etc/passwd`).
 */
export function isPathWithinDir(resolvedPath: string, baseDir: string): boolean {
	const normalizedBase = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
	return resolvedPath === baseDir || resolvedPath.startsWith(normalizedBase);
}

/**
 * Sanitize a filename, rejecting any path traversal attempts.
 * Returns null if the name contains traversal characters.
 */
export function sanitizeFilename(name: string): string | null {
	if (name.includes('..') || name.includes('/') || name.includes('\\')) {
		return null;
	}
	// Also reject null bytes
	if (name.includes('\0')) {
		return null;
	}
	return name;
}

/**
 * Detect SQL injection attempts — reject multi-statement queries.
 * Strips quoted strings first to avoid false positives on literal semicolons.
 */
export function containsSqlInjection(sql: string): boolean {
	// Strip single-quoted string literals (handle escaped quotes)
	const stripped = sql.replace(/'(?:[^'\\]|\\.)*'/g, '');
	// Strip double-quoted identifiers
	const stripped2 = stripped.replace(/"(?:[^"\\]|\\.)*"/g, '');

	// Reject SQL comments that could hide statements
	if (/--/.test(stripped2) || /\/\*/.test(stripped2)) {
		return true;
	}

	// Reject semicolons followed by any content (multi-statement)
	if (/;\s*\S/.test(stripped2)) {
		return true;
	}

	return false;
}
