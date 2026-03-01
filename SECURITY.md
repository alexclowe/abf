# Security Policy

ABF is a security-first framework. Agents run with real credentials, execute real actions, and operate autonomously — so the security of the runtime is critical. We take vulnerability reports seriously and respond promptly.

> **Looking for the full security guide?** See [docs/security.md](docs/security.md) for a comprehensive overview of ABF's security architecture, deployment checklists, risk assessment, custom tool guidelines, and incident response procedures.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities through one of these channels:

- **Email**: security@abf.dev — PGP encryption available on request.
- **GitHub Security Advisories**: Use the "Report a vulnerability" button in the Security tab of this repository. Reports are private and visible only to maintainers.

Include as much detail as possible: affected component, reproduction steps, potential impact, and any proof-of-concept code. We will acknowledge receipt and keep you informed throughout the process.

## Response Timeline

| Severity | Acknowledgement | Patch Target |
|----------|----------------|--------------|
| Critical | 24 hours | 7 days |
| High | 48 hours | 14 days |
| Medium | 48 hours | 30 days |
| Low | 5 business days | Next release |

If a patch cannot be delivered within the target window, we will communicate the delay and provide a workaround or mitigation where possible.

## Scope

The following are in scope for security reports:

- **packages/core** — runtime, scheduler, dispatcher, session manager, message bus, gateway, credential vault, tool sandbox, memory system
- **packages/cli** — `abf` CLI commands, including auth, init, dev, run, migrate
- **packages/dashboard** — Next.js dashboard, all API routes, setup wizard
- **Built-in tools** — all tools shipped in `packages/core/src/tools/`
- **Provider plugins** — Anthropic, OpenAI, Ollama integrations
- **Seed-to-company pipeline** — parser, analyzer, apply modules

The following are out of scope:

- Third-party MCP servers configured by operators
- Custom tools written by operators (see note below)
- Vulnerabilities in upstream dependencies that have not been incorporated into ABF
- Social engineering or phishing attacks

## Security Architecture

ABF is built around six security pillars. A full description of each is in [CLAUDE.md](./CLAUDE.md) under "Security Architecture".

1. **Least Privilege** — Agents start with zero permissions. Access is explicitly granted per agent and enforced by the runtime, not by the LLM.
2. **OAuth-Only** — No raw credentials are stored. Scoped tokens are used throughout. Auto-rotation is supported with one-click revocation from the Dashboard.
3. **Sandboxed Execution** — Every tool call is isolated. The sandbox is destroyed after execution.
4. **Managed Tools** — The tool surface is locked to operator-approved tools. Agents cannot install tools at runtime.
5. **Memory Integrity** — Agent history is append-only. Checksums and anomaly detection guard against memory poisoning. Snapshot rollback is supported.
6. **Containment First** — The system assumes compromise is possible. Blast radius is minimized through isolation, and rapid rebuild is a design goal.

The runtime also defends against prompt injection through source tagging, content isolation (external content is treated as data, not instructions), an injection detector, and output validation against `behavioral_bounds` before any action is executed.

## Note on Custom Tools

Custom tools (`.tool.js` files in your project) run **in-process** without container isolation. They are treated as operator-trusted code — equivalent to any other code you deploy. Review custom tools carefully before enabling them. ABF does not sandbox or restrict custom tool code beyond the behavioral bounds defined in agent YAML.

If you are distributing custom tools to others, follow the same security practices you would apply to any JavaScript package: audit dependencies, avoid credential access, and document what the tool does.

## Disclosure Policy

We follow coordinated disclosure. We ask that reporters:

- Allow us the response window above before any public disclosure
- Avoid accessing user data or degrading service during research
- Act in good faith

We will credit researchers in the release notes for the patched version unless they prefer to remain anonymous.
