<p align="center">
  <img src="docs/logo.svg" alt="Loom — Keep the work, not the chat." width="600">
</p>

<p align="center">
  <a href="README.md">English</a>
  &nbsp;·&nbsp;
  <strong>中文</strong>
  &nbsp;·&nbsp;
  <a href="packages/cli/README.md">CLI 使用指南</a>
  &nbsp;·&nbsp;
  <a href="packages/client/README.md">DSH 插件</a>
</p>

## Keep the work, not the chat.

**Loom 把本地 Coding Agent 会话整理成可阅读、可回溯的 Markdown 项目记忆。**

用 Coding Agent 写代码时，需求、用户纠正、排查过程和技术决策往往散落在很长的对话里。Loom 收集属于同一个项目的本地会话，提炼其中有价值的工程上下文，保存在项目旁边，方便以后回答：**做了什么、为什么这样做、哪些结果已经验证、还有什么没解决。**

**主要使用方式是独立 CLI**：通过 [Huihua](https://github.com/wibus-wee/huihua) 收集 Codex、Claude、Cursor、DeepSeek Harness 等 Coding Agent 的本地会话，再调用你配置好的本机 Codex 或 DSH Agent 生成总结。**使用 CLI 不需要安装 DSH，不需要 DSH 插件，也不依赖 Loom Server。**

**DSH 插件只是可选接入方式之一**，适合在 DeepSeek Harness 内集成归档能力。Loom 不是“一个 DSH 插件”，也不要求所有开发流程都经过 DSH。

Loom 不是新 IDE、Agent 编排平台，也不是原始聊天记录同步工具。你可以继续使用现有编辑器、Agent、模型和 Git 工作流。

## Loom 能做什么

- **按工作区收集**：识别当前项目及其子目录的本地会话，不把无关项目的对话混入归档。
- **保留工程上下文**：总结需求、用户纠正、关键交互、问题定位、技术决策、被否决的方案、结果与待办。
- **结合执行证据**：纳入相关工具结果、报错和测试证据，区分用户要求、Agent 声称完成与实际验证的结果。macOS 下即使终端 `PATH` 没有 `codex`，也会自动探测 ChatGPT.app 内置的 Codex。
- **增量更新**：同一会话更新同一份 Markdown；未变化的会话跳过总结调用。总结失败时保留已有记录，后续可重试。
- **手动或自动归档**：支持单次执行、前台持续扫描，以及 macOS/Linux 的工作区级后台服务。
- **直接阅读和浏览**：可以直接打开 Markdown，也可以通过 CLI 自带的本地只读 Web 服务浏览。
- **保持本地控制**：原始对话留在各 Agent 的本地存储中；总结输入和写入的记录都会经过敏感信息脱敏。

## 快速开始：独立 CLI

需要 **Node.js 22.18+**，以及已安装、配置好的本机总结 Agent：**Codex 或 DSH**。生成总结的 Agent 不必与原始会话使用的 Agent 相同。

```sh
npm install -g @liguobao/loom-cli
cd /path/to/project

# 收集支持的本地会话，默认使用 Codex 生成总结。
loom init

# 单次生成或更新 Markdown 工作记录。
loom archive

# 打开 http://127.0.0.1:8787 浏览记录。
loom server
```

`loom init` 默认启用 Huihua 支持的全部会话来源。运行 `loom providers` 可查看来源 ID，也可以用 `--providers codex,claude,deepseek` 限定收集范围。

默认配置和记录保存在工作区的 `.loom` 目录中。在 Git 仓库内运行时，Loom 会将工作区定位到 Git 根目录：

```text
your-project/
├── .git/
├── .loom/
│   ├── config.json
│   └── records/
│       └── <session-source-hash>.md
└── ...
```

使用 `loom init --output /path/to/archives` 可以把记录放到其他目录。自定义输出目录下按 `<项目名>-<工作区哈希>/` 分组。已有的 `~/.loom/workspaces/` 旧版配置仍可继续使用。

**默认把 `.loom` 当作私有目录。** 建议在项目的 `.gitignore` 中加入 `.loom/`；需要分享时，再审阅并挑选记录。自动脱敏不能保证移除所有密钥或敏感内容。

源码与 tarball 安装、自定义会话路径、配置和各平台说明见 [CLI 使用指南](packages/cli/README.md)。

### 自动归档

```sh
# 前台运行：立即扫描，此后按配置间隔重复执行。
loom watch

# 后台服务：macOS LaunchAgent 或 Linux systemd 用户服务。
loom schedule install
loom schedule status
loom schedule uninstall
```

默认在每次扫描完成后等待 300 秒再执行下一次。持续扫描和后台归档处理的是当前会话快照，不会自动把进行中的任务标记为已完成。本地浏览服务本身不收集会话、不调用总结模型；自动归档需要另行运行 `loom watch` 或后台服务，刷新页面即可查看新记录。

### 选择总结 Agent

```sh
loom archive                         # 默认：codex-server
loom archive --summarizer dsh
```

- `codex-server`：调用本机 `codex app-server --stdio`，复用你的 Codex 配置和认证。
- `dsh`：调用本机 DSH 无头 CLI，使用你的 DSH 模型配置。**这不需要安装 Loom 的 DSH 插件。**

Loom 不另外配置托管模型 API。本机 Agent 仍可能按其配置调用远程模型服务，总结输入的数据处理边界取决于所选服务商。可执行文件路径、profile 等设置见[总结后端说明](packages/cli/README.md#local-summarization-backend)。

## 工作原理

```text
本地 Coding Agent 会话存储
  Codex / Claude / Cursor / DeepSeek Harness / ...
                       │
              Huihua 收集会话
              + 工作区匹配
                       │
              本地敏感信息脱敏
                       │
              已配置的本机总结 Agent
              （Codex 或 DSH）
                       │
              结构化总结 + 再次脱敏
                       │
              项目 Markdown 工作记录
                       │
              直接阅读文件 / loom server
```

收集、归档和浏览都在你的机器上运行。独立 CLI 工作流不会向 Loom Server 上传记录，也不要求部署团队协作组件。

## 工作记录保留什么

记录是带有 YAML Front Matter 的 Markdown 文档，元数据用于标识来源与工作区，正文保留有价值的工程上下文：

| 章节 | 内容 |
|---|---|
| Goal | 要解决的问题 |
| Requirements | 初始需求、后续新增要求、约束与纠正 |
| Interaction Summary | 按来源顺序梳理关键尝试、反馈、失败、修复与最终状态 |
| Outcome | 工作结果与验证情况 |
| Investigation | 问题定位过程 |
| Key Decisions | 技术选择及其原因 |
| Rejected Approaches | 尝试过或被排除的方案 |
| Follow-ups | 未解决的问题与下一步 |

它是语义总结，不是复制聊天记录，也不是按固定字数截取原文。长会话会分段总结再合并；只有工具调用不代表执行成功，已经缺失或被压缩掉的源历史也无法凭空还原。

## 可选接入：DSH 插件

如果你已经使用 DeepSeek Harness，希望在其运行时内集成归档，可以安装插件：

```sh
dsh plugin --profile web add -w @liguobao/dsh-loom@0.1.0
```

安装后重启 Harness。插件在本地归档，与 CLI 共用总结引擎。其配置和存储方式见 [DSH 插件文档](packages/client/README.md)。

**三个选择互相独立**：会话来源决定“收集谁的记录”，总结后端决定“用谁生成总结”，DSH 插件决定“如何接入 DSH 运行时”。把 DSH 选作会话来源或总结后端，并不意味着必须安装插件。

## 团队协作与架构

Loom 仓库也包含协议、加密、索引和 Web 界面组件，用于更完整的团队项目记忆与只读观察设计。**这部分与上面的独立本地归档路径分开。** 安装 CLI 或插件本身，不会自动开启团队实时观察或服务端检索。

团队设计涉及经所有者授权的观察、本地主机最终否决权、服务端 ACL，以及使用 `Noise_IK_25519_ChaChaPoly_SHA256` 的实时流端到端加密。这些属于协作链路的安全边界，不意味着本地 Markdown 归档已加密。Loom Server 在独立闭源仓库维护，本地归档不需要它。`apps/web` 的 React 团队看板也不同于 CLI 自带的本地浏览页面。

以下文档描述的是面向 DSH 的团队协作设计，不是使用 CLI 的前置条件：

- [产品规范与原则](docs/product.md)
- [系统架构与三平面模型](docs/architecture.md)
- [端到端加密规范](docs/end-to-end-encryption.md)
- [团队存储格式](docs/storage-format.md)
- [协议与 API 交互规范](docs/protocol.md)

## 仓库结构

| 路径 | 职责 |
|---|---|
| `packages/cli` | 独立 CLI：会话收集、定时归档与本地浏览 |
| `packages/distill` | 共用语义总结、Git 上下文与敏感信息脱敏 |
| `packages/client` | 可选 DSH 插件与客户端集成 |
| `packages/protocol` | 共享类型、校验 schema 与 WebSocket 协议 |
| `packages/crypto` | Noise IK 加密、设备密钥与 token 工具 |
| `packages/db` | 团队协作组件使用的 SQLite 数据访问与 FTS5 索引 |
| `apps/web` | React 团队看板 |

## 安全与隐私

- 本地记录是可读 Markdown，不是加密归档。请保护存储目录，分享或提交前审阅内容。
- 正则脱敏无法识别所有敏感信息；总结输入实际在哪里处理，取决于所选 Agent 和模型服务商。
- 总结失败或输出无效时保留已有记录，不用原始对话截取片段替代总结。
- 本地浏览服务只监听 `127.0.0.1`，且为只读；它不是公开分享服务。

## Star 趋势

<a href="https://www.star-history.com/?repos=liguobao%2Floom&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liguobao/loom&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liguobao/loom&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liguobao/loom&type=date&legend=top-left" />
 </picture>
</a>

## 项目与商标

Loom 是面向本地 Coding Agent 工作流的独立开源项目，不是任何所支持 Agent 或模型服务商的官方产品。相关产品名称与商标属于各自持有者。

## 许可证

MIT
