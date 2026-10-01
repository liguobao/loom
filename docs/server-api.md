# Loom Server API Contract

Status: Draft v0.1
Date: 2026-10-01
Scope: Client-Server Interoperability Specification (Server implementation is closed-source)

## 1. Overview

This document specifies the REST HTTP endpoints and WebSocket signaling protocol expected by the `@loom/client` SDK, CLI, and Web frontend. Loom Server is closed-source, but conforms to this specification.

Base URL: `http(s)://<host>[:<port>]`
API Prefix: `/api`
WebSocket Endpoint: `/ws`

All request and response bodies use UTF-8 JSON unless specified otherwise. Timestamps are ISO 8601 strings.

---

## 2. Authentication

Authentication uses Bearer token in the `Authorization` header:

```http
Authorization: Bearer <session-token>
```

### 2.1 Register
- **POST** `/api/auth/register`
- Request:
  ```json
  {
    "username": "string",
    "displayName": "string",
    "email": "string",
    "password": "string"
  }
  ```
- Response `201`:
  ```json
  {
    "token": "string",
    "user": {
      "id": "string",
      "username": "string",
      "displayName": "string",
      "email": "string"
    }
  }
  ```

### 2.2 Login
- **POST** `/api/auth/login`
- Request:
  ```json
  {
    "username": "string",
    "password": "string"
  }
  ```
- Response `200`: (same format as register)

### 2.3 Current User Info
- **GET** `/api/auth/me`
- Response `200`: `User` object.

---

## 3. Organizations & Workspaces

### 3.1 List Organizations
- **GET** `/api/organizations`
- Response `200`: `Organization[]`

### 3.2 Create Organization
- **POST** `/api/organizations`
- Request: `{ "slug": "string", "name": "string" }`
- Response `201`: `Organization`

### 3.3 List Workspaces in Org
- **GET** `/api/organizations/:orgId/workspaces`
- Response `200`: `Workspace[]`

### 3.4 Create Workspace
- **POST** `/api/organizations/:orgId/workspaces`
- Request: `{ "slug": "string", "name": "string", "description"?: "string" }`
- Response `201`: `Workspace`

---

## 4. Projects

### 4.1 List Projects in Workspace
- **GET** `/api/workspaces/:workspaceId/projects`
- Response `200`: `Project[]`

### 4.2 Create Project
- **POST** `/api/workspaces/:workspaceId/projects`
- Request: `{ "slug": "string", "name": "string", "description"?: "string" }`
- Response `201`: `Project`

### 4.3 Get Project by ID
- **GET** `/api/projects/:projectId`
- Response `200`: `Project & { repositories: ProjectRepository[] }`

### 4.4 List Project Active Work
- **GET** `/api/projects/:projectId/active-work`
- Response `200`: `ActiveWork[]`

### 4.5 List Project Records
- **GET** `/api/projects/:projectId/records?limit=20&offset=0`
- Response `200`: `RecordIndex[]`

---

## 5. Work Records (Archive Plane)

### 5.1 Upload Work Record
- **POST** `/api/records`
- Request:
  ```json
  {
    "projectId": "string",
    "organizationId"?: "string",
    "workspaceId"?: "string",
    "title": "string",
    "repository"?: "string",
    "branch"?: "string",
    "baseCommit"?: "string",
    "finalCommit"?: "string",
    "tags"?: string[],
    "changedAreas"?: string[],
    "sourceConversationCount"?: number,
    "markdownContent": "string"
  }
  ```
- Response `201`: `RecordIndex`

### 5.2 Get Work Record
- **GET** `/api/records/:recordId`
- Response `200`:
  ```json
  {
    "meta": "RecordIndex",
    "content": "string (full Markdown with Front Matter)"
  }
  ```

---

## 6. Full-Text Search

- **GET** `/api/search?q=<query>&projectId=<optional>`
- Response `200`: `RecordIndex[]` (ordered by FTS5 rank)

---

## 7. Machines & Host Instances

### 7.1 Register Machine
- **POST** `/api/machines`
- Request: `{ "organizationId": "string", "name": "string", "platform"?: "string" }`
- Response `201`: `Machine`

### 7.2 Register Host Instance
- **POST** `/api/machines/:machineId/hosts`
- Request:
  ```json
  {
    "name": "string",
    "harnessVersion"?: "string",
    "pluginVersion"?: "string",
    "capabilities"?: string[],
    "publicKey"?: "string (X25519 public key base64)"
  }
  ```
- Response `201`: `HostInstance`

---

## 8. WebSocket Protocol (`/ws`)

### 8.1 Authentication & Hello
Client connects to `/ws` and must send `auth` within 10 seconds:
```json
{
  "type": "auth",
  "payload": {
    "token": "session-token",
    "hostInstanceId": "optional-host-id"
  }
}
```
Server responds with `auth_ok` or closes connection with 4001:
```json
{ "type": "auth_ok", "payload": { "userId": "..." } }
```

### 8.2 Presence
- Host updates status:
  ```json
  {
    "type": "presence_update",
    "payload": {
      "hostInstanceId": "...",
      "status": "online",
      "projectId": "...",
      "title": "...",
      "observePermission": "presence"
    }
  }
  ```
- Client subscribes to project/workspace:
  ```json
  {
    "type": "presence_subscribe",
    "payload": { "workspaceId": "...", "projectId": "..." }
  }
  ```

### 8.3 E2EE Observer Relay (Ciphertext Passthrough)
- Observer requests session observe:
  ```json
  {
    "type": "observe_request",
    "payload": { "targetHostId": "..." }
  }
  ```
- Host accepts/denies:
  ```json
  {
    "type": "observe_accept",
    "payload": { "to": "observerClientId" }
  }
  ```
- Encrypted stream transmission (Server routes payload without decryption):
  ```json
  {
    "type": "observe_stream",
    "payload": {
      "hostInstanceId": "...",
      "encryptedChunk": "base64",
      "nonce": "base64"
    }
  }
  ```
