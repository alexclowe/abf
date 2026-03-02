/**
 * Terminal prompt utilities — hidden (masked) and visible input.
 *
 * Handles raw mode for API keys and passwords: asterisk echo, backspace,
 * Ctrl+C. Extracted from auth.ts so both `abf auth` and `abf dev` can
 * share the same logic.
 */

import { createInterface } from 'node:readline';

/**
 * Prompt for input with asterisk masking (passwords, API keys).
 * Falls back to plain readline if stdin is not a TTY.
 */
export function promptHidden(question: string): Promise<string> {
	return prompt(question, true);
}

/**
 * Prompt for visible input (non-secret values like URLs).
 */
export function promptVisible(question: string): Promise<string> {
	return prompt(question, false);
}

function prompt(question: string, hidden: boolean): Promise<string> {
	return new Promise((resolve) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });

		if (hidden && process.stdin.isTTY) {
			// Suppress echo for API keys / passwords
			process.stdout.write(question);
			process.stdin.setRawMode(true);
			let input = '';
			process.stdin.on('data', function handler(char: Buffer) {
				const c = char.toString();
				if (c === '\r' || c === '\n') {
					process.stdin.setRawMode(false);
					process.stdin.removeListener('data', handler);
					process.stdout.write('\n');
					rl.close();
					resolve(input);
				} else if (c === '\u0003') {
					// Ctrl+C
					process.stdin.setRawMode(false);
					process.stdout.write('\n');
					process.exit(1);
				} else if (c === '\u007f' || c === '\b') {
					// Backspace
					input = input.slice(0, -1);
				} else {
					input += c;
					process.stdout.write('*');
				}
			});
		} else {
			rl.question(question, (answer) => {
				rl.close();
				resolve(answer.trim());
			});
		}
	});
}
