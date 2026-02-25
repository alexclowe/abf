import { describe, expect, it } from 'vitest';
import { computeChecksum, verifyChecksum } from '../util/checksum.js';
import {
	createAgentId,
	createMessageId,
	createSessionId,
	toISOTimestamp,
	toUSDCents,
	usdCentsToDollars,
} from '../util/id.js';

describe('Branded IDs', () => {
	it('creates agent IDs from names', () => {
		const id = createAgentId('scout');
		expect(id).toBe('scout');
		// At runtime it's a string — branding is compile-time only
		expect(typeof id).toBe('string');
	});

	it('creates unique session IDs', () => {
		const id1 = createSessionId();
		const id2 = createSessionId();
		expect(id1).not.toBe(id2);
		expect(id1.startsWith('ses_')).toBe(true);
	});

	it('creates unique message IDs', () => {
		const id = createMessageId();
		expect(id.startsWith('msg_')).toBe(true);
	});
});

describe('Value Types', () => {
	it('creates ISO timestamps', () => {
		const ts = toISOTimestamp();
		expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('converts dollars to cents', () => {
		expect(toUSDCents(2.0)).toBe(200);
		expect(toUSDCents(0.01)).toBe(1);
		expect(toUSDCents(99.99)).toBe(9999);
	});

	it('converts cents back to dollars', () => {
		const cents = toUSDCents(2.5);
		expect(usdCentsToDollars(cents)).toBe(2.5);
	});
});

describe('Checksum', () => {
	it('computes deterministic SHA-256', () => {
		const a = computeChecksum('hello world');
		const b = computeChecksum('hello world');
		expect(a).toBe(b);
		expect(a.length).toBe(64); // hex SHA-256
	});

	it('verifies matching content', () => {
		const content = 'agent memory content';
		const checksum = computeChecksum(content);
		expect(verifyChecksum(content, checksum)).toBe(true);
	});

	it('rejects modified content', () => {
		const checksum = computeChecksum('original');
		expect(verifyChecksum('modified', checksum)).toBe(false);
	});
});
