# Loom 协议与 API 交互规范（Loom Protocol & API Specification）

状态：Draft v0.2  
日期：2026-10-01  
协议版本：`1`  
适用范围：Loom DSH 插件（`dsh-loom`）、Web 前端与 Loom Server 之间的线协议规范（Server 闭源实现遵循此规范）。

---

## 0. 规范地位与仓库边界

本文是 Loom 插件（`dsh-loom`）、Web 界面（`@loom/web`）以及闭源 Loom Server 之间唯一的网络通信与数据交互协议契约。

- **开源仓库职责**：
  - `packages/protocol`：所有共享 TypeScript 类型定义、Zod 请求/响应校验 Schema、WebSocket 消息结构；
  - `packages/crypto`：端到端加密握手（Noise IK）、密钥派生与 Transport 加解密；
  - `packages/distill`：对话蒸馏、Git 上下文捕获与敏感信息脱敏；
  - `packages/client`（`dsh-loom`）：DeepSeek Harness 本地插件与交互客户端 SDK；
  - `apps/web`：React 19 Web 前端应用。
- **闭源 Server 职责**：
  - 用户鉴权、团队成员与权限管理、机器与 Host 实例注册、在线状态广播、不透明 E2EE 密文中继路由、Markdown 文件存储与 SQLite FTS5 全文索引维护。

---

## 1. 术语与基本概念

- **Host（主机实例）**：本地运行 DeepSeek Harness 并持有开发工程的机器。拥有对实时观察的最终否决权。
- **Observer（观察者）**：希望实时查看 Host 工作的团队成员。权限级别为严格只读。
- **Server（服务端）**：负责身份鉴权、拓扑管理、不透明密文中继及 Markdown 归档持久化的集中式协调节点。
- **Control Channel（控制信道）**：基于 WebSocket 的明文 JSON 消息信道，用于认证、心跳、在线状态和中继信令。
- **Secure Channel（安全信道）**：基于 Noise IK 的端到端加密管道，流转会话流明文，服务端无法解密。
- **Work Record（工程记录）**：工作结束提炼出的 Markdown 资产，以 `.md` 格式持久化存储于服务端磁盘。

---

## 2. 协议分层模型

```text
┌────────────────────────────────────────────────────────┐
│             HTTPS REST API (/api)                      │
│   账号认证 / 组织拓扑 / 机器管理 / 归档上传 / 全文检索   │
├────────────────────────────────────────────────────────┤
│           WSS Control Channel (/ws)                    │
│   认证握手 / Presence 广播 / Active Work 状态 / 信令路由  │
├────────────────────────────────────────────────────────┤
│       End-to-End Secure Channel (Noise IK)             │
│   Host 与 Observer 之间的只读 Conversation 加密流      │
└────────────────────────────────────────────────────────┘
```

---

## 3. 通用格式与约定

1. **协议版本标识**：
   WebSocket 连接后首包及必要请求中可携带 `"v": 1`。
2. **字符集与格式**：所有请求/响应均使用 UTF-8 编码的 JSON 格式。
3. **时间规范**：时间戳字段均使用 **ISO 8601** 字符串格式（UTC 时间，如 `2026-10-01T08:30:00.000Z`）。
4. **认证方式**：HTTP 请求头中携带 `Authorization: Bearer <session-token>`。
5. **错误响应规范**：
   HTTP 状态码非 2xx 时，统一返回如下结构：
   ```json
   {
     "error": "FORBIDDEN",
     "message": "You are not a member of this project"
   }
   ```

---

## 4. REST API 契约

### 4.1 认证与用户（Auth & Users）

#### 注册账号
- **POST** `/api/auth/register`
- 请求体：
  ```json
  {
    "username": "guobao",
    "displayName": "Guobao Li",
    "email": "guobao@example.com",
    "password": "SecurePassword123"
  }
  ```
- 响应 `201 Created`：
  ```json
  {
    "token": "32-byte-hex-session-token",
    "user": {
      "id": "01KABC123USER",
      "username": "guobao",
      "displayName": "Guobao Li",
      "email": "guobao@example.com"
    }
  }
  ```

#### 登录账号
- **POST** `/api/auth/login`
- 请求体：`{ "username": "guobao", "password": "SecurePassword123" }`
- 响应 `200 OK`：格式同注册响应。

#### 获取当前登录信息
- **GET** `/api/auth/me`
- 响应 `200 OK`：`User` 对象。

---

### 4.2 组织与工作区（Organizations & Workspaces）

#### 获取所属组织列表
- **GET** `/api/organizations`
- 响应 `200 OK`：`Organization[]`

#### 创建组织
- **POST** `/api/organizations`
- 请求体：`{ "slug": "engineering", "name": "研发工程部" }`
- 响应 `201 Created`：`Organization`

#### 工作区 CRUD
- **GET** `/api/organizations/:orgId/workspaces` → 返回工作区列表 `Workspace[]`
- **POST** `/api/organizations/:orgId/workspaces`
  - 请求体：`{ "slug": "dev", "name": "核心研发", "description": "日常开发工作区" }`
  - 响应 `201 Created`：`Workspace`

---

### 4.3 项目管理（Projects）

#### 获取工作区内项目列表
- **GET** `/api/workspaces/:workspaceId/projects` → `Project[]`

#### 创建项目
- **POST** `/api/workspaces/:workspaceId/projects`
  - 请求体：`{ "slug": "loom", "name": "Loom for DeepSeek Harness" }`
  - 响应 `201 Created`：`Project`

#### 获取项目详情与仓库
- **GET** `/api/projects/:projectId`
  - 响应 `200 OK`：`Project & { repositories: ProjectRepository[] }`

#### 关联代码仓库
- **POST** `/api/projects/:projectId/repositories`
  - 请求体：`{ "repoUrl": "liguobao/loom" }`
  - 响应 `201 Created`：`ProjectRepository`

#### 获取项目正在进行的活动（Active Work）
- **GET** `/api/projects/:projectId/active-work`
  - 响应 `200 OK`：`ActiveWork[]`

#### 分页获取项目工程记录索引
- **GET** `/api/projects/:projectId/records?limit=20&offset=0`
  - 响应 `200 OK`：`RecordIndex[]`

---

### 4.4 机器与主机实例（Machines & Host Instances）

#### 注册物理/逻辑开发机
- **POST** `/api/machines`
- 请求体：
  ```json
  {
    "organizationId": "01KABC_ORG",
    "name": "Guobao MacBook Pro",
    "platform": "darwin"
  }
  ```
- 响应 `201 Created`：`Machine`

#### 注册本地 Host 实例
- **POST** `/api/machines/:machineId/hosts`
- 请求体：
  ```json
  {
    "name": "DSH Main Instance",
    "harnessVersion": "0.1.7-rc.1",
    "pluginVersion": "0.1.0",
    "capabilities": ["observe", "presence"],
    "publicKey": "base64url-x25519-public-key"
  }
  ```
- 响应 `201 Created`：`HostInstance`

---

### 4.5 归档与检索（Archive & Search）

#### 上传提炼后的工程记录（Markdown）
- **POST** `/api/records`
- 请求体：
  ```json
  {
    "projectId": "01KABC_PROJECT",
    "organizationId": "01KABC_ORG",
    "workspaceId": "01KABC_WS",
    "title": "增加团队成员实时查看本地 DSH Agent 的能力",
    "repository": "liguobao/loom",
    "branch": "feat/live-view",
    "baseCommit": "abc1234",
    "finalCommit": "def5678",
    "tags": ["remote", "websocket"],
    "changedAreas": ["packages/remote/observer.ts", "apps/web/live-view.tsx"],
    "sourceConversationCount": 2,
    "markdownContent": "---\nid: 01KABC123\n...\n---\n\n# 增加团队成员实时查看能力\n..."
  }
  ```
- 响应 `201 Created`：`RecordIndex` 对象（服务端完成磁盘写入并更新 FTS5 索引）。

#### 获取工程记录完整内容
- **GET** `/api/records/:recordId`
- 响应 `200 OK`：
  ```json
  {
    "meta": { "id": "01KABC123", "title": "...", ... },
    "content": "完整包含 Front Matter 的 Markdown 文本"
  }
  ```

#### 全文检索项目记忆（FTS5）
- **GET** `/api/search?q=<query>&projectId=<optional>`
- 响应 `200 OK`：`RecordIndex[]`（按相关度分数降序排列）。

---

## 5. WebSocket 控制信道交互规范（`/ws`）

信道建立于 `ws(s)://<host>/ws`。所有消息均为 JSON 对象，包含 `type` 和 `payload`。

### 5.1 连接与身份鉴权
客户端建立连接后，必须在 **10 秒内**完成身份认证，否则服务端关闭连接：

```text
Client                                             Server
  │                                                  │
  │────── {"type": "auth", "payload": {token}} ────►│
  │                                                  │
  │◄───── {"type": "auth_ok", "payload": {userId}} ──│
```

- **`auth` 消息体**：
  ```json
  {
    "type": "auth",
    "payload": {
      "token": "session-token-string",
      "hostInstanceId": "可选-如果作为Host发起"
    }
  }
  ```
- **鉴权失败响应**：
  ```json
  { "type": "auth_error", "payload": { "message": "Invalid token" } }
  ```
  随后服务端以关闭码 `4001 Unauthorized` 关闭连接。

---

### 5.2 状态广播与订阅（Presence）

#### 1. Host 上报自身状态
Host 状态变动时通过 WebSocket 广播：
```json
{
  "type": "presence_update",
  "payload": {
    "hostInstanceId": "01KABC_HOST",
    "status": "online",
    "activeWorkId": "01KABC_WORK",
    "projectId": "01KABC_PROJECT",
    "title": "重构 WebSocket 鉴权与心跳逻辑",
    "observePermission": "observe"
  }
}
```

#### 2. 客户端订阅项目或工作区在线列表
```json
{
  "type": "presence_subscribe",
  "payload": {
    "workspaceId": "01KABC_WS",
    "projectId": "01KABC_PROJECT"
  }
}
```
服务端随后向该客户端推送当前在线列表（`presence_list`）。

---

### 5.3 实时观察信令与端到端加密数据流（Observe & E2EE Relay）

实时查看遵循三层鉴权与端到端密文穿透模型：

```text
Observer (Client)                Loom Server                    Host (DSH)
  │                                  │                               │
  │─── {"type":"observe_request"} ──►│                               │
  │    (targetHostId)                │─── 校验 ACL 权限，转发 ──────►│
  │                                  │                               │
  │                                  │                               │◄── 本地策略确认
  │                                  │◄── {"type":"observe_accept"} ─│
  │◄── 转发 accept ──────────────────│    (to: observerClientId)     │
  │                                  │                               │
  │═══════════════════ Noise IK Handshake (E2EE) ════════════════════│
  │                                                                  │
  │                                  │◄── {"type":"observe_stream"} ─│
  │◄── 透传加密数据块 ───────────────│    (encryptedChunk, nonce)    │
  │    (本地解密渲染只读流)            │    [服务端不读取、无法解密]   │
```

#### 1. 观察请求（`observe_request`）
Observer 发起观察意图：
```json
{
  "type": "observe_request",
  "payload": {
    "targetHostId": "01KABC_HOST"
  }
}
```

#### 2. 主机接受/拒绝响应
Host 本地策略裁定并通知服务端路由回 Observer：
```json
{
  "type": "observe_accept",
  "payload": { "to": "observer_client_id" }
}
```
或：
```json
{
  "type": "observe_deny",
  "payload": { "to": "observer_client_id", "reason": "Host owner declined" }
}
```

#### 3. 密文流透传（`observe_stream`）
握手成功后，Host 将本地 Conversation 增量流以 Noise IK 密钥加密，封装为传输帧通过服务端路由：
```json
{
  "type": "observe_stream",
  "payload": {
    "hostInstanceId": "01KABC_HOST",
    "encryptedChunk": "base64url-chacha20-poly1305-ciphertext",
    "nonce": "base64url-12byte-nonce"
  }
}
```
- **服务端行为**：纯透明中继转发，禁止也不可能尝试解密；
- **安全不变量**：重放 Nonce 或错误 Nonce 将被 Observer 客户端直接丢弃。

---

### 5.4 系统心跳与异常处理

- **心跳机制**：客户端可定期发送 `{"type": "ping"}`，服务端响应 `{"type": "pong"}`。
- **错误事件**：
  ```json
  {
    "type": "error",
    "payload": {
      "code": "TARGET_HOST_OFFLINE",
      "message": "The requested host is no longer connected"
    }
  }
  ```
