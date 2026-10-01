/**
 * Project 路由
 */
import { Hono } from 'hono'
import {
  getProjectById,
  getProjectMember,
  listProjectRepositories,
  addProjectRepository,
  listProjectRecords,
} from '@loom/db'
import { listProjectActiveWork } from './active-work.js'
import type { Database } from 'better-sqlite3'

export function projectRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /api/projects/:id
  app.get('/:id', (c) => {
    const userId = c.get('userId')
    const proj = getProjectById(db, c.req.param('id'))
    if (!proj) return c.json({ error: 'Not found' }, 404)
    const member = getProjectMember(db, proj.id, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)
    const repos = listProjectRepositories(db, proj.id)
    return c.json({ ...proj, repositories: repos })
  })

  // GET /api/projects/:id/records
  app.get('/:id/records', (c) => {
    const userId = c.get('userId')
    const projId = c.req.param('id')
    const proj = getProjectById(db, projId)
    if (!proj) return c.json({ error: 'Not found' }, 404)
    const member = getProjectMember(db, projId, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)
    const limit = parseInt(c.req.query('limit') ?? '20')
    const offset = parseInt(c.req.query('offset') ?? '0')
    const records = listProjectRecords(db, projId, limit, offset)
    return c.json(records)
  })

  // GET /api/projects/:id/active-work
  app.get('/:id/active-work', (c) => {
    const userId = c.get('userId')
    const projId = c.req.param('id')
    const proj = getProjectById(db, projId)
    if (!proj) return c.json({ error: 'Not found' }, 404)
    const member = getProjectMember(db, projId, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)
    const works = listProjectActiveWork(projId)
    return c.json(works)
  })

  // POST /api/projects/:id/repositories — 添加关联仓库
  app.post('/:id/repositories', async (c) => {
    const userId = c.get('userId')
    const projId = c.req.param('id')
    const proj = getProjectById(db, projId)
    if (!proj) return c.json({ error: 'Not found' }, 404)
    const member = getProjectMember(db, projId, userId)
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const { repoUrl } = await c.req.json()
    if (!repoUrl) return c.json({ error: 'repoUrl required' }, 400)
    const repo = addProjectRepository(db, { projectId: projId, repoUrl })
    return c.json(repo, 201)
  })

  return app
}
