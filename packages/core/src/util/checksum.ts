/**
 * SHA-256 checksums for memory integrity.
 */

import { createHash } from 'node:crypto';
import type { Checksum } from '../types/common.js';

export function computeChecksum(content: string): Checksum {
	return createHash('sha256').update(content, 'utf8').digest('hex') as Checksum;
}

export function verifyChecksum(content: string, expected: Checksum): boolean {
	return computeChecksum(content) === expected;
}
