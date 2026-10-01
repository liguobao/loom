// Loom 核心实体类型定义

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer'

export type ObservePermission = 'hidden' | 'presence' | 'observe'

export type HostStatus = 'online' | 'offline'

export interface User {
  id: string // ulid
  username: string
  displayName: string
  email: string
  avatarUrl?: string
  createdAt: string // ISO 8601
  updatedAt: string
}

export interface Organization {
  id: string
  slug: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface OrganizationMember {
  organizationId: string
  userId: string
  role: MemberRole
  joinedAt: string
}

export interface Workspace {
  id: string
  organizationId: string
  slug: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceMember {
  workspaceId: string
  userId: string
  role: MemberRole
  joinedAt: string
}

export interface Project {
  id: string
  workspaceId: string
  organizationId: string
  slug: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectMember {
  projectId: string
  userId: string
  role: MemberRole
  joinedAt: string
}

export interface ProjectRepository {
  id: string
  projectId: string
  repoUrl: string // e.g. github.com/org/repo
  createdAt: string
}

export interface Machine {
  id: string
  ownerId: string
  organizationId: string
  name: string
  platform: string // 'darwin' | 'linux' | 'win32'
  createdAt: string
  lastSeenAt: string
}

export interface HostInstance {
  id: string
  machineId: string
  ownerId: string
  organizationId: string
  name: string
  harnessVersion?: string
  pluginVersion?: string
  status: HostStatus
  capabilities: string[] // e.g. ['observe', 'presence']
  observePermission: ObservePermission
  createdAt: string
  lastSeenAt: string
}

export interface ActiveWork {
  id: string
  hostInstanceId: string
  ownerId: string
  projectId: string
  title: string
  repository?: string
  branch?: string
  startedAt: string
  lastActiveAt: string
  visibility: ObservePermission
  // 不包含任何 Conversation 内容
}

export interface WorkRecord {
  id: string // ulid
  organizationId: string
  workspaceId: string
  projectId: string
  ownerId: string
  title: string
  repository?: string
  branch?: string
  baseCommit?: string
  finalCommit?: string
  tags: string[]
  changedAreas: string[]
  relativePath: string // 相对于 data/ 的路径
  createdAt: string
  completedAt?: string
  sourceConversationCount: number
}

export interface RecordIndex {
  id: string
  organizationId: string
  workspaceId: string
  projectId: string
  ownerId: string
  relativePath: string
  title: string
  repository?: string
  branch?: string
  finalCommit?: string
  tags: string // JSON 序列化后的字符串
  changedAreas: string // JSON 序列化后的字符串
  createdAt: string
  updatedAt: string
}

export interface Session {
  id: string
  userId: string
  token: string
  expiresAt: string
  createdAt: string
}

export interface Presence {
  userId: string
  hostInstanceId: string
  activeWorkId?: string
  projectId?: string
  status: HostStatus
  lastSeenAt: string
}
