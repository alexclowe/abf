/**
 * OS Keychain integration — stores the vault master key in the platform's
 * native credential store (macOS Keychain, Linux libsecret, Windows DPAPI).
 *
 * Uses execFile (not exec) to prevent shell injection.
 * Master key stored as hex string under service="abf", account="vault-master-key".
 */

import { execFile as execFileCb } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export interface IKeychain {
	setMasterKey(key: Buffer): Promise<void>;
	getMasterKey(): Promise<Buffer | null>;
	deleteMasterKey(): Promise<void>;
	isAvailable(): Promise<boolean>;
}

const SERVICE = 'abf';
const ACCOUNT = 'vault-master-key';

/** Default timeout for all keychain subprocess operations (ms). */
const OP_TIMEOUT_MS = 5_000;

/**
 * Validates that a hex string returned from a keychain is exactly a 32-byte
 * (256-bit) key encoded as 64 hex characters.  Returns null if invalid.
 */
function validateHex(raw: string): Buffer | null {
	const hex = raw.trim();
	if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
	return Buffer.from(hex, 'hex');
}

/**
 * Safety check: SERVICE and ACCOUNT must be purely alphanumeric / hyphens.
 * This is enforced at module load time so that the constants can never be
 * changed to something that would allow command-injection via PowerShell
 * `-Command` string interpolation or shell meta-characters.
 */
function assertSafeConstants(): void {
	const SAFE = /^[a-zA-Z0-9_-]+$/;
	if (!SAFE.test(SERVICE) || !SAFE.test(ACCOUNT)) {
		throw new Error(
			'keychain: SERVICE and ACCOUNT constants must be alphanumeric/hyphen/underscore only',
		);
	}
}
assertSafeConstants();

export function createKeychain(): IKeychain {
	switch (platform()) {
		case 'darwin':
			return new MacOSKeychain();
		case 'linux':
			return new LinuxKeychain();
		case 'win32':
			return new WindowsKeychain();
		default:
			return new NoopKeychain();
	}
}

// ─── macOS ──────────────────────────────────────────────────────────

class MacOSKeychain implements IKeychain {
	async isAvailable(): Promise<boolean> {
		try {
			await execFile('which', ['security'], { timeout: OP_TIMEOUT_MS });
			return true;
		} catch {
			return false;
		}
	}

	async setMasterKey(key: Buffer): Promise<void> {
		const hex = key.toString('hex');
		// Delete existing (ignore errors) then add
		try {
			await execFile('security', [
				'delete-generic-password',
				'-s', SERVICE,
				'-a', ACCOUNT,
			], { timeout: OP_TIMEOUT_MS });
		} catch { /* not found — fine */ }

		await execFile('security', [
			'add-generic-password',
			'-s', SERVICE,
			'-a', ACCOUNT,
			'-w', hex,
			'-T', '',  // no app access by default
		], { timeout: OP_TIMEOUT_MS });
	}

	async getMasterKey(): Promise<Buffer | null> {
		try {
			const { stdout } = await execFile('security', [
				'find-generic-password',
				'-s', SERVICE,
				'-a', ACCOUNT,
				'-w',
			], { timeout: OP_TIMEOUT_MS });
			return validateHex(stdout);
		} catch {
			return null;
		}
	}

	async deleteMasterKey(): Promise<void> {
		try {
			await execFile('security', [
				'delete-generic-password',
				'-s', SERVICE,
				'-a', ACCOUNT,
			], { timeout: OP_TIMEOUT_MS });
		} catch { /* not found — fine */ }
	}
}

// ─── Linux ──────────────────────────────────────────────────────────

class LinuxKeychain implements IKeychain {
	/**
	 * Checks that secret-tool exists AND that the underlying keyring daemon
	 * (GNOME Keyring / KDE Wallet via D-Bus) is actually running.
	 *
	 * On WSL2, headless servers, and containers, `secret-tool` is typically
	 * installed but the D-Bus session bus / keyring daemon is not running.
	 * In that scenario, `secret-tool` hangs or errors, which previously
	 * caused silent credential loss.
	 *
	 * Strategy: perform a full store → lookup → clear round-trip with a
	 * disposable probe key to confirm the daemon is operational.
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await execFile('which', ['secret-tool'], { timeout: OP_TIMEOUT_MS });
		} catch {
			return false;
		}

		// Verify the keyring daemon is actually responsive by doing a full
		// round-trip with a throwaway probe value.
		const PROBE_LABEL = 'ABF Probe';
		const PROBE_VALUE = 'abf-probe-ok';
		try {
			// Store a probe value via stdin
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					proc.kill();
					reject(new Error('secret-tool probe store timed out'));
				}, OP_TIMEOUT_MS);

				const proc = execFileCb('secret-tool', [
					'store',
					'--label', PROBE_LABEL,
					'service', SERVICE,
					'account', 'abf-probe-test',
				], (err) => {
					clearTimeout(timer);
					if (err) reject(err);
					else resolve();
				});

				if (!proc.stdin) {
					clearTimeout(timer);
					reject(new Error('secret-tool stdin unavailable'));
					return;
				}
				proc.stdin.write(PROBE_VALUE);
				proc.stdin.end();
			});

			// Look up the probe value
			const { stdout } = await execFile('secret-tool', [
				'lookup',
				'service', SERVICE,
				'account', 'abf-probe-test',
			], { timeout: OP_TIMEOUT_MS });

			if (stdout.trim() !== PROBE_VALUE) {
				return false;
			}

			// Clean up the probe key (best-effort)
			try {
				await execFile('secret-tool', [
					'clear',
					'service', SERVICE,
					'account', 'abf-probe-test',
				], { timeout: OP_TIMEOUT_MS });
			} catch { /* cleanup failure is non-fatal */ }

			return true;
		} catch {
			return false;
		}
	}

	async setMasterKey(key: Buffer): Promise<void> {
		const hex = key.toString('hex');
		// secret-tool reads the secret from stdin
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				proc.kill();
				reject(new Error('secret-tool store timed out'));
			}, OP_TIMEOUT_MS);

			const proc = execFileCb('secret-tool', [
				'store',
				'--label', 'ABF Vault Key',
				'service', SERVICE,
				'account', ACCOUNT,
			], (err) => {
				clearTimeout(timer);
				if (err) reject(err);
				else resolve();
			});

			// If stdin is null the process was spawned without a pipe — reject
			// immediately instead of hanging forever.
			if (!proc.stdin) {
				clearTimeout(timer);
				proc.kill();
				reject(new Error('secret-tool stdin unavailable — cannot write key'));
				return;
			}

			proc.stdin.write(hex);
			proc.stdin.end();
		});
	}

	async getMasterKey(): Promise<Buffer | null> {
		try {
			const { stdout } = await execFile('secret-tool', [
				'lookup',
				'service', SERVICE,
				'account', ACCOUNT,
			], { timeout: OP_TIMEOUT_MS });
			return validateHex(stdout);
		} catch {
			return null;
		}
	}

	async deleteMasterKey(): Promise<void> {
		try {
			await execFile('secret-tool', [
				'clear',
				'service', SERVICE,
				'account', ACCOUNT,
			], { timeout: OP_TIMEOUT_MS });
		} catch { /* not found — fine */ }
	}
}

// ─── Windows ────────────────────────────────────────────────────────

class WindowsKeychain implements IKeychain {
	/**
	 * Checks that PowerShell is available AND that the CredentialManager
	 * module is installed (i.e. `New-StoredCredential` actually resolves).
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await execFile('powershell', [
				'-NoProfile',
				'-Command',
				'Get-Command New-StoredCredential -ErrorAction Stop | Out-Null',
			], { timeout: OP_TIMEOUT_MS });
			return true;
		} catch {
			// CredentialManager module not installed — fall back to scrypt
			return false;
		}
	}

	/**
	 * Stores the master key via PowerShell's CredentialManager module.
	 *
	 * The hex value is passed via stdin to avoid embedding secrets in the
	 * command-line string (which would be visible in process listings).
	 *
	 * SAFETY NOTE: SERVICE and ACCOUNT are compile-time constants validated
	 * at module load (alphanumeric + hyphens only). They are safe to embed
	 * in the `-Command` string. If these constants ever become dynamic,
	 * this code MUST be updated to pass them via stdin or environment
	 * variables to prevent PowerShell command injection.
	 */
	async setMasterKey(key: Buffer): Promise<void> {
		const hex = key.toString('hex');
		// Pass the hex value via stdin to avoid it appearing in the command line.
		// The PowerShell script reads one line from stdin and uses it as the password.
		const script = [
			'$pw = [Console]::In.ReadLine()',
			`New-StoredCredential -Target '${SERVICE}:${ACCOUNT}' -UserName '${ACCOUNT}' -Password $pw -Type Generic -Persist LocalMachine`,
		].join('; ');

		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				proc.kill();
				reject(new Error('powershell store timed out'));
			}, OP_TIMEOUT_MS);

			const proc = execFileCb('powershell', [
				'-NoProfile',
				'-Command',
				script,
			], (err) => {
				clearTimeout(timer);
				if (err) reject(err);
				else resolve();
			});

			if (!proc.stdin) {
				clearTimeout(timer);
				proc.kill();
				reject(new Error('powershell stdin unavailable'));
				return;
			}

			proc.stdin.write(hex);
			proc.stdin.end();
		});
	}

	/**
	 * Reads the master key from Windows Credential Manager.
	 *
	 * SAFETY NOTE: SERVICE and ACCOUNT are validated-safe constants (see
	 * assertSafeConstants). The `-Command` interpolation here is safe only
	 * because those values are guaranteed alphanumeric+hyphen.
	 */
	async getMasterKey(): Promise<Buffer | null> {
		try {
			const { stdout } = await execFile('powershell', [
				'-NoProfile',
				'-Command',
				`(Get-StoredCredential -Target '${SERVICE}:${ACCOUNT}').Password`,
			], { timeout: OP_TIMEOUT_MS });
			return validateHex(stdout);
		} catch {
			return null;
		}
	}

	/**
	 * Deletes the master key from Windows Credential Manager.
	 *
	 * SAFETY NOTE: see getMasterKey — same constant-safety constraint.
	 */
	async deleteMasterKey(): Promise<void> {
		try {
			await execFile('powershell', [
				'-NoProfile',
				'-Command',
				`Remove-StoredCredential -Target '${SERVICE}:${ACCOUNT}'`,
			], { timeout: OP_TIMEOUT_MS });
		} catch { /* not found — fine */ }
	}
}

// ─── Noop (unsupported platforms) ───────────────────────────────────

class NoopKeychain implements IKeychain {
	async isAvailable(): Promise<boolean> {
		return false;
	}
	async setMasterKey(_key: Buffer): Promise<void> {}
	async getMasterKey(): Promise<Buffer | null> {
		return null;
	}
	async deleteMasterKey(): Promise<void> {}
}
