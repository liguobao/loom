# Loom for DeepSeek Harness

Loom archives coding agent conversations as local Markdown work records.
It shares the CLI's semantic summarizer: requirements, chronological interactions,
investigations, decisions, outcomes, verification evidence and follow-ups. Tool calls,
results and errors are summarized alongside all user and assistant text. Text is
redacted before model input and generated Markdown is redacted before storage.

## Install

Use the DeepSeek Harness plugin manager:

```sh
dsh plugin --profile web add -w @liguobao/dsh-loom@0.1.0
```

Restart Harness after installation. The plugin runs locally and does not upload
conversations. Pattern-based redaction cannot detect every possible secret.

## Summary backend

By default the plugin runs the installed `dsh --profile headless --json` using your
DSH model configuration. To use Codex or a custom headless profile, set `summary`
in the plugin's Cordis configuration:

```yaml
summary:
  provider: codex-server
  command: /absolute/path/to/codex
  maxInputChars: 24000
  timeoutSeconds: 180
```

For DSH use `provider: dsh`, optionally `command` and `profile`. Both backends run
outside the archived workspace. The plugin is disabled in summary subprocesses to
prevent recursive archiving. The selected agent uses its own model/provider settings.
If the backend fails or returns invalid output, archiving fails without writing a
replacement excerpt. Existing records are preserved.

Interaction Summary follows the request, attempts, feedback, failures, fixes and final
state. A tool call alone does not prove success; missing verification is marked as
unverified. Archiving does not automatically mark a task completed. Missing or
compacted source history cannot be reconstructed.

For standalone session collection and scheduled archiving, install the CLI:

```sh
npm install -g @liguobao/loom-cli@0.1.0
cd /path/to/project
loom init --providers codex,claude,deepseek --interval 300
loom archive --summarizer codex-server
```

The CLI requires Node.js 22.18 or newer.

## Documentation

See [the repository](https://github.com/liguobao/loom) and
[the CLI guide](https://github.com/liguobao/loom/blob/main/packages/cli/README.md).

License: MIT.
