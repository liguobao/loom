# Loom

**Keep the work, not the chat.**

Loom is a lightweight collaboration and project-memory layer for [DeepSeek Harness](https://github.com/liguobao/ds-harness). Developers keep working locally with their own machines, repositories, and conversations. Teammates can observe active work when permitted, while finished work is distilled locally into readable Markdown records that become shared project memory.

→ [中文文档](./README.zh.md)

---

## Core Ideas

| Principle | What it means |
|-----------|---------------|
| **Local-first** | Full conversations stay on your machine. Only distilled Markdown is shared. |
| **Private by default** | Real-time streams are E2EE. Server never reads your prompts or agent output. |
| **Search-first** | Find past decisions and context instantly, not by scrolling through history. |
| **Low-friction** | `cd project && dsh` — Loom stays out of your way while you work. |

## What Loom Is Not

- ❌ Not an Agent orchestration platform
- ❌ Not a cloud IDE or remote terminal
- ❌ Not employee monitoring
- ❌ Not a project management tool (no Epics, Sprints, or Stories)

---

## Architecture

```
                       Loom
                        │
        ┌───────────────┼───────────────┐
        │               │               │
      Live           Archive         Control
        │               │               │
      E2EE           Markdown         SQLite
        │               │               │
   Local DSH        Project          Identity
   Conversation      Memory           Topology
```

**Three planes:**

- **Live Plane** — Real-time presence and observer relay. E2EE (Noise IK). Server only routes ciphertext, never reads content.
- **Archive Plane** — Markdown files on disk. SQLite FTS5 index on top. If the index is lost, `loom reindex` rebuilds it from files.
- **Control Plane** — SQLite for identity, membership, permissions, machines, and host instances.

## Observer Permission Levels

| Level | What others can see |
|-------|---------------------|
| `hidden` | Nothing — you're invisible |
| `presence` | You're online, which project, how long |
| `observe` | Full read-only Conversation stream (E2EE) |

Control is always with the Host. Server ACL + Host local policy + Peer identity — all three must pass before a connection is established.

---

## Repository Structure

```
loom/
├── apps/
│   ├── server/          # Hono server — Control + Archive + Live planes
│   └── web/             # React 19 frontend
│
├── packages/
│   ├── protocol/        # Shared TypeScript types and Zod schemas
│   ├── crypto/          # Noise IK E2EE (X25519 + ChaCha20-Poly1305)
│   ├── db/              # SQLite schema, queries, FTS5 index
│   ├── distill/         # Work Record generation + Secret Redaction
│   └── client/          # Local CLI (`loom` command)
│
├── docs/
└── data/                # SQLite DB + Markdown records (gitignored)
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9

### Install

```bash
git clone https://github.com/liguobao/loom
cd loom
pnpm install
```

### Build all packages

```bash
pnpm build
```

### Start the server

```bash
cd apps/server
cp .env.example .env
node dist/main.js
# Server: http://localhost:3000
# WebSocket: ws://localhost:3000/ws
```

### Start the web frontend (development)

```bash
cd apps/web
pnpm dev
# http://localhost:5173
```

### Use the CLI

```bash
# Install globally (after build)
pnpm --filter @loom/client build
node packages/client/dist/cli.js --help

# Or run directly
node packages/client/dist/cli.js login
node packages/client/dist/cli.js init
node packages/client/dist/cli.js status
node packages/client/dist/cli.js search "token refresh websocket"
node packages/client/dist/cli.js record list
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `loom login` | Log in to a Loom Server |
| `loom logout` | Log out |
| `loom whoami` | Show current user |
| `loom init` | Bind current directory to a Loom Project |
| `loom status` | Show current binding and login state |
| `loom search <query>` | Search Work Records |
| `loom record list` | List recent Work Records for current project |
| `loom record show <id>` | Show a Work Record |
| `loom host register` | Register a local Host Instance |

---

## Work Record Format

Work Records are Markdown files with YAML front matter. The file is the source of truth — SQLite is only an index.

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
…

## Key Decisions
- Real-time view is read-only by default.
- Server routes ciphertext only — never decrypts content.
- Host local policy has final veto.

## Rejected Approaches
### Sync full Conversation to server
Rejected. Violates local-first and privacy principles.

## Changed Areas
- packages/remote/observer.ts
- apps/server/ws/handler.ts

## Follow-ups
Consider explicit Collaborate mode in a future version.
```

---

## Secret Redaction

Before any Markdown is uploaded, the local client scans for and redacts:

- API Keys (`sk-*`, `ghp_*`, `AKIA*`, …)
- Passwords and database credentials
- Private keys and SSH keys
- Bearer tokens and Cookie headers
- `.env`-style `SECRET=value` patterns

Redacted values are replaced with `[REDACTED]`. The server never receives raw conversation content — only the already-redacted Markdown.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript 5 |
| Package manager | pnpm 9 (workspace monorepo) |
| Server | Hono + @hono/node-server |
| Database | better-sqlite3 (SQLite WAL, FTS5) |
| WebSocket | ws |
| Crypto | @noble/curves + @noble/ciphers (Noise IK) |
| Frontend | React 19, Vite 5, TailwindCSS 4 |
| State | Zustand + TanStack Query |
| Build | tsup |
| IDs | ULID |

---

## Data Layout

```
data/
├── loom.db                          # SQLite (Control Plane + Record Index)
└── organizations/
    └── <org-id>/
        └── workspaces/
            └── <workspace-id>/
                └── projects/
                    └── <project-id>/
                        └── records/
                            └── 2026/
                                └── 10/
                                    └── 01KABC....md   # Work Record (source of truth)
```

If `loom.db` is lost, records can be rebuilt by scanning the Markdown files.

---

## MVP Scope

### Server
- [x] User auth (register / login / session token)
- [x] Organization / Workspace / Project CRUD
- [x] Machine + Host Instance registration
- [x] Membership and permissions
- [x] Presence (WebSocket, per-project subscription)
- [x] Observer relay (E2EE ciphertext passthrough)
- [x] Markdown record storage (filesystem)
- [x] SQLite FTS5 full-text search
- [x] `GET /api/search?q=` endpoint

### Local Client (CLI)
- [x] `loom login / logout / whoami`
- [x] `loom init` — project binding
- [x] `loom status`
- [x] `loom search`
- [x] `loom record list / show`
- [x] Config persistence (`~/.config/loom`)
- [x] Presence WebSocket client
- [x] Archive pipeline (distill → redact → upload)

### Web
- [x] Login / register
- [x] Workspace list
- [x] Project list
- [x] Project page (Active Work + Search + Work Records)
- [x] Work Record detail view
- [x] Real-time active work polling

---

## License

MIT
