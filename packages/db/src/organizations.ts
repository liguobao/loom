import type Database from 'better-sqlite3'
import { ulid } from 'ulid'
import type { Organization, OrganizationMember, User } from '@loom/protocol'

interface OrgRow {
  id: string
  slug: string
  name: string
  created_at: string
  updated_at: string
}

interface OrgMemberRow {
  organization_id: string
  user_id: string
  role: string
  joined_at: string
}

function rowToOrg(row: OrgRow): Organization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToMember(row: OrgMemberRow): OrganizationMember {
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role as OrganizationMember['role'],
    joinedAt: row.joined_at,
  }
}

/**
 * 创建组织，同时将创建者设为 owner
 */
export function createOrganization(
  db: Database.Database,
  params: { slug: string; name: string; creatorId: string },
): Organization {
  const now = new Date().toISOString()
  const id = ulid()

  const insertOrg = db.prepare(
    `INSERT INTO organizations (id, slug, name, created_at, updated_at)
     VALUES (@id, @slug, @name, @now, @now)`,
  )
  const insertMember = db.prepare(
    `INSERT INTO organization_members (organization_id, user_id, role, joined_at)
     VALUES (@organizationId, @userId, 'owner', @now)`,
  )

  const run = db.transaction(() => {
    insertOrg.run({ id, slug: params.slug, name: params.name, now })
    insertMember.run({ organizationId: id, userId: params.creatorId, now })
  })
  run()

  return rowToOrg({ id, slug: params.slug, name: params.name, created_at: now, updated_at: now })
}

/**
 * 按 ID 查询组织
 */
export function getOrganizationById(db: Database.Database, id: string): Organization | undefined {
  const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as OrgRow | undefined
  return row ? rowToOrg(row) : undefined
}

/**
 * 按 slug 查询组织
 */
export function getOrganizationBySlug(db: Database.Database, slug: string): Organization | undefined {
  const row = db.prepare('SELECT * FROM organizations WHERE slug = ?').get(slug) as OrgRow | undefined
  return row ? rowToOrg(row) : undefined
}

/**
 * 列出用户所属的所有组织
 */
export function listUserOrganizations(db: Database.Database, userId: string): Organization[] {
  const rows = db
    .prepare(
      `SELECT o.* FROM organizations o
       JOIN organization_members om ON om.organization_id = o.id
       WHERE om.user_id = ?
       ORDER BY o.created_at ASC`,
    )
    .all(userId) as OrgRow[]
  return rows.map(rowToOrg)
}

/**
 * 添加组织成员
 */
export function addOrganizationMember(
  db: Database.Database,
  params: { organizationId: string; userId: string; role: OrganizationMember['role'] },
): OrganizationMember {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT OR REPLACE INTO organization_members (organization_id, user_id, role, joined_at)
     VALUES (@organizationId, @userId, @role, @now)`,
  ).run({ organizationId: params.organizationId, userId: params.userId, role: params.role, now })

  return { organizationId: params.organizationId, userId: params.userId, role: params.role, joinedAt: now }
}

/**
 * 查询单个成员关系
 */
export function getOrganizationMember(
  db: Database.Database,
  organizationId: string,
  userId: string,
): OrganizationMember | undefined {
  const row = db
    .prepare('SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ?')
    .get(organizationId, userId) as OrgMemberRow | undefined
  return row ? rowToMember(row) : undefined
}

/**
 * 列出组织所有成员（含用户信息）
 */
export function listOrganizationMembers(
  db: Database.Database,
  organizationId: string,
): (OrganizationMember & { user: User })[] {
  const rows = db
    .prepare(
      `SELECT om.*, u.username, u.display_name, u.email, u.avatar_url, u.created_at as u_created_at, u.updated_at as u_updated_at
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = ?
       ORDER BY om.joined_at ASC`,
    )
    .all(organizationId) as (OrgMemberRow & {
    username: string
    display_name: string
    email: string
    avatar_url: string | null
    u_created_at: string
    u_updated_at: string
  })[]

  return rows.map((row) => ({
    ...rowToMember(row),
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      avatarUrl: row.avatar_url ?? undefined,
      createdAt: row.u_created_at,
      updatedAt: row.u_updated_at,
    },
  }))
}
