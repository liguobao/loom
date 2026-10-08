# Loom CLI

TypeScript CLI for periodically archiving local Coding Agent sessions by workspace.
Session collection uses [Huihua](https://github.com/wibus-wee/huihua), pinned to 0.4.1.
Requires Node.js **22.18 or newer**.

## Install from this repository

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter loom-cli... build
mkdir -p artifacts
corepack pnpm --dir packages/cli pack --pack-destination ../../artifacts
npm install -g ./artifacts/loom-cli-0.1.0.tgz
loom --help
```

You can also install the `loom-cli-<version>.tgz` asset from a GitHub Release:

```sh
npm install -g ./loom-cli-0.1.0.tgz
```

The package bundles Loom's summarization code; installation does not need the monorepo.
An npm registry release can be installed with `npm install -g loom-cli` once published.
This repository currently ships the tarball through CI and GitHub Releases.

## Archive a workspace

```sh
cd /path/to/project
loom init --providers codex,claude,deepseek --interval 300
loom archive
loom watch
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
loom archive --workspace /path/to/project
```

## Background automatic archiving

After creating the config:

```sh
loom schedule install
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

## Archive behavior

Records live at `<outputDir>/<project-name>-<workspace-hash>/<session-source-hash>.md`.
Each record includes Loom's Goal, Outcome, Investigation, Key Decisions, Changed Areas and
Follow-ups sections with YAML metadata. This uses Loom's existing **rule-based** summarizer,
not an LLM. Text messages and normalized file changes feed the summary; reasoning, attachments,
native raw records and tool output are not copied. Secret redaction uses Loom's existing
pattern rules and cannot detect every possible secret.

- Same session source → same file; changes update the snapshot atomically.
- Unchanged content → skipped, even across restarts. Missing archive files are recreated.
- Source identity includes provider, native ID and source locator to distinguish stores.
- A private `.state.json` stores hashes and record metadata, never raw conversations.
- A per-workspace lock prevents overlapping manual and background jobs. Dead PID locks recover
  after a crash; parse diagnostics leave existing records untouched and retry on later scans.
- Original session stores are read only. No upload, network API or agent invocation occurs during collection.
- Running sessions are snapshots, not declared completed tasks. Git metadata comes from the session,
  rather than the current checkout of a possibly unrelated branch.

## Development

```sh
pnpm --filter loom-cli... build
pnpm --filter loom-cli typecheck
pnpm --filter loom-cli test
pnpm cli --help
```
