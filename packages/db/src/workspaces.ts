import type Database from 'better-sqlite3'
import { ulid } from 'ulid'
import type { Workspace, WorkspaceMember } from '@loom/protocol'

interface WorkspaceRow {
  id: string
  organization_id: string
  slug: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

interface WorkspaceMemberRow {
  workspace_id: string
  user_id: string
  role: string
  joined_at: string
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToMember(row: WorkspaceMemberRow): WorkspaceMember {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role as WorkspaceMember['role'],
    joinedAt: row.joined_at,
  }
}

/**
 * 创建工作空间，同时将创建者设为 owner
 */
export function createWorkspace(
  db: Database.Database,
  params: { organizationId: string; slug: string; name: string; description?: string; creatorId: string },
): Workspace {
  const now = new Date().toISOString()
  const id = ulid()

  const insertWs = db.prepare(
    `INSERT INTO workspaces (id, organization_id, slug, name, description, created_at, updated_at)
     VALUES (@id, @organizationId, @slug, @name, @description, @now, @now)`,
  )
  const insertMember = db.prepare(
    `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at)
     VALUES (@workspaceId, @userId, 'owner', @now)`,
  )

  const run = db.transaction(() => {
    insertWs.run({
      id,
      organizationId: params.organizationId,
      slug: params.slug,
      name: params.name,
      description: params.description ?? null,
      now,
    })
    insertMember.run({ workspaceId: id, userId: params.creatorId, now })
  })
  run()

  return rowToWorkspace({
    id,
    organization_id: params.organizationId,
    slug: params.slug,
    name: params.name,
    description: params.description ?? null,
    created_at: now,
    updated_at: now,
  })
}

/**
 * 按 ID 查询工作空间
 */
export function getWorkspaceById(db: Database.Database, id: string): Workspace | undefined {
  const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined
  return row ? rowToWorkspace(row) : undefined
}

/**
 * 列出组织下所有工作空间
 */
export function listWorkspaces(db: Database.Database, organizationId: string): Workspace[] {
  const rows = db
    .prepare('SELECT * FROM workspaces WHERE organization_id = ? ORDER BY created_at ASC')
    .all(organizationId) as WorkspaceRow[]
  return rows.map(rowToWorkspace)
}

/**
 * 添加工作空间成员
 */
export function addWorkspaceMember(
  db: Database.Database,
  params: { workspaceId: string; userId: string; role: WorkspaceMember['role'] },
): WorkspaceMember {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role, joined_at)
     VALUES (@workspaceId, @userId, @role, @now)`,
  ).run({ workspaceId: params.workspaceId, userId: params.userId, role: params.role, now })

  return { workspaceId: params.workspaceId, userId: params.userId, role: params.role, joinedAt: now }
}

/**
 * 查询工作空间单个成员关系
 */
export function getWorkspaceMember(
  db: Database.Database,
  workspaceId: string,
  userId: string,
): WorkspaceMember | undefined {
  const row = db
    .prepare('SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(workspaceId, userId) as WorkspaceMemberRow | undefined
  return row ? rowToMember(row) : undefined
}
