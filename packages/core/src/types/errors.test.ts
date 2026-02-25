import { describe, expect, it } from 'vitest';
import {
	ABFError,
	ConfigError,
	Err,
	Ok,
	SecurityError,
	flatMapResult,
	mapResult,
	unwrap,
} from './errors.js';

describe('ABFError', () => {
	it('creates errors with code and message', () => {
		const err = new ABFError('CONFIG_NOT_FOUND', 'File missing');
		expect(err.code).toBe('CONFIG_NOT_FOUND');
		expect(err.message).toBe('File missing');
		expect(err.name).toBe('ABFError');
		expect(err.timestamp).toBeTruthy();
	});

	it('supports error subclasses', () => {
		const err = new ConfigError('CONFIG_INVALID', 'Bad YAML', { path: '/foo' });
		expect(err).toBeInstanceOf(ABFError);
		expect(err).toBeInstanceOf(ConfigError);
		expect(err.code).toBe('CONFIG_INVALID');
		expect(err.context).toEqual({ path: '/foo' });
	});

	it('creates SecurityError with context', () => {
		const err = new SecurityError('BOUNDS_VIOLATION', 'Forbidden action');
		expect(err.name).toBe('SecurityError');
		expect(err).toBeInstanceOf(ABFError);
	});
});

describe('Result', () => {
	it('Ok wraps a value', () => {
		const result = Ok(42);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe(42);
	});

	it('Err wraps an error', () => {
		const err = new ABFError('RUNTIME_ERROR', 'oops');
		const result = Err(err);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('RUNTIME_ERROR');
	});

	it('unwrap returns value on Ok', () => {
		expect(unwrap(Ok('hello'))).toBe('hello');
	});

	it('unwrap throws on Err', () => {
		const result = Err(new ABFError('RUNTIME_ERROR', 'fail'));
		expect(() => unwrap(result)).toThrow('fail');
	});

	it('mapResult transforms Ok values', () => {
		const result = mapResult(Ok(5), (n) => n * 2);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe(10);
	});

	it('mapResult passes through Err', () => {
		const err = Err(new ABFError('RUNTIME_ERROR', 'fail'));
		const result = mapResult(err, () => 999);
		expect(result.ok).toBe(false);
	});

	it('flatMapResult chains Results', () => {
		const divide = (a: number, b: number) =>
			b === 0 ? Err(new ABFError('RUNTIME_ERROR', 'divide by zero')) : Ok(a / b);

		const result = flatMapResult(Ok(10), (n) => divide(n, 2));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe(5);

		const errResult = flatMapResult(Ok(10), (n) => divide(n, 0));
		expect(errResult.ok).toBe(false);
	});
});
