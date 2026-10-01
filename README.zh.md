# Loom

**保留工作成果，而不是聊天记录。**

Loom 是建立在 [DeepSeek Harness](https://github.com/liguobao/ds-harness) 之上的轻量团队协作与项目记忆层。开发者继续在本地使用自己的机器、代码仓库和 Conversation 工作。团队成员在获得授权后可以实时观察当前工作状态，工作结束后本地生成精炼的 Markdown 记录，成为团队共享的项目记忆。

→ [English Documentation](./README.md)

---

## 核心理念

| 原则 | 含义 |
|------|------|
| **Local-first** | 完整 Conversation 留在你的机器上，只有精炼后的 Markdown 会被共享 |
| **Privacy by default** | 实时流使用 E2EE 加密，服务端永远不会读取你的 Prompt 或 Agent 输出 |
| **Search-first** | 快速找回过去的决策和上下文，而不是翻阅历史记录 |
| **低侵入** | `cd project && dsh` — 工作时几乎感觉不到 Loom 的存在 |

## Loom 不是什么

- ❌ 不是 Agent 编排平台
- ❌ 不是云 IDE 或远程终端
- ❌ 不是员工监控工具
- ❌ 不是项目管理工具（没有 Epic、Sprint、Story）

---

## 整体架构

```
                       Loom
                        │
        ┌───────────────┼───────────────┐
        │               │               │
      实时面           归档面          控制面
        │               │               │
      E2EE           Markdown         SQLite
        │               │               │
   本地 DSH          项目记忆          身份拓扑
   Conversation
```

**三个数据面：**

- **实时面（Live Plane）** — 实时在线状态和 Observer 中继。E2EE（Noise IK）。服务端只路由密文，永不读取内容。
- **归档面（Archive Plane）** — 磁盘上的 Markdown 文件。上层是 SQLite FTS5 索引。如果索引丢失，`loom reindex` 可从文件重建。
- **控制面（Control Plane）** — SQLite 管理身份、成员、权限、机器和 Host 实例。

## Observer 权限级别

| 级别 | 其他人能看到什么 |
|------|-----------------|
| `hidden` | 什么都看不到 — 你完全隐身 |
| `presence` | 你在线、在哪个项目、工作了多久 |
| `observe` | 完整只读 Conversation 流（E2EE 加密） |

控制权始终在 Host 本地。服务端 ACL + Host 本地策略 + 对等方身份，三者全部通过才能建立连接。

---

## 仓库结构

```
loom/
├── apps/
│   ├── server/          # Hono 服务端 — 控制面 + 归档面 + 实时面
│   └── web/             # React 19 前端
│
├── packages/
│   ├── protocol/        # 共享 TypeScript 类型和 Zod Schema
│   ├── crypto/          # Noise IK E2EE（X25519 + ChaCha20-Poly1305）
│   ├── db/              # SQLite schema、查询、FTS5 索引
│   ├── distill/         # Work Record 生成 + Secret Redaction
│   └── client/          # 本地 CLI（loom 命令）
│
├── docs/
└── data/                # SQLite DB + Markdown 记录（已加入 .gitignore）
```

---

## 快速开始

### 前置要求

- Node.js ≥ 22
- pnpm ≥ 9

### 安装

```bash
git clone https://github.com/liguobao/loom
cd loom
pnpm install
```

### 构建所有包

```bash
pnpm build
```

### 启动服务端

```bash
cd apps/server
cp .env.example .env
node dist/main.js
# Server: http://localhost:3000
# WebSocket: ws://localhost:3000/ws
```

### 启动 Web 前端（开发模式）

```bash
cd apps/web
pnpm dev
# http://localhost:5173
```

### 使用 CLI

```bash
node packages/client/dist/cli.js login      # 登录
node packages/client/dist/cli.js init       # 绑定当前目录到项目
node packages/client/dist/cli.js status     # 查看状态
node packages/client/dist/cli.js search "token refresh websocket"
node packages/client/dist/cli.js record list
```

---

## CLI 命令

| 命令 | 说明 |
|------|------|
| `loom login` | 登录 Loom Server |
| `loom logout` | 退出登录 |
| `loom whoami` | 查看当前用户 |
| `loom init` | 将当前目录绑定到 Loom Project |
| `loom status` | 查看绑定和登录状态 |
| `loom search <query>` | 搜索 Work Records |
| `loom record list` | 列出当前项目的最近记录 |
| `loom record show <id>` | 查看 Work Record 详情 |
| `loom host register` | 注册本地 Host Instance |

---

## Work Record 格式

Work Record 是带有 YAML Front Matter 的 Markdown 文件。文件是正文的唯一真源，SQLite 只是索引。

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
完成只读 Observer 模式，支持成员查看 Conversation stream 和 Agent 状态。

## Investigation
…

## Key Decisions
- 实时查看默认只读。
- Loom Server 不读取 Conversation 明文。
- Host 本地策略拥有最终否决权。

## Rejected Approaches
### 把完整 Conversation 同步到 Server
放弃。原因：会增加隐私风险，违背 local-first 原则。

## Changed Areas
- packages/remote/observer.ts
- apps/server/ws/handler.ts

## Follow-ups
以后可以考虑显式开启 Collaborate 模式。
```

---

## Secret Redaction

上传 Markdown 前，本地客户端会自动扫描并脱敏：

- API Key（`sk-*`、`ghp_*`、`AKIA*` 等）
- 密码和数据库凭证
- 私钥和 SSH Key
- Bearer Token 和 Cookie Header
- `.env` 风格的 `SECRET=value` 模式

脱敏后的值替换为 `[REDACTED]`。服务端永远不会收到原始 Conversation 内容，只会收到已脱敏的 Markdown。

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 运行时 | Node.js 22，TypeScript 5 |
| 包管理 | pnpm 9（workspace monorepo） |
| 服务端 | Hono + @hono/node-server |
| 数据库 | better-sqlite3（SQLite WAL + FTS5） |
| WebSocket | ws |
| 加密 | @noble/curves + @noble/ciphers（Noise IK） |
| 前端 | React 19、Vite 5、TailwindCSS 4 |
| 状态管理 | Zustand + TanStack Query |
| 构建 | tsup |
| ID 生成 | ULID |

---

## 数据目录结构

```
data/
├── loom.db                          # SQLite（控制面 + 记录索引）
└── organizations/
    └── <org-id>/
        └── workspaces/
            └── <workspace-id>/
                └── projects/
                    └── <project-id>/
                        └── records/
                            └── 2026/
                                └── 10/
                                    └── 01KABC....md   # Work Record（正文真源）
```

如果 `loom.db` 丢失，可以通过扫描 Markdown 文件重建索引。

---

## MVP 功能清单

### 服务端
- [x] 用户认证（注册 / 登录 / session token）
- [x] Organization / Workspace / Project CRUD
- [x] Machine + Host Instance 注册
- [x] 成员和权限管理
- [x] Presence（WebSocket，按项目订阅）
- [x] Observer 中继（E2EE 密文透传）
- [x] Markdown 记录存储（文件系统）
- [x] SQLite FTS5 全文搜索
- [x] `GET /api/search?q=` 接口

### 本地客户端（CLI）
- [x] `loom login / logout / whoami`
- [x] `loom init` — 项目绑定
- [x] `loom status`
- [x] `loom search`
- [x] `loom record list / show`
- [x] 配置持久化（`~/.config/loom`）
- [x] Presence WebSocket 客户端
- [x] 归档流水线（distill → redact → upload）

### Web 前端
- [x] 登录 / 注册
- [x] Workspace 列表
- [x] Project 列表
- [x] Project 页面（Active Work + 搜索 + Work Records）
- [x] Work Record 详情页
- [x] Active Work 实时轮询

---

## License

MIT
