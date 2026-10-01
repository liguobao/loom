# Architecture

Status: Draft v0.1
Date: 2026-10-01

## Three-plane separation

Loom separates concerns into three planes with distinct storage, transport, and trust characteristics.

### Control Plane (SQLite)

Stores identity, topology, and access control:

- Users, organizations, workspaces, projects
- Membership and roles (owner / admin / member / viewer)
- Machines and host instances
- Sessions and authentication tokens
- Presence metadata
- Work record index (FTS5)

All synchronous queries via better-sqlite3. WAL mode enabled. Foreign keys enforced.

### Archive Plane (Filesystem — Markdown)

Stores work record content as Markdown files on disk:

```text
data/organizations/<org>/workspaces/<ws>/projects/<proj>/records/<year>/<month>/<ulid>.md
```

The Markdown file is the canonical source. SQLite `record_index` + FTS5 virtual table provide search and listing. If the index is lost, `rebuildRecordIndex()` scans the Markdown directory tree and rebuilds it.

Design constraints:
- No work record body stored in SQLite.
- No binary attachments (v1).
- Files can be backed up with rsync, managed with Git, searched with ripgrep.

### Live Plane (WebSocket + Noise IK)

Handles real-time communication:

- Presence updates (online/offline, active work metadata)
- Observer request/accept/deny handshake
- E2EE conversation stream relay (opaque ciphertext passthrough)
- WebRTC signaling relay (offer/answer/ICE)

The Server sees control frames (who connects to whom, timestamps, message sizes) but cannot decrypt business content. The Noise IK handshake and transport follow the specification in [ds-harness-remote/docs/end-to-end-encryption.md](https://github.com/liguobao/ds-harness-remote/blob/main/docs/end-to-end-encryption.md).

## Data flow: live observation

```text
Host DSH Session
  → Host Loom Plugin captures conversation stream
  → Noise IK encrypt (Host static key → Observer ephemeral + static keys)
  → WebSocket to Loom Server
  → Server routes ciphertext (cannot decrypt)
  → WebSocket to Observer client
  → Noise IK decrypt
  → Observer renders read-only conversation view
```

## Data flow: work record archive

```text
Developer finishes work
  → Local client reads DSH conversation transcript
  → Local client reads Git context (branch, commits, changed files)
  → distillConversation() extracts high-value content (CPU-only, no I/O)
  → redactSecrets() scans for sensitive patterns, replaces with [REDACTED]
  → generateMarkdown() produces Front Matter + structured Markdown body
  → HTTP POST to Loom Server with Markdown content
  → Server writes Markdown file to data/ directory
  → Server updates SQLite record_index + FTS5
```

All distillation and redaction happen on the developer's local machine. The Server receives only the finished, redacted Markdown.

## Authorization model

### Observer authorization (three-layer)

```text
Layer 1: Server ACL
  └─ Is Observer a member of the same organization/workspace/project?
  └─ Does the Host's observe_permission allow this level?

Layer 2: Host local policy
  └─ Has the Host owner enabled sharing?
  └─ Is the specific Observer in the Host's local allowlist?

Layer 3: Peer identity
  └─ Is the Observer's device identity key known and pinned?
  └─ Does the Noise IK handshake succeed?
```

All three layers must pass. The Host local policy has final veto.

### Permission levels

| Level | Server sees | Observer sees |
|---|---|---|
| `hidden` | Nothing | Nothing |
| `presence` | Online status, project, title | Same |
| `observe` | Ciphertext relay metadata | Decrypted conversation stream |

## Technology choices

| Decision | Choice | Rationale |
|---|---|---|
| Database | SQLite (better-sqlite3) | Single-file, zero-config, synchronous API, FTS5 built-in |
| Record storage | Markdown files | Human-readable, portable, Git-manageable, grep-able |
| E2EE | Noise IK | Proven, compact, no PKI required, same as ds-harness-remote |
| IDs | ULID | Time-sortable, URL-safe, no coordination needed |
| Server framework | *(closed source)* | — |
| Frontend | React 19 + Vite + TailwindCSS 4 | Modern defaults, fast iteration |
| Build | tsup | Fast ESM bundling with declaration files |

## Package dependency graph

```text
@loom/protocol  ← no internal dependencies
     ↑
@loom/crypto    ← @noble/curves, @noble/ciphers, @noble/hashes
     ↑
@loom/db        ← @loom/protocol, better-sqlite3
     ↑
@loom/distill   ← @loom/protocol, gray-matter
     ↑
@loom/client    ← @loom/protocol, @loom/crypto, @loom/distill, conf, ws
     ↑
@loom/web       ← @loom/protocol, react, vite, tailwindcss
```
