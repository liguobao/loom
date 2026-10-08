# Loom CLI

TypeScript CLI for periodically archiving local Coding Agent sessions by workspace.
Session collection uses [Huihua](https://github.com/wibus-wee/huihua), pinned to 0.4.1.
Requires Node.js **22.18 or newer**.

## Install from this repository

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @liguobao/loom-cli... build
mkdir -p artifacts
corepack pnpm --dir packages/cli pack --pack-destination ../../artifacts
npm install -g ./artifacts/liguobao-loom-cli-0.1.0.tgz
loom --help
```

You can also install the `liguobao-loom-cli-<version>.tgz` asset from a GitHub Release:

```sh
npm install -g ./liguobao-loom-cli-0.1.0.tgz
```

The package bundles Loom's summarization code; installation does not need the monorepo.
An npm registry release can be installed with `npm install -g @liguobao/loom-cli` once published.
This repository currently ships the tarball through CI and GitHub Releases.

## Archive a workspace

```sh
cd /path/to/project
loom init --providers codex,claude,deepseek --interval 300
loom archive --summarizer codex-server
loom watch --summarizer codex-server
```

`init` writes a per-workspace config under `~/.loom/workspaces/<workspace-hash>/config.json`.
Without `--providers`, it enables all providers supported by Huihua. `loom providers`
prints the available IDs. `--workspace /absolute/path` lets you run from another directory.
Workspace matching includes subdirectories and resolves existing symlinks. Sessions without
an absolute workspace path are skipped; unrelated sessions are never assigned to your project.

`archive` runs once; it exits with status 1 if any source fails. `watch` scans immediately,
then waits the configured interval **after each completed scan**. It runs scans sequentially,
logs failures and retries on the next scan. Ctrl+C / SIGTERM stops after the current scan.

```sh
loom init --workspace /path/to/project --output /path/to/archives --interval 600
loom archive --workspace /path/to/project --summarizer codex-server
```

## Browse archives in a local browser

```sh
loom serve
# Open http://127.0.0.1:8787
```

The read-only server lists workspaces and their Markdown records, with a simple
Markdown preview and expandable original source. It reads `~/.loom/records` (or
`LOOM_STORAGE_DIR`) and custom output directories from workspace configs under
`LOOM_HOME`. Registered workspaces appear even before their first archive.
Refresh the page to see newly archived documents.

```sh
loom serve --port 9000
loom serve --output /path/to/archives
loom serve --config /path/to/config.json
```

`--output` browses the specified archive root; `--config` uses the output directory
from that config. No `loom init` is required to browse an existing archive root.
The server listens on `127.0.0.1` only. Ctrl+C stops it. It does not collect sessions
or call a summary model; run `loom watch` separately for automatic archiving.

## Background automatic archiving

After creating the config:

```sh
loom schedule install --summarizer codex-server
loom schedule status
loom schedule uninstall
```

- **macOS:** installs and starts a per-user LaunchAgent, restarted at login.
  Logs live in `~/.loom/logs/`.
- **Linux:** installs a systemd user service and starts it immediately. Logs are available
  through `journalctl --user -u loom-archive-<workspace-hash>.service`. Requires a running
  systemd user manager. To keep it running after logout, configure user lingering according
  to your machine's policy.
- **Windows / other systems:** use `loom watch` in your process manager or schedule
  `loom archive --config /absolute/path/config.json` with the OS scheduler.

Each workspace has its own service. To change service settings, edit the JSON config and
run `loom schedule install` again. The service stores absolute Node and CLI paths; reinstall
it if you move the package or change your Node installation. No administrator rights needed.
The computer must be awake; scans resume when the watcher can run again.

## Custom session roots

Use `--config /path/to/config.json` on any command. Paths in JSON are relative to the
config file; use absolute paths for portability. Provider roots replace Huihua's defaults.
`homeDir` optionally isolates discovery from the current user's home; otherwise Huihua
honors its documented provider environment variables.

```json
{
  "version": 1,
  "workspace": "/path/to/project",
  "outputDir": "/path/to/archives",
  "providers": ["codex", "claude", "deepseek"],
  "intervalSeconds": 300,
  "roots": {
    "codex": ["/path/to/codex/sessions"],
    "claude": ["/path/to/claude/projects"]
  }
}
```

`LOOM_HOME` changes the config/log base directory. `LOOM_STORAGE_DIR` overrides the default
archive output during `init`; output is saved in config for subsequent runs.

## Local summarization backend

Choose the local agent when starting the CLI:

```sh
loom archive --summarizer codex-server
loom watch --summarizer dsh
loom watch --summarizer dsh --summary-profile loom-summary
loom schedule install --summarizer codex-server
```

- **codex-server:** starts the installed `codex app-server --stdio`, initializes the JSON-RPC
  connection, opens an ephemeral read-only thread, and reads the final summary from completed
  turn notifications. It reuses your local Codex configuration and authentication.
- **dsh:** runs the installed `dsh --profile headless --json`, sends the summary task via stdin,
  and accepts the final answer only when the process exits successfully. Use
  `--summary-profile` to select your own headless profile.

`--summary-command /absolute/path` selects the executable when it is not on PATH.
Loom uses local subprocesses; it has no cloud API, API key or hosted model configuration.
The selected agent's own model/provider configuration remains under your control.

The backend can also be saved with `loom init --summarizer codex-server` or in JSON:

```json
"summary": {
  "provider": "codex-server",
  "command": "/absolute/path/to/codex",
  "maxInputChars": 24000,
  "timeoutSeconds": 180
}
```

For DSH, use `"provider": "dsh"` and optionally `"profile": "loom-summary"`.
`summary.args` accepts additional arguments as a JSON array, with no shell interpolation.
Backend flags override the saved setting for that run. `schedule install` saves the selected
backend and its resolved executable path so the background service uses the same selection.
Generated summary sessions run under `~/.loom/summary-runtime`, outside the workspace being
archived, to prevent the collector from repeatedly summarizing its own sessions.

## Archive behavior

Records live at `<outputDir>/<project-name>-<workspace-hash>/<session-source-hash>.md`.
The local agent synthesizes **all collected user and assistant text and execution evidence** into Goal, Requirements,
Interaction Summary, Outcome, Investigation, Key Decisions, Rejected Approaches and Follow-ups.
Requirements covers initial requests, later additions, constraints and corrections. Interaction
Summary describes key phases in source order: request, attempts, feedback and corrections,
failures, fixes and final state. Later corrections take precedence over rejected earlier
approaches. Tool calls, results, commands, exit codes, file changes and errors supply evidence;
calls without results do not prove success. Status claims must distinguish requested, reported
and verified work, naming relevant commands/tests and marking missing verification.

This is a semantic summary, not a full transcript or a fixed-length excerpt. Long histories are
processed in bounded chunks and their summaries are merged; input messages are not silently
cut off. Invalid model output, insufficient compression, failed processes or timeouts preserve
the existing archive and do not checkpoint the source as successful.

Client environment context is excluded from the goal and summary input. Text is redacted before
being sent to the local agent, and generated Markdown is redacted again before writing. Reasoning,
attachments and raw records are not included. Tool evidence enters the summary input but is
distilled instead of being appended as a transcript. Pattern redaction cannot identify every
secret. Missing or compacted source history cannot be reconstructed.

- Same session source → same file; changes, including tool-result-only updates, update the summary atomically.
- Old summary excerpts or transcript archives regenerate on the next successful scan.
- Unchanged sources and summary settings skip model calls across restarts. Missing output is recreated.
- Source identity includes provider, native ID and source locator to distinguish stores.
- A private `.state.json` stores hashes and metadata, never raw conversations.
- A per-workspace lock prevents concurrent jobs. Dead PID locks recover after a crash.
- Known Codex diagnostics for status records, tool parameters and pending tool results are
  warnings. Other parse diagnostics preserve the existing archive and retry later.
- Running sessions are snapshots, not automatically declared completed tasks.

## Development

```sh
pnpm --filter @liguobao/loom-cli... build
pnpm --filter @liguobao/loom-cli typecheck
pnpm --filter @liguobao/loom-cli test
pnpm cli --help
```
