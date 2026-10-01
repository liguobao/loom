import type Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'
import type { Session, User } from '@loom/protocol'

interface SessionRow {
  id: string
  user_id: string
  token: string
  expires_at: string
  created_at: string
}

interface UserRow {
  id: string
  username: string
  display_name: string
  email: string
  avatar_url: string | null
  password_hash: string
  created_at: string
  updated_at: string
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

/**
 * 创建会话，默认 TTL 24 小时
 */
export function createSession(db: Database.Database, userId: string, ttlHours = 24): Session {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000)
  const id = ulid()
  // 生成安全随机 token（32 bytes = 64 hex chars）
  const token = randomBytes(32).toString('hex')

  db.prepare(
    `INSERT INTO sessions (id, user_id, token, expires_at, created_at)
     VALUES (@id, @userId, @token, @expiresAt, @createdAt)`,
  ).run({
    id,
    userId,
    token,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  })

  return { id, userId, token, expiresAt: expiresAt.toISOString(), createdAt: now.toISOString() }
}

/**
 * 按 token 查询会话（含用户信息），同时验证未过期
 */
export function getSessionByToken(
  db: Database.Database,
  token: string,
): (Session & { user: User }) | undefined {
  const row = db
    .prepare(
      `SELECT s.*, u.username, u.display_name, u.email, u.avatar_url,
              u.created_at as u_created_at, u.updated_at as u_updated_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, new Date().toISOString()) as
    | (SessionRow & {
        username: string
        display_name: string
        email: string
        avatar_url: string | null
        u_created_at: string
        u_updated_at: string
      })
    | undefined

  if (!row) return undefined

  return {
    ...rowToSession(row),
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      avatarUrl: row.avatar_url ?? undefined,
      createdAt: row.u_created_at,
      updatedAt: row.u_updated_at,
    },
  }
}

/**
 * 删除指定 token 的会话（登出）
 */
export function deleteSession(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

/**
 * 清理所有过期会话
 */
export function deleteExpiredSessions(db: Database.Database): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
}
