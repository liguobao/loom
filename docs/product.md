# Loom Product Specification

Status: Draft v0.1
Date: 2026-10-01

## Product Purpose

Loom is a team collaboration and project-memory layer for DeepSeek Harness. It provides two capabilities on top of the developer's existing local workflow:

1. **Live observation** — team members can watch an active DSH session in real-time, read-only, over an end-to-end encrypted channel, with the Host owner's explicit permission.
2. **Project memory** — after work is finished, the full conversation stays local. A distilled Markdown work record is uploaded to the Loom Server, forming a searchable, browseable knowledge base of engineering decisions.

## Users

Developers who use DeepSeek Harness and work in a team where:

- Multiple people contribute to the same codebase.
- Past engineering decisions, rejected approaches, and problem investigations have long-term value.
- Team members sometimes want to see what a colleague is working on, without interrupting them.

## Non-goals

Loom does not aim to be:

- An Agent orchestration platform (no Multi-Agent, Workflow, Role, Handoff, Graph, Pipeline, Scheduler).
- A cloud IDE or remote terminal host.
- A project management tool (no Epics, Sprints, Stories, Kanban, approval chains).
- An employee monitoring tool (no productivity metrics, time tracking, token usage dashboards).
- A session synchronization or Codecast platform.

## Product principles

### 1. Do not change individual development habits

After joining Loom, the developer still does:

```text
cd project
dsh
```

Loom does not require entering a unified IDE, creating a task before starting work, uploading source code, uploading raw conversations, migrating terminals, or changing Git usage.

Ideal state during development: *Loom is nearly invisible.*
When retrospecting: *Loom immediately tells you what the team did and why.*

### 2. Outcomes and key process have value; noise does not

A full AI conversation contains enormous noise: file reads, grep, tool calls, repeated explanations, debug streams, terminal output, failed attempts, intermediate results. These should not be uploaded wholesale.

The following information has long-term value:

- What problem was being solved
- What was ultimately done
- How the problem was located
- Why this approach was chosen
- What alternatives were tried and rejected
- What the key engineering judgments were
- Which modules were changed
- Corresponding commit / PR
- Remaining issues and follow-up notes

Conversation is raw material. Work Record is the team asset.

### 3. Host always has final authority

The Server cannot force a Host to share its live session. The Host local policy has final veto over any observation request, regardless of server-side ACL. This is a non-negotiable privacy guarantee.

## Data model

```text
Organization
  ↓
Workspace
  ↓
Project
  ├── Active Work (live, ephemeral)
  └── Work Records (archived, persistent)
```

No forced abstractions: no Requirement, Epic, Sprint, Story, or Workflow at the Loom level. External tools (GitHub Issues, Linear, Jira) can be linked if needed.

## Relationship to ds-harness-remote

| | DSH Remote | Loom |
|---|---|---|
| Trust boundary | Same account | Cross-user, organization membership |
| Connection | My client → my host | User A → User B's host |
| Purpose | Continue my own work from another device | Observe teammate's work; retain project memory |
| E2EE | Noise IK | Same Noise IK (reused) |
| Server reads content | No | No |
| Session control | Full control (prompts, approvals, terminal) | Read-only observation (v1) |

## Brand personality

Quiet, precise, trustworthy. The interface feels familiar to users of GitHub, Linear, and DSH itself: focused on the current context, clear about connection and security state, free of decorative ceremony.
