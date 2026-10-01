# Archive Format — Work Record Markdown

Status: Draft v0.1
Date: 2026-10-01

## File layout

```text
data/organizations/<org-id>/workspaces/<ws-id>/projects/<proj-id>/records/<year>/<month>/<ulid>.md
```

- `<year>` and `<month>` use UTC to avoid timezone ambiguity.
- `<ulid>` is the work record ID, generated locally before upload.
- The file is the canonical content. SQLite stores only a search index.

## Format

YAML Front Matter + Markdown Body.

### Front Matter (required fields)

```yaml
---
id: 01KABC123                         # ULID
organization: org_1                    # Organization ID
workspace: ws_1                        # Workspace ID
project: loom                          # Project ID or slug
owner: user_1                         # Owner user ID

created_at: 2026-10-01T01:30:00+08:00  # ISO 8601
completed_at: 2026-10-01T02:10:00+08:00

repository: liguobao/loom              # Normalized: org/repo
branch: feat/live-view
base_commit: abc123
final_commit: def456

tags:
  - remote
  - websocket
  - permissions

source_conversation_count: 2           # Number of DSH conversations distilled
---
```

### Front Matter field rules

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string (ULID) | yes | Generated locally before upload |
| `organization` | string | yes | Organization ID |
| `workspace` | string | yes | Workspace ID |
| `project` | string | yes | Project ID |
| `owner` | string | yes | User ID of the author |
| `created_at` | ISO 8601 | yes | When work started |
| `completed_at` | ISO 8601 | no | When work finished |
| `repository` | string | no | Normalized as `org/repo` (no protocol, no `.git` suffix) |
| `branch` | string | no | Git branch name |
| `base_commit` | string | no | Commit hash at the start of work |
| `final_commit` | string | no | Commit hash at the end of work |
| `tags` | string[] | no | Free-form tags for categorization |
| `source_conversation_count` | integer | no | How many conversations were distilled into this record |

### Markdown Body (required sections)

```markdown
# <Title>

## Goal

What problem was being solved. What was the user trying to achieve.

## Outcome

What was ultimately done. The end result.

## Investigation

How the problem was located. What was explored. What context was gathered.

## Key Decisions

Important engineering judgments made during the work.
Why this approach was chosen over alternatives.

## Rejected Approaches

### <Approach name>

What was considered and why it was abandoned.

## Changed Areas

- path/to/file1.ts
- path/to/file2.ts

## Follow-ups

Remaining issues, known limitations, future work.
```

### Section rules

| Section | Required | Notes |
|---|---|---|
| Title (H1) | yes | Concise description of the work |
| Goal | yes | Must be more than a one-word label |
| Outcome | yes | Concrete result, not "done" |
| Investigation | no | Include if non-trivial investigation was done |
| Key Decisions | yes | At least one decision with rationale |
| Rejected Approaches | no | Include if alternatives were considered |
| Changed Areas | yes | File paths or module names |
| Follow-ups | no | Include if there are known remaining issues |

A work record that contains only a one-sentence summary does not meet the quality bar.

## Repository normalization

Git remote URLs are normalized to `org/repo` format:

| Input | Normalized |
|---|---|
| `git@github.com:liguobao/loom.git` | `liguobao/loom` |
| `https://github.com/liguobao/loom.git` | `liguobao/loom` |
| `https://github.com/liguobao/loom` | `liguobao/loom` |

## SQLite index

The `record_index` table mirrors Front Matter fields for fast querying. The `record_fts` FTS5 virtual table indexes `title`, `tags`, and `changed_areas` for full-text search.

If the SQLite database is lost:

```
rebuildRecordIndex(db, dataDir)
  → scan all .md files under dataDir
  → parse Front Matter from each file
  → insert into record_index
  → FTS5 triggers auto-populate record_fts
```

This is a supported operation, not an emergency recovery procedure.

## Secret redaction

Before the Markdown content is uploaded, the local client runs `redactSecrets()` which detects and replaces the following patterns with `[REDACTED]`:

1. API keys: `sk-*`, `sk_live_*`, `sk_test_*`, `api_key=*`
2. AWS access keys: `AKIA[0-9A-Z]{16}`
3. GitHub tokens: `ghp_*`, `github_pat_*`
4. Private key blocks: `-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`
5. Passwords in config: `password=*`
6. Database URLs: `postgres://user:pass@*`, `mysql://user:pass@*`
7. Environment variables: `*_KEY=*`, `*_TOKEN=*`, `*_SECRET=*`, `*_PASSWORD=*`
8. Bearer tokens: `Bearer *`
9. Cookie headers: `Cookie: *`
10. SSH private keys: `-----BEGIN OPENSSH PRIVATE KEY-----`

The redaction runs locally on the developer's machine. The Server never receives un-redacted content.
