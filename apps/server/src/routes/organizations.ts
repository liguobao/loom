/**
 * Organization 路由
 */
import { Hono } from 'hono'
import {
  createOrganization,
  getOrganizationById,
  listUserOrganizations,
  addOrganizationMember,
  getOrganizationMember,
  listOrganizationMembers,
  listWorkspaces,
  createWorkspace,
} from '@loom/db'
import type { Database } from 'better-sqlite3'

export function organizationRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /api/organizations — 列出我的组织
  app.get('/', (c) => {
    const userId = c.get('userId')
    const orgs = listUserOrganizations(db, userId)
    return c.json(orgs)
  })

  // POST /api/organizations — 创建组织
  app.post('/', async (c) => {
    const userId = c.get('userId')
    const { slug, name } = await c.req.json()
    if (!slug || !name) return c.json({ error: 'slug and name required' }, 400)

    const org = createOrganization(db, { slug, name, creatorId: userId })
    return c.json(org, 201)
  })

  // GET /api/organizations/:id
  app.get('/:id', (c) => {
    const org = getOrganizationById(db, c.req.param('id'))
    if (!org) return c.json({ error: 'Not found' }, 404)
    return c.json(org)
  })

  // GET /api/organizations/:id/members
  app.get('/:id/members', (c) => {
    const userId = c.get('userId')
    const orgId = c.req.param('id')
    const member = getOrganizationMember(db, orgId, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)
    const members = listOrganizationMembers(db, orgId)
    return c.json(members)
  })

  // POST /api/organizations/:id/members — 邀请成员
  app.post('/:id/members', async (c) => {
    const userId = c.get('userId')
    const orgId = c.req.param('id')
    const member = getOrganizationMember(db, orgId, userId)
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const { userId: targetUserId, role } = await c.req.json()
    if (!targetUserId) return c.json({ error: 'userId required' }, 400)
    const result = addOrganizationMember(db, {
      organizationId: orgId,
      userId: targetUserId,
      role: role ?? 'member',
    })
    return c.json(result, 201)
  })

  // GET /api/organizations/:id/workspaces
  app.get('/:id/workspaces', (c) => {
    const userId = c.get('userId')
    const orgId = c.req.param('id')
    const member = getOrganizationMember(db, orgId, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)
    return c.json(listWorkspaces(db, orgId))
  })

  // POST /api/organizations/:id/workspaces
  app.post('/:id/workspaces', async (c) => {
    const userId = c.get('userId')
    const orgId = c.req.param('id')
    const member = getOrganizationMember(db, orgId, userId)
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const { slug, name, description } = await c.req.json()
    if (!slug || !name) return c.json({ error: 'slug and name required' }, 400)
    const ws = createWorkspace(db, { organizationId: orgId, slug, name, description, creatorId: userId })
    return c.json(ws, 201)
  })

  return app
}
