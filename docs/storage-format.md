# Loom 存储格式规范（Storage Format Specification）

状态：草案 v0.1  
日期：2026-10-01  
真源：磁盘 Markdown 文件（唯一正文真源），SQLite 仅作为控制面及检索加速索引。

---

## 1. 设计原则

1. **Markdown 是唯一正文真源**：所有归档工程记录均以原生 `.md` 文件存储在文件系统中，禁止将 Work Record 正文存储在数据库中。
2. **人类可读与便携**：数据可直接由人阅读、Git 管理、rsync 备份、离线归档、ripgrep 检索，不与任何专有数据库 Schema 绑定。
3. **数据库随时可丢弃重建**：若 SQLite 索引文件损坏或丢失，系统支持随时从磁盘扫描 Markdown 文件并重建完整全文索引（`rebuildRecordIndex`）。
4. **控制面与数据面分离**：
   - **Control Plane（SQLite）**：负责账号、组织、工作区、项目、机器拓扑、实时在线及搜索索引。
   - **Archive Plane（Filesystem）**：负责高价值工程记录持久化存储。

---

## 2. 目录层级结构

Loom 的物理存储层级与逻辑模型保持严格一致：

```text
data/
├── loom.db                                          # 控制面 SQLite 数据库及全文索引
└── organizations/
    └── <organization-id>/
        └── workspaces/
            └── <workspace-id>/
                └── projects/
                    └── <project-id>/
                        └── records/
                            └── <year>/
                                └── <month>/
                                    ├── <ulid-1>.md  # 单条工程记录 Markdown 文件
                                    └── <ulid-2>.md
```

### 路径规则与字段定义：
- `<organization-id>`：组织 ID（ULID 或 slug）。
- `<workspace-id>`：工作区 ID（ULID 或 slug）。
- `<project-id>`：项目 ID（ULID 或 slug）。
- `<year>` / `<month>`：按 **UTC 时间**生成的 4 位年份和 2 位月份（如 `2026/10`），避免跨时区命名分歧。
- `<ulid>.md`：每条记录生成唯一的 ULID（大写），按时间自然递增排序。

相对路径示例：
```text
organizations/01KABC123ORG/workspaces/01KABC456WS/projects/01KABC789PRJ/records/2026/10/01KABC999REC.md
```

---

## 3. 文件内容规范（Front Matter + Markdown Body）

每个 Work Record 文件由顶部的 **YAML Front Matter** 和下方的 **结构化 Markdown 正文** 构成。

### 3.1 完整文件范例

```markdown
---
id: 01KABC123
organization: org_engineering
workspace: ws_dev
project: loom
owner: user_guobao

created_at: 2026-10-01T01:30:00+08:00
completed_at: 2026-10-01T02:10:00+08:00

repository: liguobao/loom
branch: feat/live-view
base_commit: abc1234
final_commit: def5678

tags:
  - remote
  - websocket
  - permissions

source_conversation_count: 2
---

# 增加团队成员实时查看本地 DSH Agent 的能力

## Goal
允许同一 Workspace 中的成员，在 owner 授权的前提下，实时只读查看其当前本地 DSH Conversation。

## Outcome
完成只读 Observer 模式，支持成员查看 Conversation stream 和 Agent 状态，但不能发送 Prompt、批准权限或使用 Terminal。

## Investigation
最初考虑直接复用现有 Remote Client 权限模型。进一步确认 ds-harness-remote 当前主要基于同账号 membership，因此 Loom 需要在此之上增加 organization membership 和跨用户授权。

## Key Decisions
- 实时查看默认只读。
- Loom Server 不读取 Conversation 明文。
- Host 本地策略拥有最终否决权。
- 复用现有 Noise E2EE transport。

## Rejected Approaches
### 把完整 Conversation 同步到 Server
放弃。会增加隐私风险，也违背 Loom 的 local-first 原则。

## Changed Areas
- packages/remote/observer.ts
- apps/server/permissions.ts
- apps/web/live-view.tsx

## Follow-ups
以后可以考虑显式开启 Collaborate 模式，但第一版不允许跨用户控制 Agent。
```

---

## 4. Front Matter 字段规范

| 字段名 | 类型 | 必需 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 记录唯一标识符（ULID 格式） | `01KABC123` |
| `organization` | string | 是 | 所属 Organization 标识 | `org_engineering` |
| `workspace` | string | 是 | 所属 Workspace 标识 | `ws_dev` |
| `project` | string | 是 | 所属 Project 标识 | `loom` |
| `owner` | string | 是 | 创作者用户 ID 或用户名 | `user_guobao` |
| `created_at` | string | 是 | 记录开始或创建时间（ISO 8601，带时区） | `2026-10-01T01:30:00+08:00` |
| `completed_at` | string | 否 | 记录完成时间（ISO 8601，带时区） | `2026-10-01T02:10:00+08:00` |
| `repository` | string | 否 | 规范化代码仓库（`owner/repo` 格式，去除协议与 `.git`） | `liguobao/loom` |
| `branch` | string | 否 | 工作进行时的 Git 分支名 | `feat/live-view` |
| `base_commit` | string | 否 | 工作开始时的起始 Commit Hash | `abc1234` |
| `final_commit` | string | 否 | 工作完成时的最终 Commit Hash | `def5678` |
| `tags` | string[] | 否 | 标签列表，用于分类与检索过滤 | `[remote, websocket]` |
| `source_conversation_count` | integer | 否 | 本次工作所提炼的原始 Conversation 轮数/数量 | `2` |

---

## 5. Markdown 正文结构规范

记录正文**严禁只保存一句模糊摘要（Summary）**，必须提取有长期工程回溯价值的结构化要素：

| 章节名称 | 级别 | 必需 | 内容说明 |
|---|---|---|---|
| **Title** | `#` (H1) | 是 | 清晰、精炼的本次工程任务名称 |
| **## Goal** | `##` (H2) | 是 | 当时在解决什么问题，预期达成的目标 |
| **## Outcome** | `##` (H2) | 是 | 最终实际交付了什么成果，完成了哪些能力 |
| **## Investigation** | `##` (H2) | 否 | 问题排查与技术探索过程，关键依据与背景确认 |
| **## Key Decisions** | `##` (H2) | 是 | 关键技术判断与方案选型，**为什么这么做** |
| **## Rejected Approaches** | `##` (H2) | 否 | 尝试过但放弃的备选方案，以及**放弃的原因** |
| **## Changed Areas** | `##` (H2) | 是 | 本次工作涉及修改的核心模块、代码路径列表 |
| **## Follow-ups** | `##` (H2) | 否 | 遗留问题、待优化点、风险点及后续注意事项 |

---

## 6. 仓库路径规范化（Repository Normalization）

为了消除不同开发者本地 Git Remote 地址的格式差异，`repository` 字段在入库与归档时统一规范为 `owner/repo`：

| 输入格式 | 规范化结果 |
|---|---|
| `git@github.com:liguobao/loom.git` | `liguobao/loom` |
| `https://github.com/liguobao/loom.git` | `liguobao/loom` |
| `https://github.com/liguobao/loom` | `liguobao/loom` |
| `ssh://git@gitlab.company.com/team/repo.git` | `team/repo` |

---

## 7. 本地敏感信息脱敏（Secret Redaction）

在由本地 Conversation 生成 Markdown 并上传前，本地客户端必须执行自动脱敏处理。所有匹配项均替换为标记 `[REDACTED]`：

1. **API Key / Token**：
   - OpenAI / Anthropic 等：`sk-[a-zA-Z0-9_\-]{20,}`
   - GitHub Token：`ghp_[a-zA-Z0-9]{36}`、`github_pat_[a-zA-Z0-9_]{82}`
   - AWS Access Key：`AKIA[0-9A-Z]{16}`
2. **私钥与证书块**：
   - `-----BEGIN (RSA \|EC \|OPENSSH )?PRIVATE KEY-----`
3. **配置文件密码与数据库凭据**：
   - 显式密码：`password[s]?\s*[:=]\s*['"]?[^\s'"]{8,}`
   - 数据库连接字符串：`(postgres|mysql|mongodb)(\+[a-z]+)?://[^:\s]+:[^@\s]+@`
4. **环境变量敏感定义**：
   - `[A-Z_]{3,}_(KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)\s*=\s*\S+`
5. **HTTP 鉴权头**：
   - `Bearer\s+[a-zA-Z0-9_\-\.]{20,}`
   - `Cookie:\s*.+`

服务端接收到的只有脱敏后的 Markdown 文件，原始会话中的敏感密钥永远不会传输到服务端。

---

## 8. SQLite 索引结构与重建机制（Index & Rebuild）

SQLite 数据库仅保存便于快速查询的索引元数据，Schema 对应关系如下：

```sql
CREATE TABLE record_index (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  title TEXT NOT NULL,
  repository TEXT,
  branch TEXT,
  final_commit TEXT,
  tags TEXT,
  changed_areas TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 全文检索虚拟表（FTS5）
CREATE VIRTUAL TABLE record_fts USING fts5(
  title,
  tags,
  changed_areas,
  content='record_index',
  content_rowid='rowid'
);
```

### 索引重建（Rebuild）：
当 SQLite 数据库丢失或迁移时，调用索引重建器：
1. 递归遍历 `data/organizations/` 下所有 `.md` 结尾文件；
2. 读取文件并使用 YAML 解析器提取 Front Matter；
3. 将元数据同步插入 `record_index` 表；
4. SQLite 触发器自动重建 `record_fts` 全文索引。
