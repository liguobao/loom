import type Database from 'better-sqlite3'
import { ulid } from 'ulid'
import type { User } from '@loom/protocol'

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

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface UserWithHash extends User {
  passwordHash: string
}

function rowToUserWithHash(row: UserRow): UserWithHash {
  return {
    ...rowToUser(row),
    passwordHash: row.password_hash,
  }
}

/**
 * 创建用户
 */
export function createUser(
  db: Database.Database,
  params: { username: string; displayName: string; email: string; passwordHash: string },
): User {
  const now = new Date().toISOString()
  const id = ulid()

  db.prepare(
    `INSERT INTO users (id, username, display_name, email, password_hash, created_at, updated_at)
     VALUES (@id, @username, @displayName, @email, @passwordHash, @now, @now)`,
  ).run({ id, username: params.username, displayName: params.displayName, email: params.email, passwordHash: params.passwordHash, now })

  return rowToUser({
    id,
    username: params.username,
    display_name: params.displayName,
    email: params.email,
    avatar_url: null,
    password_hash: params.passwordHash,
    created_at: now,
    updated_at: now,
  })
}

/**
 * 按 ID 查询用户
 */
export function getUserById(db: Database.Database, id: string): User | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  return row ? rowToUser(row) : undefined
}

/**
 * 按用户名查询用户（含密码哈希，用于登录验证）
 */
export function getUserByUsername(db: Database.Database, username: string): UserWithHash | undefined {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
  return row ? rowToUserWithHash(row) : undefined
}

/**
 * 按邮箱查询用户（含密码哈希）
 */
export function getUserByEmail(db: Database.Database, email: string): UserWithHash | undefined {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
  return row ? rowToUserWithHash(row) : undefined
}

/**
 * 更新用户信息
 */
export function updateUser(
  db: Database.Database,
  id: string,
  updates: Partial<{ displayName: string; email: string; avatarUrl: string; passwordHash: string }>,
): User {
  const now = new Date().toISOString()
  const sets: string[] = ['updated_at = @now']
  const params: Record<string, unknown> = { id, now }

  if (updates.displayName !== undefined) { sets.push('display_name = @displayName'); params.displayName = updates.displayName }
  if (updates.email !== undefined) { sets.push('email = @email'); params.email = updates.email }
  if (updates.avatarUrl !== undefined) { sets.push('avatar_url = @avatarUrl'); params.avatarUrl = updates.avatarUrl }
  if (updates.passwordHash !== undefined) { sets.push('password_hash = @passwordHash'); params.passwordHash = updates.passwordHash }

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(params)

  const updated = getUserById(db, id)
  if (!updated) throw new Error(`User ${id} not found after update`)
  return updated
}
