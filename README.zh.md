<p align="center">
  <img src="docs/logo.svg" alt="Loom for DeepSeek Harness" width="600">
</p>

<p align="center">
  <a href="README.md">English</a>
  &nbsp;·&nbsp;
  <strong>中文</strong>
  &nbsp;·&nbsp;
  <a href="docs/product.md">产品规范</a>
  &nbsp;·&nbsp;
  <a href="docs/architecture.md">系统架构</a>
  &nbsp;·&nbsp;
  <a href="docs/end-to-end-encryption.md">端到端加密</a>
  &nbsp;·&nbsp;
  <a href="docs/storage-format.md">存储格式</a>
  &nbsp;·&nbsp;
  <a href="docs/protocol.md">协议与 API 规范</a>
</p>

## Keep the work, not the chat.

Watch the work while it happens. Keep only what matters afterward.

Loom（Loom for DeepSeek Harness）是建立在 **DeepSeek Harness（DSH）本地工作流之上的轻量团队协作与项目记忆层**。

它不是新的 IDE，也不是新的 Agent 平台。

团队成员仍然：

- 在自己的本地电脑开发；
- 使用自己的本地 Git 仓库；
- 正常使用 DeepSeek Harness；
- 使用自己习惯的模型和工具；
- 在本地执行 Terminal、文件操作、测试和代码修改；
- 在本地保存完整 Conversation。

Loom 不改变这个工作方式，只补充两类能力：

1. **工作进行时**，团队成员可以在权限允许的情况下实时查看另一个成员当前本地 DSH Agent 的工作状态和 Conversation。
2. **工作结束后**，完整 Conversation 仍留在用户本地，只把压缩后的高价值工程记录以 Markdown 形式上传到 Loom Server，形成团队可搜索、可回溯的项目记忆。

底层通信与端到端安全传输复用自 [ds-harness-remote](https://github.com/liguobao/ds-harness-remote) 的成熟实现。

## 主要特性

- **工作实时观察**：经主机所有者授权后，成员可实时只读查看其本地 DSH Agent 工作状态与会话流。
- **默认端到端加密**：实时会话采用双向端到端加密（`Noise_IK_25519_ChaChaPoly_SHA256`）。服务端仅透传不透明密文，无法读取 Prompt、回复内容、终端输入输出或源代码。
- **本地否决权**：主机本地策略拥有最高控制权。服务端 ACL 无法强行共享本地会话。
- **持久项目记忆**：工作结束后，充满调试流水和工具调用的原始对话留在本地，仅将提炼出的高价值决策生成结构化 Markdown 记录。
- **以 Markdown 为真源**：归档记录以 `.md` 文件持久化保存在磁盘上。SQLite 仅作为辅助索引和控制面。
- **本地敏感信息脱敏**：API Key、Token、私钥、密码、数据库连接串及 `.env` 敏感配置在离开机器前于本地完成脱敏。
- **无感工作流**：保持 `cd project && dsh` 的日常习惯。不强制统一云端 IDE，不要求开工先提工单，不搞多 Agent 复杂编排。

## 工作原理

```text
主机 DSH 设备（本地）                Loom 服务端（不透明中继）         观察者客户端（Web / CLI）
  DSH Agent / 本地会话
             │
      本地主机插件
  （Noise IK E2EE 加密）─────────────► WSS 中继 ─────────────►（Noise IK E2EE 解密）
             │                        （无法解密）                     │
      工作结束（本地）                                          只读实时观察界面
             │
      提炼 + 本地脱敏
             │
   Markdown 工程记录 ────────────────► 写入磁盘（.md 文件）
（Front Matter + 正文）                 + SQLite FTS5 索引 ────────► 检索项目知识库
```

Loom 服务端完全无需接触会话明文。实时数据流过加密管道，历史归档也仅包含脱敏后的结构化 Markdown。

## 观察者权限级别

| 级别 | 其他人能看到什么 |
|---|---|
| `hidden` | 隐身。主机不对外广播活动状态。 |
| `presence` | 用户在线、所属项目标识、工作标题、已进行时长。 |
| `observe` | 通过端到端加密安全通道实时接收只读会话流。 |

建立连接需要三重校验全部通过：
1. **服务端 ACL**：组织、工作区和项目成员资格校验。
2. **主机本地策略**：本地开启共享开关，并核对本地授权名单。
3. **对等方身份**：经本地锁定的 X25519 设备公钥身份验证。

第一版中，观察者模式为严格只读。观察者无法发送 Prompt、批准危险权限、修改文件或执行终端命令。

## 工程记录（Work Record）格式

工程记录以带有 YAML Front Matter 的 Markdown 文件存储。文件存储结构如下：

```text
data/organizations/<org-id>/workspaces/<ws-id>/projects/<proj-id>/records/<year>/<month>/<ulid>.md
```

记录保留关键工程判断与上下文，剔除冗长对话流水：

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
以后可以考虑显式开启协作模式，但第一版不允许跨用户控制 Agent。
```

## 安装

### CLI 安装与定时归档

新增独立 TypeScript CLI，基于 [huihua](https://github.com/wibus-wee/huihua) 收集 Codex、Claude、Cursor、DeepSeek Harness 等工具的本地会话。需要 Node.js **22.18+**。

从 GitHub Release 下载 `loom-cli-<版本>.tgz` 后安装：

```sh
npm install -g ./loom-cli-0.1.0.tgz
cd /path/to/project
loom init --providers codex,claude,deepseek --interval 300
loom archive                 # 立即归档一次
loom schedule install        # 安装并启动后台定时归档（macOS / Linux）
loom schedule status
```

前台运行可使用 `loom watch`；删除后台服务使用 `loom schedule uninstall`。默认每 300 秒扫描一次，仅归档当前工作区及其子目录的会话。记录保存在 `~/.loom/records/<项目名>-<工作区哈希>/`，同一会话更新同一份脱敏 Markdown，未变化的会话自动跳过。原始会话仍留在本地，不上传服务器。

源码安装、自定义会话路径、Windows 调度方式和配置说明见 [CLI 文档](packages/cli/README.md)。CLI 包已接入 CI/Release 打包；npm 公共仓库发布后也可通过 `npm install -g loom-cli` 安装。

### 插件安装

通过 DSH 插件管理器为 `web` profile 添加：

```sh
dsh plugin --profile web add -w dsh-loom
```

安装后请重启 Harness。

### Web 管理界面

```sh
cd apps/web
pnpm dev
```

浏览器打开 `http://localhost:5173` 即可浏览项目记忆库、查看团队正在进行的活动并检索过往技术决策。

## 端到端加密

Loom 复用了 [ds-harness-remote](https://github.com/liguobao/ds-harness-remote) 相同的端到端加密协议套件：

- **套件**：`Noise_IK_25519_ChaChaPoly_SHA256`
- **身份**：每台设备本地生成的静态 X25519 公私钥对
- **握手**：发起方（观察者）已知主机静态公钥发起加密握手，主机派生临时密钥协商加密通信密钥
- **传输**：双向独立的大端序单调递增计数器 Nonce，防重放攻击

详细协议格式、密钥生命周期与安全边界说明参见[端到端加密文档](docs/end-to-end-encryption.md)。

## 仓库边界

本代码仓库包含全部开源客户端生态与协议：
- `packages/protocol`：共享核心模型、Zod 校验 schema 与 WebSocket 协议。
- `packages/crypto`：Noise IK 加解密协议实现与密钥管理工具。
- `packages/db`：SQLite 建表管理、数据操作与 FTS5 全文索引构建器。
- `packages/distill`：对话蒸馏、Git 变更提取与本地密钥脱敏引擎。
- `packages/cli`（`loom-cli`）：可独立安装的 TypeScript CLI、huihua 会话收集和后台定时归档。
- `packages/client`（`dsh-loom`）：DeepSeek Harness 本地插件与交互客户端 SDK。
- `apps/web`：React 19 Web 前端管理看板。

**Loom Server 属于闭源独立项目**，由单独仓库维护。开源客户端统一依照标准化的[协议与 API 交互规范文档](docs/protocol.md)与后端服务进行互操作对接。

## 安全与隐私

- 会话传输全链路端到端加密，中继服务端无法获取会话明文或私钥。
- 敏感信息在离开开发者本地机器前执行本地脱敏。
- 观察者无法直接调用终端、注入指令或代为批准敏感工具操作。
- SQLite 索引损坏或丢失不影响磁盘上的 Markdown 正文，且可由文件重新扫描生成索引。

## 详细文档

- [产品规范与原则](docs/product.md)
- [系统架构与三平面模型](docs/architecture.md)
- [端到端加密规范](docs/end-to-end-encryption.md)
- [存储格式规范](docs/storage-format.md)
- [协议与 API 交互规范](docs/protocol.md)

## Star 趋势

<a href="https://www.star-history.com/?repos=liguobao%2Floom&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liguobao/loom&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liguobao/loom&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liguobao/loom&type=date&legend=top-left" />
 </picture>
</a>

## 项目地位与商标

本项目为独立的开源社区项目，面向 DeepSeek Harness 生态设计。
DeepSeek 及相关商标属于其各自持有者。

## 许可证

[MIT](LICENSE)
