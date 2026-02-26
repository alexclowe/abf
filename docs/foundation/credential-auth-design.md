# Credential & Authentication Design

## Problem Statement

ABF claims two users: Operators (non-technical) and Builders (developers). Today, **both** must:

1. Obtain an API key from a provider's developer console
2. Open a terminal
3. Run `abf auth <provider>` or export an env var

This is a hard blocker for non-technical operators. It's also insecure: the current vault derives its encryption key from `hostname + username` — public information. Anyone with file access can decrypt every stored key.

## Goals

1. **Zero-terminal setup** — Operator clicks a button in the Dashboard (or desktop app), authenticates with their LLM provider, and is done
2. **Secure storage** — Keys encrypted with a real secret (OS keychain, master password, or hardware-backed)
3. **Multiple auth paths** — OAuth where providers allow it, best-in-class guided key collection otherwise, local (Ollama) with no auth at all
4. **Builder escape hatch** — Env vars and CLI still work for CI/CD, scripts, and power users

## Provider OAuth Landscape (as of early 2026)

| Provider | OAuth technically possible? | OAuth allowed for third parties? | What exists |
|----------|---------------------------|--------------------------------|-------------|
| **Anthropic** | Yes | **Not yet** — policy restricts OAuth to Claude Code and Claude.ai. Third-party use of OAuth tokens "not permitted." | PKCE flow to `console.anthropic.com`. Scopes: `org:create_api_key`, `user:inference`. |
| **OpenAI** | Yes | **Not yet** — Codex OAuth restricted to "personal development use only, not for commercial services." | PKCE flow for ChatGPT Plus/Pro subscriptions. Used by Codex CLI. |
| **Ollama** | N/A | N/A | Local. No auth. Just a base URL. |

### What This Means

Both Anthropic and OpenAI have working OAuth PKCE flows, but **both restrict them to first-party tools** (Claude Code, Codex CLI). Tools like Cursor and Windsurf obtained access through partnership agreements, not by using public OAuth endpoints.

**Our strategy:**
1. **Ship now** with best-in-class guided key collection — no terminal needed, Dashboard-only
2. **Build the OAuth plumbing** so it's ready — when partnerships close, it's a config change
3. **Pursue partnerships** with Anthropic and OpenAI for authorized OAuth client_ids
4. **Ollama** works today with zero auth — the real "one-click" story for operators who want privacy

## Design: Three Authentication Paths

```
+------------------------------------------------------------------+
|                      ABF Auth System                              |
|                                                                   |
|  +-------------------+  +-------------------+  +--------------+  |
|  |  Path 1:          |  |  Path 2:          |  |  Path 3:     |  |
|  |  OAuth Flow       |  |  Guided Key       |  |  Local       |  |
|  |                   |  |  Collection       |  |  (Ollama)    |  |
|  |  (Future --       |  |                   |  |              |  |
|  |   requires        |  |  (Anthropic,      |  |  Auto-detect |  |
|  |   partnership)    |  |   OpenAI, Brave,  |  |  on :11434   |  |
|  |                   |  |   any API key)    |  |  No setup    |  |
|  |  Browser popup -> |  |                   |  |              |  |
|  |  provider login ->|  |  Dashboard modal  |  |              |  |
|  |  callback ->      |  |  with deep links, |  |              |  |
|  |  store token      |  |  validation,      |  |              |  |
|  |                   |  |  visual steps     |  |              |  |
|  +-------------------+  +-------------------+  +--------------+  |
|            |                      |                    |          |
|            +----------------------+--------------------+          |
|                                   |                               |
|                                   v                               |
|                    +-------------------------+                    |
|                    |     Secure Vault v2      |                    |
|                    |                          |                    |
|                    |  1. OS Keychain (pref)   |                    |
|                    |  2. Master Password      |                    |
|                    |  3. Env vars (override)  |                    |
|                    +-------------------------+                    |
+------------------------------------------------------------------+
```

---

## Path 1: OAuth Flow (Future -- Partnership Required)

### How It Will Work (Architecture Ready, Awaiting Authorization)

Both Anthropic and OpenAI use PKCE OAuth -- no client_secret needed, safe for local/desktop apps. The flow is identical for both:

```
User clicks "Sign in with [Provider]" in Dashboard
        |
        v
Dashboard calls: POST /auth/start/anthropic (or openai)
        |
        v
Gateway generates PKCE challenge + CSRF state, returns { authUrl }
        |
        v
Dashboard opens browser popup to authUrl:
  https://console.anthropic.com/oauth/authorize   (or auth.openai.com)
  ?response_type=code
  &client_id={ABF_REGISTERED_CLIENT_ID}
  &redirect_uri=http://localhost:{port}/auth/callback/{provider}
  &scope=org:create_api_key                        (or openai equivalent)
  &code_challenge={SHA256_CHALLENGE}
  &code_challenge_method=S256
  &state={CSRF_TOKEN}
        |
        v
User logs in (or is already logged in) -> approves
        |
        v
Provider redirects to localhost callback with auth code
        |
        v
Gateway exchanges code for API key / access token
        |
        v
Stores in Secure Vault v2 -> Dashboard shows "Connected"
```

**Blockers before shipping:**
- Anthropic: Need registered `client_id` -- apply at developer portal or through partnership
- OpenAI: Need authorized access to Codex OAuth for commercial use

**Implementation approach:** Build the full OAuth module now (PKCE, state management, callback handler, token storage). Gate it behind a feature flag. When a client_id is obtained, flip the flag.

### Anthropic-Specific Notes
- Auth endpoint: `https://console.anthropic.com/oauth/authorize`
- Token endpoint: `https://console.anthropic.com/oauth/token`
- Scopes: `org:create_api_key` (creates permanent key), `user:inference` (direct subscription access)
- Response format: `code#state` (note: hash fragment, not query param -- needs special parsing)
- Reference implementation: `anthropic-auth` crate, Claude Code source

### OpenAI-Specific Notes
- Auth: PKCE flow through ChatGPT authentication
- Access: Tied to ChatGPT Plus/Pro subscription
- Tokens: Auto-refresh when within 5 minutes of expiry
- Models available: GPT-4o, GPT-5, o-series (via subscription, not API credits)
- Reference implementation: `opencode-openai-codex-auth` npm package

---

## Path 2: Guided Key Collection (Ship Now -- Primary Path)

For all API-key-based providers. This is the **primary auth path** until OAuth partnerships are in place.

### Provider Configurations

```typescript
const PROVIDER_AUTH_CONFIGS = {
  anthropic: {
    displayName: 'Anthropic (Claude)',
    keyPrefix: 'sk-ant-',
    deepLink: 'https://console.anthropic.com/settings/keys',
    validationEndpoint: 'https://api.anthropic.com/v1/messages',
    validationMethod: 'POST',  // minimal request to verify key
    steps: [
      'Open your Anthropic Console',
      'Go to Settings -> API Keys',
      'Click "Create Key", name it "ABF"',
      'Copy and paste the key below',
    ],
  },
  openai: {
    displayName: 'OpenAI (GPT)',
    keyPrefix: 'sk-',
    deepLink: 'https://platform.openai.com/api-keys',
    validationEndpoint: 'https://api.openai.com/v1/models',
    validationMethod: 'GET',
    steps: [
      'Open your OpenAI Platform',
      'Navigate to API Keys',
      'Click "Create new secret key", name it "ABF"',
      'Copy and paste the key below',
    ],
  },
  'brave-search': {
    displayName: 'Brave Search',
    keyPrefix: 'BSA',
    deepLink: 'https://api.search.brave.com/app/keys',
    validationEndpoint: 'https://api.search.brave.com/res/v1/web/search?q=test&count=1',
    validationMethod: 'GET',
    steps: [
      'Open Brave Search API dashboard',
      'Create a new API key',
      'Copy and paste the key below',
    ],
    optional: true,
    description: 'Enables the web-search tool for agents',
  },
} as const;
```

### Dashboard Flow

```
User clicks "Connect" next to a provider
        |
        v
+---------------------------------------------------------+
|  Connect Anthropic (Claude)                         [X] |
|                                                         |
|  +-----------------------------------------------------+
|  | 1  Open your Anthropic Console                      |
|  |    [Open console.anthropic.com ->]  (new tab)       |
|  |                                                      |
|  | 2  Go to Settings -> API Keys                       |
|  |                                                      |
|  | 3  Click "Create Key", name it "ABF"                |
|  |                                                      |
|  | 4  Copy and paste the key below                     |
|  +-----------------------------------------------------+
|                                                         |
|  +-----------------------------------------------------+
|  | sk-ant-***************************************      |
|  +-----------------------------------------------------+
|                                                         |
|  +-- Status ----------------------------------------+   |
|  |  Paste your API key above to get started          |   |
|  |                                                   |   |
|  |  After paste, states cycle through:               |   |
|  |  - Validating...                                  |   |
|  |  - Key valid -- 3 models available                |   |
|  |  - Invalid key -- check and try again             |   |
|  +---------------------------------------------------+   |
|                                                         |
|  Encrypted on your machine. Never sent to ABF.          |
|                                                         |
|                              [Save & Connect]  [Cancel] |
+---------------------------------------------------------+
```

**UX principles:**
- **`input type="password"`** -- key masked after entry, no clipboard copy-back, not visible in DOM
- **Instant validation** -- on paste (not on submit), hit the provider's lightweight endpoint to confirm the key works. Show model count on success.
- **Deep link** -- "Open console.anthropic.com" goes directly to the API keys page with `target="_blank"`
- **Clear security messaging** -- "Encrypted on your machine. Never sent to ABF."
- **Prefix validation** -- client-side check for expected prefix (`sk-ant-`, `sk-`, `BSA`) before hitting the network
- **No retry fatigue** -- if validation fails, don't clear the input. Let user fix the paste.

### Gateway Route: POST /auth/key/:provider

```typescript
// Validation logic per provider
async function validateKey(provider: string, key: string): Promise<ValidationResult> {
  const config = PROVIDER_AUTH_CONFIGS[provider];
  if (!config) return { valid: false, error: 'Unknown provider' };

  // 1. Prefix check
  if (!key.startsWith(config.keyPrefix)) {
    return { valid: false, error: `Key should start with "${config.keyPrefix}"` };
  }

  // 2. Network validation -- hit provider's API with minimal request
  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    };

    // Anthropic uses x-api-key header instead of Bearer
    if (provider === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2024-01-01';
      delete headers['Authorization'];
    }

    const fetchOptions: RequestInit = {
      method: config.validationMethod,
      headers,
      signal: AbortSignal.timeout(10_000),
    };

    // Anthropic POST needs a minimal body
    if (config.validationMethod === 'POST') {
      fetchOptions.body = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
    }

    const resp = await fetch(config.validationEndpoint, fetchOptions);

    if (resp.status === 401 || resp.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Could not reach provider. Check your connection.' };
  }
}
```

**Security for key collection:**
- Key accepted only via POST body (never URL params, never query strings)
- Key validated immediately -- invalid keys are never stored
- On successful validation: key goes directly into Vault v2, cleared from request memory
- Rate limited: 5 validation attempts per minute per provider (prevents brute-force probing)
- No localStorage, no sessionStorage, no cookies -- key exists only in memory during the POST
- Gateway logs "credential_stored" event to audit trail (NOT the key itself)

---

## Path 3: Local / Ollama (Zero Auth)

```
User selects "Run Locally" in Dashboard
        |
        v
Gateway probes localhost:11434/api/tags
        |
        +-- Response 200 -> Parse models list
        |   |
        |   v
        |  +-------------------------------------+
        |  |  Ollama detected                     |
        |  |                                      |
        |  |  Available models:                   |
        |  |  - llama3 (8B)                       |
        |  |  - mistral (7B)                      |
        |  |  - nomic-embed-text (embedding)      |
        |  |                                      |
        |  |  [Use Ollama ->]                     |
        |  +-------------------------------------+
        |
        +-- Connection refused -> Show install guide
            |
            v
           +---------------------------------------------+
           |  Ollama not detected                         |
           |                                              |
           |  Ollama runs AI models locally on your       |
           |  machine -- free, private, no API key needed.|
           |                                              |
           |  1. Download Ollama:                         |
           |     [Download for macOS ->]                  |
           |     [Download for Windows ->]                |
           |     [Download for Linux ->]                  |
           |                                              |
           |  2. Install and start Ollama                 |
           |                                              |
           |  3. Pull a model (in your terminal):         |
           |     +----------------------------+           |
           |     | ollama pull llama3    [Copy]|           |
           |     +----------------------------+           |
           |                                              |
           |  [Check again]                               |
           +---------------------------------------------+
```

For the desktop installer: bundle Ollama or auto-detect and guide install.

---

## Path 4: ABF Cloud — Managed Keys (Future)

The ultimate operator experience: **no API keys at all**. User pays ABF, ABF provides LLM access.

```
User signs up at abf.cloud
        |
        v
Chooses plan (usage-based or flat monthly)
        |
        v
ABF Cloud provisions a project with:
  - ABF Cloud API token (one opaque token, not per-provider)
  - Requests routed through ABF Cloud proxy
  - ABF's pooled Anthropic/OpenAI keys handle the LLM calls
  - Usage metered per-token, billed monthly
        |
        v
User never sees an API key. AI just works.
```

### How It Works (Proxy Billing)

- ABF Cloud holds **pool API keys** for each LLM provider (Anthropic, OpenAI, etc.)
- User's agent sessions route through ABF Cloud's gateway
- ABF Cloud meters usage (tokens in/out, tool calls, sessions) per user
- User pays ABF a margin on top of raw API costs (e.g., 1.2-1.5x markup)
- Provider-level keys are never exposed to users

### Pricing Tiers

| Tier | Keys | Billing | Target |
|------|------|---------|--------|
| **Free / Self-hosted** | Bring your own | Pay providers directly | Builders, tinkerers |
| **ABF Cloud** | ABF provides | Usage-based or flat monthly | Operators, small teams |
| **Enterprise** | Dedicated pool or BYOK | Custom contracts, SLAs | Companies with compliance needs |

### Architecture Notes

- ABF Cloud runtime is the same `@abf/core` — just deployed with ABF-owned credentials
- The `ICredentialVault` interface stays the same; Cloud vault resolves to ABF's pool keys
- Usage tracking layer sits between Session Manager and Provider, counting tokens
- Dashboard shows real-time cost: "This session cost $0.12" / "This month: $47.30"
- User's `abf.config.yaml` only needs: `cloud: { token: 'abf_...' }` — one value, not per-provider

### Why This Solves Everything

- **No API key management** — the entire problem disappears
- **No OAuth partnerships needed** — ABF uses its own API keys, not user OAuth tokens
- **Provider-agnostic billing** — user pays one bill, ABF handles multi-provider routing
- **Model switching is free** — operator changes agent from Claude to GPT in Dashboard, no new key needed
- **Predictable pricing** — flat tiers possible (e.g., "$49/mo for 100 agent sessions")

---

## Secure Vault v2

The current vault (`vault.ts`) encrypts with `SHA-256(hostname:username)` -- deterministic and guessable. Anyone who knows the machine hostname and username (trivially discoverable) can decrypt every stored API key. Vault v2 fixes this.

### Storage Backends (ordered by preference)

| Backend | How it works | When to use |
|---------|-------------|-------------|
| **OS Keychain** (preferred) | macOS Keychain, Windows DPAPI/Credential Mgr, Linux libsecret (GNOME Keyring / KDE Wallet). ABF stores a 256-bit master key in keychain; vault file encrypted with that master key. Keys protected by OS login + secure enclave. | Desktop app, dev machines |
| **Master Password** | User sets a password at first run. Derived via Argon2id (memory=64MB, time=3, parallelism=1) to 256-bit key. Salt stored alongside vault. Password prompted on startup or read from `ABF_VAULT_PASSWORD` env var. | Headless servers, CI where no keychain available |
| **Machine Key** (legacy) | Current behavior: `SHA-256(hostname:user)`. Only used for migration from v1 vault. On first v2 startup: decrypt v1, re-encrypt with OS Keychain or Master Password. | **DEPRECATED** -- migrate on first run |
| **Env Vars** (override) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. Always checked first. No vault interaction. Existing behavior preserved. | Always works. CI/CD, Docker |

### OS Keychain Integration

```typescript
interface IKeychain {
  /** Store the vault master key in OS keychain */
  setMasterKey(key: Buffer): Promise<void>;
  /** Retrieve the vault master key from OS keychain */
  getMasterKey(): Promise<Buffer | null>;
  /** Delete the vault master key */
  deleteMasterKey(): Promise<void>;
  /** Check if OS keychain is available */
  isAvailable(): Promise<boolean>;
}

// Platform implementations use execFile (not exec) to prevent shell injection:
// - macOS: execFile('security', ['find-generic-password', ...])
// - Windows: execFile('powershell', ['-Command', ...]) with CredentialManager
// - Linux: execFile('secret-tool', ['lookup', ...]) for GNOME Keyring
//
// All implementations: service="abf", account="vault-master-key"
```

**How it works:**

1. First run: generate random 256-bit master key via `crypto.randomBytes(32)` and store in OS Keychain
2. Vault file encrypted with this master key (AES-256-GCM, random IV per write)
3. On startup: fetch master key from keychain, decrypt vault, credentials available
4. OS Keychain is protected by user's login password + (macOS) Secure Enclave / (Windows) TPM

**Library choice:** Platform-specific CLI commands via `execFile` (not `exec` -- prevents shell injection). `security` on macOS, `secret-tool` on Linux, PowerShell on Windows. No native addons -- keeps the dependency clean and avoids node-gyp compilation issues that would block non-technical users.

### Argon2id Master Password (Headless Fallback)

For servers/containers without a GUI keychain:

```typescript
interface VaultHeader {
  version: 2;
  backend: 'keychain' | 'argon2id';
  kdfParams?: {
    memoryCost: 65536;    // 64 MB
    timeCost: 3;
    parallelism: 1;
  };
  salt?: string;          // base64, only for argon2id
}

// Vault file format (v2):
// Line 1: JSON VaultHeader (plaintext -- identifies backend + KDF params)
// Line 2: base64(IV + AuthTag + Ciphertext)  -- AES-256-GCM
```

**Flow:**
```
First run (no keychain available):
  "Set a master password for your ABF vault:"
  -> Argon2id(password, random_salt) -> 256-bit key
  -> Encrypt vault -> write header + ciphertext

Subsequent runs:
  "Vault password:" (or ABF_VAULT_PASSWORD env var)
  -> Argon2id(password, stored_salt) -> key -> decrypt
```

### Vault v1 to v2 Auto-Migration

```
On startup:
  if vault file exists AND no JSON header on line 1 (v1 format):
    1. Derive v1 key: SHA-256(hostname:user:abf-vault-v1)
    2. Attempt decrypt with v1 key
    3. If success:
       a. OS Keychain available? -> generate master key, store in keychain
       b. Else -> prompt for master password (or ABF_VAULT_PASSWORD)
    4. Re-encrypt all credentials with v2 key
    5. Write v2 format with header
    6. Log: "Vault upgraded to v2 -- your credentials are now more secure"
```

### Vault Interface (unchanged public API)

```typescript
// ICredentialVault interface stays identical -- zero breaking changes:
interface ICredentialVault {
  set(provider: string, key: string, value: string): Promise<void>;
  get(provider: string, key: string): Promise<string | undefined>;
  delete(provider: string, key: string): Promise<void>;
  list(): Promise<readonly string[]>;
}

// New: async factory picks backend automatically
async function createVault(options?: {
  vaultPath?: string;           // override ~/.abf/credentials.enc
  masterPassword?: string;      // for headless/CI (skips prompt)
  preferKeychain?: boolean;     // default: true
}): Promise<ICredentialVault>;
```

---

## Gateway Auth Routes (New)

### Key Collection Routes (Ship Now)

```
POST /auth/key/:provider
  Body: { key: string }
  -> Validates prefix
  -> Calls provider's validation endpoint
  -> If valid: stores in Vault v2
  -> Returns { connected: true, models?: string[] }
  -> If invalid: returns { connected: false, error: string }

GET /auth/status
  -> Returns connection status for all providers
  -> Probes Ollama on localhost:11434
  -> {
      anthropic: { connected: true, keyAge: '12 days' },
      openai: { connected: false },
      ollama: { connected: true, models: ['llama3', 'mistral'] },
      'brave-search': { connected: false, optional: true }
    }

DELETE /auth/:provider
  -> Deletes credentials for provider from vault
  -> Returns { disconnected: true }
```

### OAuth Routes (Build Now, Gate Behind Feature Flag)

```
POST /auth/oauth/start/:provider
  -> Generates PKCE code_verifier + code_challenge (SHA-256)
  -> Generates random CSRF state token
  -> Stores { code_verifier, state } in memory (TTL: 5 minutes)
  -> Returns { authUrl: string }

GET /auth/oauth/callback/:provider
  -> Validates state param matches stored state
  -> Exchanges auth code + code_verifier for token
  -> Stores token/key in Vault v2
  -> Returns HTML: "Connected! You can close this window."
  -> Sends SSE event to Dashboard for live status update
```

### Security for Auth Routes

- **Localhost only** in dev mode -- auth routes not exposed on 0.0.0.0
- **Rate limited** -- 5 attempts per minute per provider per IP
- **CSRF** -- OAuth flow uses state tokens; key collection is POST-only
- **No logging of secrets** -- audit trail records `credential_stored(provider)`, never the key
- **Memory hygiene** -- key strings zeroed/dereferenced after vault write
- **Validation before storage** -- invalid keys are never persisted

---

## Dashboard Auth UI

### Setup Wizard (First Run / No Providers Connected)

```
+------------------------------------------------------------------+
|                                                                   |
|   Welcome to ABF                                                  |
|   Connect an AI provider to get started.                          |
|                                                                   |
|   +--------------------------------+  +------------------------+ |
|   |  Cloud Providers               |  |  Run Locally           | |
|   |                                |  |                        | |
|   |  +--------------------------+  |  |  +------------------+  | |
|   |  |  Anthropic (Claude)      |  |  |  |  Ollama          |  | |
|   |  |  Most capable models     |  |  |  |  Free & private   |  | |
|   |  |  [Connect ->]            |  |  |  |  Runs on your     |  | |
|   |  +--------------------------+  |  |  |  machine          |  | |
|   |                                |  |  |  [Detect ->]      |  | |
|   |  +--------------------------+  |  |  +------------------+  | |
|   |  |  OpenAI (GPT)            |  |  |                        | |
|   |  |  GPT-4o, o-series        |  |  |                        | |
|   |  |  [Connect ->]            |  |  |                        | |
|   |  +--------------------------+  |  |                        | |
|   +--------------------------------+  +------------------------+ |
|                                                                   |
|   Your credentials are encrypted and stored only on this machine. |
|                                                                   |
+------------------------------------------------------------------+
```

### Provider Settings Page

```
+------------------------------------------------------------------+
|  AI Providers                                          Settings   |
|                                                                   |
|  Anthropic (Claude)                                               |
|  [connected] Key age: 12 days                     [Disconnect]    |
|  Models: claude-sonnet-4-5, claude-haiku-4-5                     |
|                                                                   |
|  OpenAI (GPT)                                                     |
|  [not connected]                                  [Connect ->]    |
|                                                                   |
|  Ollama (Local)                                                   |
|  [running] localhost:11434                                        |
|  Models: llama3, mistral, nomic-embed-text                        |
|                                                                   |
|  ---------------------------------------------------------------- |
|  Optional                                                         |
|                                                                   |
|  Brave Search API                                                 |
|  [not connected] Enables web-search tool          [Connect ->]    |
|                                                                   |
|  ---------------------------------------------------------------- |
|  Vault: OS Keychain (macOS)               [Change vault method]   |
|  Last accessed: 2 minutes ago                                     |
+------------------------------------------------------------------+
```

---

## Desktop Installer Architecture

For maximum operator-friendliness, ABF should ship a desktop app (Tauri preferred over Electron for size and native OS access).

```
+------------------------------------------------+
|              ABF Desktop App (Tauri)            |
|                                                 |
|  +--------------+  +------------------------+  |
|  | Tauri Shell  |  | Bundled ABF Runtime     |  |
|  |  (Rust)      |  |                         |  |
|  |              |  | - Node.js (embedded)    |  |
|  | - System     |  | - @abf/core             |  |
|  |   tray icon  |  | - @abf/cli              |  |
|  | - Native     |  | - Gateway (HTTP)        |  |
|  |   keychain   |  | - Scheduler             |  |
|  |   access     |  | - All built-in tools    |  |
|  | - OS-level   |  |                         |  |
|  |   file perms |  | Dashboard served at     |  |
|  | - Auto-      |  | localhost:3000          |  |
|  |   update     |  |                         |  |
|  +--------------+  +------------------------+  |
|                                                 |
|  Optional bundled:                              |
|  - Ollama binary (one-click local AI)           |
|  - Playwright browsers (for browse tool)        |
+------------------------------------------------+

Install flow:
  1. Download ABF.dmg / ABF.exe / ABF.AppImage (~15MB)
  2. Launch -> Setup Wizard in native window
  3. Connect provider (key paste now, OAuth when available)
  4. Pick template -> project created in ~/ABF/my-business/
  5. System tray icon -> "Open Dashboard" opens browser
```

**Why Tauri over Electron:**
- ~15MB bundle vs ~200MB (no bundled Chromium -- uses OS WebView)
- Native keychain access via Rust (no node-gyp / native addon compilation)
- Lower memory footprint (operators run this alongside actual work)
- Auto-updater built in
- Rust security: memory-safe keychain handling

---

## Implementation Phases

### Phase A: Vault v2 + Guided Key Collection (do first -- biggest impact)

**What ships:** Operators can connect providers from the Dashboard. No terminal. Secure storage.

Files to create/modify:
- `packages/core/src/credentials/vault-v2.ts` -- new vault with keychain + Argon2
- `packages/core/src/credentials/keychain.ts` -- OS keychain abstraction (macOS/Win/Linux)
- `packages/core/src/credentials/migrate.ts` -- v1 to v2 auto-migration
- `packages/core/src/runtime/gateway/auth.routes.ts` -- `/auth/*` routes
- `packages/core/src/runtime/factory.ts` -- wire createVault() instead of FilesystemCredentialVault
- `packages/dashboard/src/app/settings/providers/page.tsx` -- provider connection UI
- `packages/dashboard/src/app/setup/page.tsx` -- update wizard with provider step
- `packages/dashboard/src/components/ConnectProviderModal.tsx` -- reusable key-paste modal

Dependencies: `@node-rs/argon2` (pure Rust, no node-gyp -- builds on all platforms)

### Phase B: OAuth Module (build plumbing, gate behind flag)

**What ships:** OAuth infrastructure ready. Activates when client_ids are obtained.

Files to create:
- `packages/core/src/credentials/oauth/pkce.ts` -- PKCE utility (challenge, verifier, state)
- `packages/core/src/credentials/oauth/flow.ts` -- generic OAuth flow manager
- `packages/core/src/credentials/oauth/providers/anthropic.ts` -- Anthropic-specific config
- `packages/core/src/credentials/oauth/providers/openai.ts` -- OpenAI-specific config
- `packages/core/src/runtime/gateway/auth.routes.ts` -- add OAuth routes (feature-flagged)

No external dependencies (node:crypto + fetch only).

Blocker: Client IDs from Anthropic and OpenAI. This phase can be built and tested with mock OAuth servers.

### Phase C: Desktop App

**What ships:** Downloadable installer for macOS, Windows, Linux. Zero-terminal experience.

New package:
- `packages/desktop/` -- Tauri app
- `packages/desktop/src-tauri/` -- Rust shell (keychain, tray, auto-update)
- `packages/desktop/src/` -- WebView UI (setup wizard, or reuse Dashboard)

Dependencies: Tauri CLI, Rust toolchain (build-time only -- not shipped to users)

---

## Security Considerations

### Key Collection (Path 2 -- ships first)
- `input type="password"` -- key never visible in DOM after entry
- Key sent via POST body to localhost only -- never URL params, never query strings
- Gateway validates key immediately -- invalid keys never stored
- Rate limited: 5 attempts per minute per provider
- After vault write: key reference cleared from request scope
- No localStorage, no sessionStorage, no cookies -- key exists in memory only during POST
- Audit trail logs `credential_stored(provider, timestamp)` -- never the key value

### OAuth (Path 1 -- future)
- PKCE with S256 -- no client_secret embedded in app (safe for desktop distribution)
- CSRF state token: random, validated on callback, TTL 5 minutes
- Auth code exchanged server-side (gateway) -- never exposed to browser JS
- Callback URL is always localhost -- no external redirect server
- Token stored in Vault v2 immediately after exchange

### Vault at Rest
- OS Keychain: protected by OS login + platform security (Secure Enclave / TPM)
- Argon2id: 64MB memory cost, 3 iterations -- resists GPU brute-force
- File permissions: `0o600` (owner read/write only)
- No plaintext keys ever written to disk, logs, or temp files
- Vault header is plaintext (identifies backend + KDF params) -- ciphertext is on line 2

### Defense in Depth
- Env vars always override vault (CI/Docker compatibility preserved)
- Per-provider isolation in vault (compromising one provider's key doesn't leak others)
- Key age tracking: Dashboard shows age, suggests rotation at 90 days
- Audit trail: all credential access events logged (access, store, delete -- not key values)
- Graceful degradation: if keychain unavailable, falls to Argon2id, never to machine-key
