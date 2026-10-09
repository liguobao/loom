<p align="center">
  <img src="docs/logo.svg" alt="Loom — Keep the work, not the chat." width="600">
</p>

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="README.zh.md">中文</a>
  &nbsp;·&nbsp;
  <a href="packages/cli/README.md">CLI Guide</a>
  &nbsp;·&nbsp;
  <a href="packages/client/README.md">DSH Plugin</a>
</p>

## Keep the work, not the chat.

**Loom turns local Coding Agent sessions into readable Markdown project memory.**

Coding Agents help you build software, but the requirements, corrections, investigations and decisions behind that work are often buried in long conversations. Loom collects sessions belonging to a project, summarizes the engineering context and keeps it alongside the project so you can revisit **what was done, why it was done, what was verified and what remains unresolved**.

The primary way to use Loom is the **standalone CLI**. It collects local sessions from Codex, Claude, Cursor, DeepSeek Harness and other Coding Agents through [Huihua](https://github.com/wibus-wee/huihua), then uses your configured local Codex or DSH agent to generate summaries. **You do not need DSH, a DSH plugin or a Loom Server to use the CLI.**

The **DSH plugin is an optional integration** for archiving within DeepSeek Harness. It is one entry point into Loom, not the definition of the project or a prerequisite for using it.

Loom is not an IDE, an Agent orchestration platform or a raw transcript synchronization service. Keep using your existing editor, agents, models and Git workflow.

## What Loom does

- **Collects by workspace**: Finds local sessions for the current project and its subdirectories, rather than mixing unrelated conversations into one archive.
- **Preserves engineering context**: Summarizes requirements, user corrections, key interactions, investigations, decisions, rejected approaches, outcomes and follow-ups.
- **Uses execution evidence**: Includes relevant tool results, errors and test evidence, distinguishing requested work and agent claims from verified results.
- **Updates incrementally**: Changed sessions update their existing Markdown record; unchanged sessions skip summary calls. Failed summaries preserve existing records and can be retried.
- **Runs once or in the background**: Archive on demand, watch in the foreground or install a per-workspace background service on macOS/Linux.
- **Keeps records accessible**: Read Markdown directly or browse it through the CLI's local, read-only web server.
- **Keeps you in control**: Raw conversations stay in their original local stores. Loom applies secret redaction before summary input and before writing records.

## Quick start: standalone CLI

Requires **Node.js 22.18+** and an installed, configured local summary agent: **Codex or DSH**. The agent supplying the summary does not have to be the agent that produced the original session.

```sh
npm install -g @liguobao/loom-cli
cd /path/to/project

# Collect supported local sessions and save the summary backend for this workspace.
loom init --summarizer codex-server

# Generate or update Markdown work records once.
loom archive

# Browse the records at http://127.0.0.1:8787.
loom server
```

`loom init` enables all providers supported by Huihua by default. Use `loom providers` to list their IDs, or limit collection with `--providers codex,claude,deepseek`.

By default, configuration and records live in the workspace's `.loom` directory. Inside a Git repository, Loom resolves the workspace to the Git root:

```text
your-project/
├── .git/
├── .loom/
│   ├── config.json
│   └── records/
│       └── <session-source-hash>.md
└── ...
```

Use `loom init --output /path/to/archives` to store records elsewhere. Custom output roots group records under `<project-name>-<workspace-hash>/`. Existing legacy configurations under `~/.loom/workspaces/` remain supported.

**Treat `.loom` as private by default.** Add `.loom/` to your project's `.gitignore` unless you deliberately want to share reviewed records. Redaction is not a guarantee that every secret or sensitive detail has been removed.

For source/tarball installation, custom session roots, configuration and platform-specific details, see the [CLI guide](packages/cli/README.md).

### Automatic archiving

```sh
# Foreground: scan immediately, then repeat at the configured interval.
loom watch

# Background service: macOS LaunchAgent or Linux systemd user service.
loom schedule install
loom schedule status
loom schedule uninstall
```

The default interval is 300 seconds after each completed scan. `watch` and scheduled archiving summarize current snapshots; they do not automatically declare ongoing tasks completed. The local browser does not run collection or summarization: use `loom watch` or a background service separately, and refresh the page to see updates.

### Choose a summary agent

```sh
loom archive --summarizer codex-server
loom archive --summarizer dsh
```

- `codex-server` uses the installed `codex app-server --stdio` and your Codex configuration/authentication.
- `dsh` uses the installed headless DSH CLI and your DSH model configuration. This does **not** require the Loom DSH plugin.

Loom does not configure a hosted model API of its own. A local agent may still call a remote model provider according to its settings; summary input is subject to that provider's data handling. See the [summary backend guide](packages/cli/README.md#local-summarization-backend) for executable paths and profiles.

## How it works

```text
Local Coding Agent session stores
  Codex / Claude / Cursor / DeepSeek Harness / ...
                       │
              Huihua session collection
              + workspace matching
                       │
              Local secret redaction
                       │
              Configured local summary agent
              (Codex or DSH)
                       │
              Structured summary + redaction
                       │
              Project Markdown work records
                       │
              Read files directly / loom server
```

Collection, archiving and browsing run on your machine. The standalone workflow does not upload records to a Loom Server or require the team collaboration stack.

## What a work record contains

A record is a Markdown document with YAML front matter identifying its source and workspace. Its body captures the useful engineering context:

| Section | What it preserves |
|---|---|
| Goal | The problem being solved |
| Requirements | Initial requests, later additions, constraints and corrections |
| Interaction Summary | Key attempts, feedback, failures, fixes and final state in source order |
| Outcome | Results and verification status |
| Investigation | How the problem was located |
| Key Decisions | Technical choices and their reasons |
| Rejected Approaches | Alternatives that were tried or ruled out |
| Follow-ups | Unresolved issues and next steps |

This is a semantic summary, not a copied transcript or fixed-length excerpt. Long histories are summarized in bounded chunks and merged. A tool call alone does not prove success, and missing or compacted source history cannot be reconstructed.

## Optional integration: DSH plugin

If you already use DeepSeek Harness and want archiving integrated into its runtime, install the plugin:

```sh
dsh plugin --profile web add -w @liguobao/dsh-loom@0.1.0
```

Restart Harness after installation. The plugin archives locally and shares the CLI's summarization engine. Its configuration and storage behavior are documented in the [DSH plugin guide](packages/client/README.md).

**These are separate choices:** session providers choose what to collect; the summary backend chooses how to summarize; the DSH plugin chooses how to integrate with DSH. Selecting DSH as a provider or summary backend does not make the plugin mandatory.

## Team collaboration and architecture

Loom also includes protocol, encryption, indexing and web UI components for a broader team project-memory and read-only observation design. **That design is separate from the standalone local archive workflow described above.** Installing the CLI or plugin does not, by itself, enable live team observation or server-side search.

The team design covers owner-authorized observation, host-local veto, server ACLs and end-to-end encrypted live traffic using `Noise_IK_25519_ChaChaPoly_SHA256`. These are collaboration-specific boundaries, not a claim that local Markdown archives are encrypted. The Loom Server is maintained separately as a closed-source project; it is not needed for local archiving. The React dashboard in `apps/web` is also separate from the CLI's built-in local browser.

The following documents describe the DSH-oriented team collaboration design rather than prerequisites for CLI use:

- [Product specification](docs/product.md)
- [Architecture & three-plane model](docs/architecture.md)
- [End-to-end encryption](docs/end-to-end-encryption.md)
- [Team storage format](docs/storage-format.md)
- [Protocol & API specification](docs/protocol.md)

## Repository layout

| Path | Purpose |
|---|---|
| `packages/cli` | Standalone CLI: session collection, scheduled archiving and local browsing |
| `packages/distill` | Shared semantic summarization, Git context and secret redaction |
| `packages/client` | Optional DSH plugin and client integration |
| `packages/protocol` | Shared types, schemas and WebSocket contracts |
| `packages/crypto` | Noise IK encryption, device keys and token utilities |
| `packages/db` | SQLite data access and FTS5 indexing for the collaboration stack |
| `apps/web` | React team dashboard |

## Security and privacy

- Local records are readable Markdown, not encrypted archives. Protect their directory and review records before sharing or committing them.
- Pattern-based redaction cannot detect every secret. Your selected agent/model provider determines where summary input is processed.
- Failed or invalid summaries preserve existing records rather than replacing them with transcript excerpts.
- The local browser listens on `127.0.0.1` only and is read-only; it is not a public sharing service.

## Star History

<a href="https://www.star-history.com/?repos=liguobao%2Floom&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liguobao/loom&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liguobao/loom&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liguobao/loom&type=date&legend=top-left" />
 </picture>
</a>

## Project status and trademarks

Loom is an independent open-source project for local Coding Agent workflows. It is not an official product of any supported agent or model provider. Product names and trademarks belong to their respective owners.

## License

MIT
