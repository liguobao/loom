# Loom

**保留工作成果，而不是聊天记录。**

Loom 是建立在 [DeepSeek Harness](https://github.com/liguobao/ds-harness) 之上的轻量团队协作与项目记忆层。开发者继续在本地使用自己的机器、代码仓库和 Conversation 工作。团队成员在获得授权后可以实时观察当前工作，工作结束后本地生成精炼的 Markdown 工程记录，成为团队可搜索、可回溯的项目记忆。

→ [English](./README.md)

## 做什么

1. **工作进行时** — 团队成员可以在权限允许的情况下，通过端到端加密通道，实时只读查看你当前的 DSH 工作状态。
2. **工作结束后** — 完整 Conversation 留在你的本地机器上。只有精炼后的 Markdown 工程记录上传到 Loom Server，形成可搜索的项目知识库。

## 不做什么

Loom 不编排 Agent，不托管 IDE，不管理 Sprint，不监控开发者。不要求统一环境，不上传原始 Conversation，不改变你使用 Git 或 DSH 的方式。

## 与 DSH Remote 的关系

Loom 建立在 [ds-harness-remote](https://github.com/liguobao/ds-harness-remote) 之上。Remote 解决的是 *"我如何远程继续使用自己的本地 DSH"*。Loom 解决的是 *"团队成员如何在权限控制下观察彼此的工作，并保留项目记忆"*。

Loom 复用 Remote 的成熟传输层：

| 能力 | 来源 |
|---|---|
| 端到端加密 | Noise IK (`Noise_IK_25519_ChaChaPoly_SHA256`) — `@dsh-remote/crypto` |
| 安全通道 | WebSocket 控制通道 + Noise 传输层 |
| 设备身份 | X25519 静态密钥对，本地锁定 |
| 中继 | 服务端路由不透明密文，不读取会话内容 |
| 在线状态 | WebSocket 在线/离线和设备元数据 |

核心区别在于信任边界。Remote 连接 **我的客户端 → 我的 Host**（同一账号）。Loom 连接 **用户 A → 用户 B 的 Host**（跨组织成员），增加了成员管理、跨用户授权和 Observer 权限模型。

## 整体架构

```text
                       Loom
                        │
        ┌───────────────┼───────────────┐
        │               │               │
      实时面           归档面          控制面
        │               │               │
      E2EE           Markdown         SQLite
        │               │               │
  本地 DSH Host      项目记忆          身份拓扑
  Conversation
```

### 实时面（Live Plane）

实时在线状态和 Observer 中继。Conversation 流在 Host 本地加密，只有被授权的 Observer 能用 Noise IK 解密。服务端路由密文，无法读取 Prompt、Agent 输出、Tool Call、Terminal 内容、工作区路径或源代码。详见 [端到端加密](docs/end-to-end-encryption.md)。

### 归档面（Archive Plane）

磁盘上的 Markdown 文件，每个 Work Record 一个文件。SQLite FTS5 在上层提供全文搜索索引。Markdown 文件是正文的唯一真源。数据库丢失时，`loom reindex` 通过扫描文件重建索引。详见 [归档格式](docs/archive-format.md)。

### 控制面（Control Plane）

SQLite 管理身份、组织、工作区、项目、机器、Host 实例、成员关系和权限。这是服务端需要在数据库中持久化的唯一状态；Work Record 内容存储在 Markdown 文件中。

## Observer 权限级别

| 级别 | 其他人能看到什么 |
|---|---|
| `hidden` | 什么都看不到。Host 对组织完全隐身。 |
| `presence` | 用户在线、在哪个项目、工作标题、经过时间。 |
| `observe` | 通过 E2EE 的完整只读 Conversation 流。 |

建立连接前必须通过三个检查：

1. **服务端 ACL** — 组织/工作区/项目的成员关系和权限级别。
2. **Host 本地策略** — Host 所有者独立控制共享，不受服务端覆盖。
3. **对等方身份** — Observer 的设备身份密钥必须已知且已授权。

Host 本地策略拥有最终否决权。服务端无法覆盖一个已禁用共享的 Host。

第一版不实现跨用户控制（`send prompt`、`approve`、`terminal`、`write file`）。Observer 严格只读。

## 仓库结构

```text
loom/
├── apps/
│   └── web/             # React 19 前端
│
├── packages/
│   ├── protocol/        # 共享 TypeScript 类型、Zod schema、WebSocket 消息类型
│   ├── crypto/          # Noise IK E2EE（X25519 + ChaCha20-Poly1305 + HKDF-SHA256）
│   ├── db/              # SQLite schema、查询、FTS5 全文搜索、索引重建
│   ├── distill/         # Work Record 生成、Secret Redaction、Git 上下文
│   └── client/          # 本地 CLI（loom 命令）和 SDK
│
├── docs/
│   ├── product.md           # 产品规格
│   ├── architecture.md      # 技术架构
│   ├── end-to-end-encryption.md
│   ├── archive-format.md    # Work Record Markdown 格式
│   └── server-api.md        # Server API 契约
│
└── data/                # 运行时：SQLite DB + Markdown 记录（已 gitignore）
```

### 仓库边界

本仓库实现本地客户端包（protocol、crypto、db、distill、client）、Web 前端和协议/API 规范。**Loom Server 闭源**，独立维护。`docs/server-api.md` 中的 Server API 契约是客户端包与 Server 之间的互操作规范。

## 快速开始

### 前置要求

- Node.js ≥ 22
- pnpm ≥ 9

### 安装和构建

```bash
git clone https://github.com/liguobao/loom
cd loom
pnpm install
pnpm build
```

### CLI

```bash
# 构建后，CLI 位于 packages/client/dist/cli.js
node packages/client/dist/cli.js --help
```

| 命令 | 说明 |
|---|---|
| `loom login` | 登录 Loom Server |
| `loom logout` | 退出登录 |
| `loom whoami` | 显示当前用户和 Server |
| `loom init` | 将当前目录绑定到 Loom Project |
| `loom status` | 显示绑定、登录和项目状态 |
| `loom search <query>` | 搜索 Work Records |
| `loom record list` | 列出当前项目的最近记录 |
| `loom record show <id>` | 查看 Work Record 详情 |
| `loom host register` | 注册本地 Host Instance |

### Web 前端（开发模式）

```bash
cd apps/web
pnpm dev
# http://localhost:5173 — 需要运行中的 Loom Server（默认 localhost:3000）
```

## Work Record 格式

Work Record 是带有 YAML Front Matter 的 Markdown 文件。文件是规范内容，数据库只存储索引。

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

# 增加团队成员实时查看本地 DSH Agent 的能力

## Goal

允许同一 Workspace 中的成员，在 owner 授权的前提下，实时只读查看其当前本地 DSH Conversation。

## Outcome

完成只读 Observer 模式，支持成员查看 Conversation stream 和 Agent 状态，但不能发送 Prompt、批准权限或使用 Terminal。

## Investigation

最初考虑直接复用现有 Remote Client 权限模型。进一步确认 ds-harness-remote 当前主要基于同账号 membership，因此 Loom 需要在此之上增加组织级 membership 和跨用户授权。

## Key Decisions

- 实时查看默认只读。
- Loom Server 不读取 Conversation 明文。
- Host 本地策略拥有最终否决权。
- 复用 ds-harness-remote 现有的 Noise E2EE transport。

## Rejected Approaches

### 把完整 Conversation 同步到 Server

放弃。会增加隐私风险，违背 Loom 的 local-first 原则。

## Changed Areas

- packages/remote/observer.ts
- apps/server/permissions.ts
- apps/web/live-view.tsx

## Follow-ups

以后可以考虑显式开启 Collaborate 模式，但第一版不允许跨用户控制 Agent。
```

Work Record 至少必须包含：Title、Goal、Outcome、Key Decisions、Changed Areas 和 Git 上下文。只有一句普通 Summary 的记录不符合质量要求。

## Secret Redaction

Markdown 离开本地机器之前，客户端会扫描并将敏感值替换为 `[REDACTED]`：

- API Key（`sk-*`、`ghp_*`、`AKIA*`、`github_pat_*`）
- 配置中的密码和数据库凭证
- 私钥（RSA、EC、OpenSSH）
- Bearer Token
- Cookie Header
- `.env` 风格的 `SECRET_KEY=value` 模式
- 包含嵌入凭证的数据库连接字符串

服务端永远不会收到原始 Conversation 内容。它只收到已脱敏的 Markdown 工程记录。

## 端到端加密

Loom 复用 [ds-harness-remote](https://github.com/liguobao/ds-harness-remote) 的 `Noise_IK_25519_ChaChaPoly_SHA256` 协议套件。协议、密钥生命周期、握手、重放保护和可见元数据遵循 [ds-harness-remote/docs/end-to-end-encryption.md](https://github.com/liguobao/ds-harness-remote/blob/main/docs/end-to-end-encryption.md) 中记录的同一规范。

在 Loom 上下文中：

- **Observer** 是发起方（知道 Host 的静态公钥）。
- **Host** 是响应方。
- 握手完成后，Host 流式发送加密的 Conversation 片段；Observer 在本地解密。
- 服务端中继不透明密文。它可以观察连接元数据（谁连接了谁、时间戳、消息大小），但无法读取业务内容。

## 数据目录结构

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

`loom.db` 丢失时，可以从 Markdown 文件重建索引。Markdown 是真源，数据库是可丢弃的加速层。

## 技术栈

| 组件 | 技术 |
|---|---|
| 运行时 | Node.js 22，TypeScript 5 |
| 包管理 | pnpm 9（workspace monorepo） |
| 加密 | `@noble/curves`、`@noble/ciphers`、`@noble/hashes` — Noise IK |
| 数据库 | better-sqlite3（WAL 模式，FTS5） |
| 前端 | React 19、Vite 5、TailwindCSS 4、Zustand、TanStack Query |
| 构建 | tsup |
| ID 生成 | ULID |

## 设计原则

1. 把 Work Record 放在第一位；Conversation 是原材料，不是交付物。
2. 实时观察必须显式、上下文相关，且不可能在没有 Host 同意的情况下建立。
3. 明确展示连接和加密状态，包括离线、中继和降级状态。
4. 保持开发者现有的本地工作流；`cd project && dsh` 时 Loom 是隐形的。
5. 把远程观察限制在只读边界内；永远不暗示 Loom 授予了控制权。

## 反模式

不要把 Loom 变成：

- **员工监控** — Presence 是协作信息，不是绩效指标。不要展示"谁工作了多久"或"谁用了最多 Token"。
- **Agent 编排** — Loom 不关心开发者使用什么模型、Agent 或 Runtime。
- **云 IDE** — 开发资源属于开发者的本地机器。
- **项目管理工具** — 没有 Epic、Sprint、Story 或审批链。这些用 GitHub Issues、Linear 或 Jira。
- **Codecast 平台** — 没有 Session 同步、Remote Steering、Agent Fork 或 Cloud Runtime。

## License

MIT
