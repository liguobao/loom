<p align="center">
  <img src="docs/logo.svg" alt="Loom for DeepSeek Harness" width="600">
</p>

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="README.zh.md">中文</a>
  &nbsp;·&nbsp;
  <a href="docs/product.md">Product Spec</a>
  &nbsp;·&nbsp;
  <a href="docs/architecture.md">Architecture</a>
  &nbsp;·&nbsp;
  <a href="docs/end-to-end-encryption.md">E2EE</a>
  &nbsp;·&nbsp;
  <a href="docs/storage-format.md">Storage Format</a>
  &nbsp;·&nbsp;
  <a href="docs/protocol.md">Protocol & API</a>
</p>

## Keep the work, not the chat.

Watch the work while it happens. Keep only what matters afterward.

Loom (Loom for DeepSeek Harness) is a lightweight collaboration and project-memory layer built on top of **DeepSeek Harness (DSH) local workflows**.

It is not a new IDE, nor is it another Agent orchestration platform.

Team members continue to:

- Develop locally on their own computers;
- Use their own local Git repositories;
- Run DeepSeek Harness normally;
- Use their preferred models and tools;
- Execute terminals, file operations, tests, and code changes locally;
- Retain full conversations on their own machines.

Loom preserves this workflow entirely and adds only two core capabilities:

1. **While work happens**: Team members can view a colleague's current local DSH Agent status and conversation in real time with explicit permission.
2. **After work completes**: The full conversation remains local, while only distilled high-value engineering records are uploaded to the Loom Server as Markdown, building searchable and traceable team project memory.

Core transport and end-to-end encryption reuse the proven stack from [ds-harness-remote](https://github.com/liguobao/ds-harness-remote).

## Features

- **Watch in real time**: View a teammate's active DSH agent state and conversation stream live with owner consent.
- **Privacy by default**: Live sessions use bidirectional end-to-end encryption (`Noise_IK_25519_ChaChaPoly_SHA256`). The server routes opaque ciphertext and cannot read prompts, responses, terminal output, or code.
- **Local authority**: Host-local policy holds final veto over observation. Server ACL cannot force a local session to be shared.
- **Durable project memory**: When work finishes, full noisy chat transcripts remain local. High-value engineering decisions are distilled into structured Markdown documents.
- **Markdown as source of truth**: Archived records are stored as readable `.md` files on disk. SQLite serves solely as a disposable index and control plane.
- **Local secret redaction**: API keys, tokens, SSH keys, passwords, and `.env` credentials are sanitized locally before Markdown records leave the machine.
- **Non-intrusive workflow**: Keep using `cd project && dsh`. No mandatory cloud IDE, no forced task tickets, and no agent orchestration pipelines.

## How it works

```text
Host DSH Machine (Local)             Loom Server (Opaque Relay)         Observer Client (Web/CLI)
  DSH Agent / Local Session
             │
      Local Host Plugin
   (E2EE Noise IK Encrypt) ─────────────► WSS Relay ─────────────► (E2EE Noise IK Decrypt)
             │                          (Cannot Read)                      │
    Work Complete (Local)                                            Read-only Live View
             │
  Distill + Secret Redact
             │
  Markdown Work Record ────────────────► Save to Disk (.md)
  (Front Matter + Body)                  + SQLite FTS5 Index ────────► Search Project Memory
```

The Loom Server does not need access to plaintext conversation histories. Live traffic passes through an encrypted tunnel, and historical archives consist strictly of distilled Markdown.

## Observer permission levels

| Level | What others can see |
|---|---|
| `hidden` | Invisible. Host does not advertise active presence. |
| `presence` | User is online, project slug, task title, and elapsed duration. |
| `observe` | Full read-only conversation stream over end-to-end encryption. |

Connections require tripartite approval:
1. **Server ACL**: Organization, workspace, and project membership.
2. **Host Local Policy**: Explicit toggle and allowlist on the local computer.
3. **Peer Identity**: Verified X25519 device public key pinning.

The first version enforces strictly read-only observation. Observers cannot send prompts, approve actions, write files, or execute terminal commands.

## Work record structure

Work records are Markdown files with YAML front matter. The filesystem layout is:

```text
data/organizations/<org-id>/workspaces/<ws-id>/projects/<proj-id>/records/<year>/<month>/<ulid>.md
```

Each record contains structured engineering context rather than conversational noise:

```markdown
---
id: 01KABC123
organization: org_1
workspace: ws_1
project: loom
owner: user_1
created_at: 2026-10-01T01:30:00+08:00
completed_at: 2026-10-01T02:10:00+08:00
repository: liguobao/loom
branch: feat/live-view
base_commit: abc123
final_commit: def456
tags:
  - remote
  - websocket
source_conversation_count: 2
---

# Add real-time observer capability for team members

## Goal
Allow workspace members to observe an active DSH session in read-only mode.

## Outcome
Completed read-only Observer mode with E2EE stream relay.

## Investigation
Evaluated ds-harness-remote single-account transport. Extended it with
organization membership and cross-user authorization.

## Key Decisions
- Real-time observation is strictly read-only by default.
- Server acts as an opaque ciphertext relay and never decrypts traffic.
- Host-local policy holds final veto authority.
- Retain Noise IK cipher suite from ds-harness-remote.

## Rejected Approaches
### Synchronize full conversation transcripts to server
Rejected. Violates local-first guarantees and escalates privacy risk.

## Changed Areas
- packages/remote/observer.ts
- apps/server/permissions.ts
- apps/web/live-view.tsx

## Follow-ups
Evaluate optional interactive collaboration mode in a future version.
```

## Install

### CLI installation and scheduled archiving

The standalone TypeScript CLI uses [Huihua](https://github.com/wibus-wee/huihua) to collect local sessions from Codex, Claude, Cursor, DeepSeek Harness and other Coding Agents. Requires Node.js **22.18+**.

Install from npm:

```sh
npm install -g @liguobao/loom-cli@0.1.0
cd /path/to/project
loom init --providers codex,claude,deepseek --interval 300
loom archive --summarizer codex-server     # Summarize with local Codex
loom schedule install --summarizer codex-server  # Background summaries (macOS / Linux)
loom schedule status
```

Use `loom watch --summarizer codex-server` for foreground operation, or select local DSH with `--summarizer dsh` and `loom schedule uninstall` to remove the service. Scans run every 300 seconds by default and select sessions belonging to this workspace or its subdirectories. Redacted Markdown records live in `~/.loom/records/<project>-<workspace-hash>/`. Summaries cover requirements, corrections, key interactions, decisions, results and follow-ups from all turns. Changed sessions update their existing record; unchanged sessions are skipped. Original conversations stay local, with no server upload.

See the [CLI guide](packages/cli/README.md) for source installation, custom roots, configuration and Windows scheduling. The CLI is published as `@liguobao/loom-cli`; CI and GitHub Releases also package its tarball.

### Browse local archives

Run `loom serve` and open **http://127.0.0.1:8787** to browse workspaces and their
Markdown records. Use `--output /path/to/archives` for a custom archive root or
`--port 9000` for another port. Refresh to see new records; Ctrl+C stops the server.

### Plugin installation

Add the package through DSH's plugin manager for the `web` profile:

```sh
dsh plugin --profile web add -w @liguobao/dsh-loom@0.1.0
```

Restart Harness after installation.

### Web dashboard

```sh
cd apps/web
pnpm dev
```

Visit `http://localhost:5173` to explore project memory, inspect active works, and search past decisions.

## End-to-end encryption

Loom shares the encryption suite with [ds-harness-remote](https://github.com/liguobao/ds-harness-remote):

- **Suite**: `Noise_IK_25519_ChaChaPoly_SHA256`
- **Identity**: Pinned static X25519 public keys per device
- **Handshake**: Initiator (Observer) encrypts to Host static key; Host responds with ephemeral key
- **Transport**: Independent big-endian monotonic nonce counters with replay rejection

Detailed specifications, key lifecycles, and security boundaries are documented in [End-to-end encryption](docs/end-to-end-encryption.md).

## Repository boundary

This repository houses the open-source client-side ecosystem:
- `packages/protocol`: Shared types, Zod schemas, and WebSocket contracts.
- `packages/crypto`: Noise IK cipher implementation and token utilities.
- `packages/db`: SQLite schema, query routines, and FTS5 search indexer.
- `packages/distill`: Conversation distillation, Git context extraction, and secret redaction.
- `packages/cli` (`@liguobao/loom-cli`): Installable TypeScript CLI, Huihua session collection and scheduled local archiving.
- `packages/client` (`@liguobao/dsh-loom`): DeepSeek Harness local plugin and client integration SDK.
- `apps/web`: React 19 web application.

The **Loom Server is closed-source** and maintained in a separate repository. Client implementations interface with the server via the standardized [Protocol & API specification](docs/protocol.md).

## Security

- Session traffic is end-to-end encrypted. The relay server cannot read session payloads or private keys.
- Secret redaction runs locally on the developer machine before records are written or uploaded.
- Observers cannot execute shell commands, inject agent instructions, or approve tool invocations.
- Deleting or rebuilding the SQLite database does not compromise Markdown records on disk.

## Documentation

- [Product specification](docs/product.md)
- [Architecture & three-plane model](docs/architecture.md)
- [End-to-end encryption](docs/end-to-end-encryption.md)
- [Storage format specification](docs/storage-format.md)
- [Protocol & API specification](docs/protocol.md)

## Star History

<a href="https://www.star-history.com/?repos=liguobao%2Floom&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liguobao/loom&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liguobao/loom&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liguobao/loom&type=date&legend=top-left" />
 </picture>
</a>

## Project status and trademarks

This is an independent open-source project designed for the DeepSeek Harness ecosystem.
DeepSeek and related marks belong to their respective owners.

## License

[MIT](LICENSE)
