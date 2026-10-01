/**
 * Workspace 路由
 */
import { Hono } from 'hono'
import {
  getWorkspaceById,
  listWorkspaces,
  getWorkspaceMember,
  listProjects,
  createProject,
} from '@loom/db'
import type { Database } from 'better-sqlite3'

export function workspaceRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /api/workspaces/:id
  app.get('/:id', (c) => {
    const userId = c.get('userId')
    const ws = getWorkspaceById(db, c.req.param('id'))
    if (!ws) return c.json({ error: 'Not found' }, 404)
    const member = getWorkspaceMember(db, ws.id, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)
    return c.json(ws)
  })

  // GET /api/workspaces/:id/projects
  app.get('/:id/projects', (c) => {
    const userId = c.get('userId')
    const wsId = c.req.param('id')
    const member = getWorkspaceMember(db, wsId, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)
    return c.json(listProjects(db, wsId))
  })

  // POST /api/workspaces/:id/projects
  app.post('/:id/projects', async (c) => {
    const userId = c.get('userId')
    const wsId = c.req.param('id')
    const member = getWorkspaceMember(db, wsId, userId)
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const ws = getWorkspaceById(db, wsId)
    if (!ws) return c.json({ error: 'Workspace not found' }, 404)
    const { slug, name, description } = await c.req.json()
    if (!slug || !name) return c.json({ error: 'slug and name required' }, 400)
    const proj = createProject(db, {
      workspaceId: wsId,
      organizationId: ws.organizationId,
      slug,
      name,
      description,
      creatorId: userId,
    })
    return c.json(proj, 201)
  })

  return app
}
