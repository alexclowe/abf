/**
 * Result combinators for working with multiple Results.
 */

import { ABFError, Err, Ok } from '../types/errors.js';
import type { Result } from '../types/errors.js';

/** Collect an array of Results into a Result of an array. Short-circuits on first error. */
export function collectResults<T, E extends ABFError>(
	results: readonly Result<T, E>[],
): Result<readonly T[], E> {
	const values: T[] = [];
	for (const result of results) {
		if (!result.ok) return result;
		values.push(result.value);
	}
	return Ok(values);
}

/** Try a function, wrapping thrown ABFErrors into Err. */
export function tryResult<T>(fn: () => T): Result<T, ABFError> {
	try {
		return Ok(fn());
	} catch (error) {
		if (error instanceof ABFError) return Err(error);
		throw error; // Re-throw non-ABF errors (programmer bugs)
	}
}

/** Async version of tryResult. */
export async function tryResultAsync<T>(fn: () => Promise<T>): Promise<Result<T, ABFError>> {
	try {
		return Ok(await fn());
	} catch (error) {
		if (error instanceof ABFError) return Err(error);
		throw error;
	}
}
