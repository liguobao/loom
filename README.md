# Loom

**Keep the work, not the chat.**

Loom is a lightweight collaboration and project-memory layer for [DeepSeek Harness](https://github.com/liguobao/ds-harness). Developers keep working locally with their own machines, repositories, and conversations. Teammates can observe active work when permitted, while finished work is distilled locally into readable Markdown records that become searchable project memory.

→ [中文文档](./README.zh.md)

## What it does

1. **While you work** — team members can watch your live DSH session in read-only mode, with your permission, over an end-to-end encrypted channel.
2. **After you finish** — the full conversation stays on your machine. Only a distilled Markdown work record is uploaded to the Loom Server, forming a searchable project knowledge base.

## What it does not do

Loom does not orchestrate agents, host IDEs, manage sprints, or monitor developer activity. It does not require a unified environment, does not upload raw conversations, and does not change how you use Git or DSH.

## Relationship to DSH Remote

Loom builds on top of [ds-harness-remote](https://github.com/liguobao/ds-harness-remote). The Remote project solves *"how do I continue using my own DSH from another device"*. Loom solves *"how does my team observe each other's work and retain project memory"*.

Loom reuses Remote's mature transport stack:

| Capability | Source |
|---|---|
| End-to-end encryption | Noise IK (`Noise_IK_25519_ChaChaPoly_SHA256`) via `@dsh-remote/crypto` |
| Secure channel | WebSocket control channel + Noise transport |
| Device identity | X25519 static key pairs, locally pinned |
| Relay | Server routes opaque ciphertext; cannot read session content |
| Presence | WebSocket-based online/offline and device metadata |

The key difference is the trust boundary. Remote connects **my client → my host** within a single account. Loom connects **User A → User B's host** across an organization, adding membership, cross-user authorization, and the observer permission model.

## Architecture

```text
                       Loom
                        │
        ┌───────────────┼───────────────┐
        │               │               │
      Live           Archive         Control
        │               │               │
      E2EE           Markdown         SQLite
        │               │               │
  Local DSH Host    Project          Identity
  Conversation       Memory          Topology
```

### Live Plane

Real-time presence and observer relay. Conversation streams are encrypted on the Host and decrypted only by the authorized Observer using Noise IK. The Server routes ciphertext; it cannot read prompts, agent output, tool calls, terminal content, workspace paths, or source code. See [End-to-end encryption](docs/end-to-end-encryption.md).

### Archive Plane

Markdown files on disk, one per work record. SQLite FTS5 provides a full-text search index on top. The Markdown file is the source of truth. If the database is lost, `loom reindex` rebuilds the index by scanning the files. See [Archive format](docs/archive-format.md).

### Control Plane

SQLite for identity, organization, workspace, project, machine, host instance, membership, and permissions. This is the only state the Server needs to persist in a database; work record content lives in Markdown files.

## Observer permission levels

| Level | What others can see |
|---|---|
| `hidden` | Nothing. Host is invisible to the organization. |
| `presence` | User is online, which project, working title, elapsed time. |
| `observe` | Full read-only conversation stream over E2EE. |

Three checks must all pass before a connection is established:

1. **Server ACL** — organization/workspace/project membership and permission level.
2. **Host local policy** — the Host owner controls sharing independently of the server.
3. **Peer identity** — the Observer's device identity key must be known and authorized.

The Host local policy has final veto. The Server cannot override a Host that has disabled sharing.

First version does not implement cross-user control (`send prompt`, `approve`, `terminal`, `write file`). Observer is strictly read-only.

## Repository structure

```text
loom/
├── apps/
│   └── web/             # React 19 frontend
│
├── packages/
│   ├── protocol/        # Shared TypeScript types, Zod schemas, WebSocket message types
│   ├── crypto/          # Noise IK E2EE (X25519 + ChaCha20-Poly1305 + HKDF-SHA256)
│   ├── db/              # SQLite schema, queries, FTS5 full-text search, index rebuild
│   ├── distill/         # Work Record generation, secret redaction, Git context
│   └── client/          # Local CLI (loom command) and SDK
│
├── docs/
│   ├── product.md           # Product specification
│   ├── architecture.md      # Technical architecture
│   ├── end-to-end-encryption.md
│   ├── archive-format.md    # Work Record Markdown format
│   └── server-api.md        # Server API contract (for Server implementors)
│
└── data/                # Runtime: SQLite DB + Markdown records (gitignored)
```

### Repository boundary

This repository implements the local client packages (protocol, crypto, db, distill, client), the web frontend, and the protocol/API specifications. The **Loom Server is closed-source** and maintained separately. The Server API contract in `docs/server-api.md` is the interoperability specification between the client packages and the Server.

## Getting started

### Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9

### Install and build

```bash
git clone https://github.com/liguobao/loom
cd loom
pnpm install
pnpm build
```

### CLI

```bash
# After build, the CLI is at packages/client/dist/cli.js
node packages/client/dist/cli.js --help
```

| Command | Description |
|---|---|
| `loom login` | Sign in to a Loom Server |
| `loom logout` | Sign out |
| `loom whoami` | Show current user and server |
| `loom init` | Bind current directory to a Loom Project |
| `loom status` | Show current binding, login, and project state |
| `loom search <query>` | Search work records |
| `loom record list` | List recent work records for current project |
| `loom record show <id>` | Show a work record |
| `loom host register` | Register a local Host Instance |

### Web frontend (development)

```bash
cd apps/web
pnpm dev
# http://localhost:5173 — requires a running Loom Server at localhost:3000
```

## Work record format

Work records are Markdown files with YAML front matter. The file is the canonical content; the database stores only an index.

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

Initially considered reusing the existing Remote Client permission model.
Confirmed ds-harness-remote is currently based on same-account membership,
so Loom needs organization-level membership and cross-user authorization.

## Key Decisions

- Real-time view is read-only by default.
- Server routes ciphertext only — never decrypts content.
- Host local policy has final veto.
- Reuse existing Noise E2EE transport from ds-harness-remote.

## Rejected Approaches

### Sync full conversation to server

Rejected. Increases privacy risk and violates Loom's local-first principle.

## Changed Areas

- packages/remote/observer.ts
- apps/server/permissions.ts
- apps/web/live-view.tsx

## Follow-ups

Consider explicit Collaborate mode in a future version,
but first version does not allow cross-user Agent control.
```

A work record must include at minimum: Title, Goal, Outcome, Key Decisions, Changed Areas, and Git context. Records that contain only a one-sentence summary do not meet the quality bar.

## Secret redaction

Before any Markdown leaves the local machine, the client scans for and replaces sensitive values with `[REDACTED]`:

- API keys (`sk-*`, `ghp_*`, `AKIA*`, `github_pat_*`)
- Passwords and database credentials in config
- Private keys (RSA, EC, OpenSSH)
- Bearer tokens
- Cookie headers
- `.env`-style `SECRET_KEY=value` patterns
- Database connection strings with embedded credentials

The Server never receives raw conversation content. It receives only the already-redacted Markdown work record.

## End-to-end encryption

Loom reuses the `Noise_IK_25519_ChaChaPoly_SHA256` suite from [ds-harness-remote](https://github.com/liguobao/ds-harness-remote). The protocol, key lifecycle, handshake, replay protection, and visible metadata follow the same specification documented in [ds-harness-remote/docs/end-to-end-encryption.md](https://github.com/liguobao/ds-harness-remote/blob/main/docs/end-to-end-encryption.md).

In the Loom context:

- The **Observer** is the initiator (knows the Host's static public key).
- The **Host** is the responder.
- After handshake, the Host streams encrypted conversation chunks; the Observer decrypts locally.
- The Server relays opaque ciphertext. It can observe connection metadata (who is connected to whom, timestamps, message sizes) but cannot read business content.

## Data layout

```text
data/
├── loom.db
└── organizations/
    └── <org-id>/
        └── workspaces/
            └── <workspace-id>/
                └── projects/
                    └── <project-id>/
                        └── records/
                            └── 2026/
                                └── 10/
                                    └── 01KABC....md
```

If `loom.db` is lost, the index can be rebuilt from the Markdown files. Markdown is the source of truth; the database is a disposable acceleration layer.

## Tech stack

| Component | Technology |
|---|---|
| Runtime | Node.js 22, TypeScript 5 |
| Package manager | pnpm 9 (workspace monorepo) |
| Crypto | `@noble/curves`, `@noble/ciphers`, `@noble/hashes` — Noise IK |
| Database | better-sqlite3 (WAL mode, FTS5) |
| Frontend | React 19, Vite 5, TailwindCSS 4, Zustand, TanStack Query |
| Build | tsup |
| IDs | ULID |

## Design principles

1. Put the work record first; conversation is raw material, not the deliverable.
2. Make live observation explicit, contextual, and impossible without Host consent.
3. Show connection and encryption state plainly, including offline, relay, and degraded states.
4. Preserve the developer's existing local workflow; Loom is invisible during `cd project && dsh`.
5. Keep remote observation within read-only boundaries; never imply that Loom grants control.

## Anti-patterns

Do not turn Loom into:

- **Employee monitoring** — Presence is collaboration information, not a productivity metric. Do not surface "who worked how long" or "who used the most tokens".
- **Agent orchestration** — Loom does not care what model, agent, or runtime the developer uses.
- **A cloud IDE** — Development resources belong to the developer's local machine.
- **A project management tool** — No Epics, Sprints, Stories, or approval chains. Use GitHub Issues, Linear, or Jira for that.
- **A Codecast platform** — No session sync, remote steering, agent fork, or cloud runtime.

## License

MIT
