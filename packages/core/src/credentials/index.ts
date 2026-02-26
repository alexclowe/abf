export type { ICredentialVault } from './vault.js';
export { FilesystemCredentialVault } from './vault.js';

// v2 vault — secure storage with OS Keychain + scrypt
export { VaultV2, createVault } from './vault-v2.js';
export type { IKeychain } from './keychain.js';
export { createKeychain } from './keychain.js';
