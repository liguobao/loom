import type Database from 'better-sqlite3'
import type { Presence } from '@loom/protocol'

interface PresenceRow {
  user_id: string
  host_instance_id: string
  active_work_id: string | null
  project_id: string | null
  status: string
  last_seen_at: string
}

function rowToPresence(row: PresenceRow): Presence {
  return {
    userId: row.user_id,
    hostInstanceId: row.host_instance_id,
    activeWorkId: row.active_work_id ?? undefined,
    projectId: row.project_id ?? undefined,
    status: row.status as Presence['status'],
    lastSeenAt: row.last_seen_at,
  }
}

/**
 * 插入或更新 Presence（UPSERT）
 */
export function upsertPresence(
  db: Database.Database,
  data: Omit<Presence, 'lastSeenAt'>,
): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO presence (user_id, host_instance_id, active_work_id, project_id, status, last_seen_at)
     VALUES (@userId, @hostInstanceId, @activeWorkId, @projectId, @status, @now)
     ON CONFLICT (user_id, host_instance_id) DO UPDATE SET
       active_work_id = excluded.active_work_id,
       project_id = excluded.project_id,
       status = excluded.status,
       last_seen_at = excluded.last_seen_at`,
  ).run({
    userId: data.userId,
    hostInstanceId: data.hostInstanceId,
    activeWorkId: data.activeWorkId ?? null,
    projectId: data.projectId ?? null,
    status: data.status,
    now,
  })
}

/**
 * 查询单个用户+实例的 Presence
 */
export function getPresence(
  db: Database.Database,
  userId: string,
  hostInstanceId: string,
): Presence | undefined {
  const row = db
    .prepare('SELECT * FROM presence WHERE user_id = ? AND host_instance_id = ?')
    .get(userId, hostInstanceId) as PresenceRow | undefined
  return row ? rowToPresence(row) : undefined
}

/**
 * 列出项目下所有在线 Presence（包含 offline 的也查出来，让客户端决定）
 */
export function listProjectPresence(db: Database.Database, projectId: string): Presence[] {
  const rows = db
    .prepare('SELECT * FROM presence WHERE project_id = ? ORDER BY last_seen_at DESC')
    .all(projectId) as PresenceRow[]
  return rows.map(rowToPresence)
}

/**
 * 列出工作空间下所有 Presence（通过关联 projects 表）
 */
export function listWorkspacePresence(db: Database.Database, workspaceId: string): Presence[] {
  const rows = db
    .prepare(
      `SELECT p.* FROM presence p
       JOIN projects pr ON pr.id = p.project_id
       WHERE pr.workspace_id = ?
       ORDER BY p.last_seen_at DESC`,
    )
    .all(workspaceId) as PresenceRow[]
  return rows.map(rowToPresence)
}

/**
 * 清除 Presence（用户断开连接时调用）
 */
export function clearPresence(db: Database.Database, userId: string, hostInstanceId: string): void {
  db.prepare('DELETE FROM presence WHERE user_id = ? AND host_instance_id = ?').run(
    userId,
    hostInstanceId,
  )
}
