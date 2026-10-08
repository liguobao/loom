# Loom for DeepSeek Harness

Loom archives coding agent conversations as local Markdown work records.
It extracts goals, outcomes, investigations, decisions, changed areas and follow-ups
with a rule-based summarizer and applies pattern-based secret redaction.

## Install

Use the DeepSeek Harness plugin manager:

```sh
dsh plugin --profile web add -w @liguobao/dsh-loom@0.1.0
```

Restart Harness after installation. The plugin runs locally and does not upload
conversations. Pattern-based redaction cannot detect every possible secret.

For standalone session collection and scheduled archiving, install the CLI:

```sh
npm install -g @liguobao/loom-cli@0.1.0
cd /path/to/project
loom init --providers codex,claude,deepseek --interval 300
loom archive
```

The CLI requires Node.js 22.18 or newer.

## Documentation

See [the repository](https://github.com/liguobao/loom) and
[the CLI guide](https://github.com/liguobao/loom/blob/main/packages/cli/README.md).

License: MIT.
