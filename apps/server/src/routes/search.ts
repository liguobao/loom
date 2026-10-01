/**
 * Search 路由 - SQLite FTS5 全文搜索
 */
import { Hono } from 'hono'
import { searchRecords } from '@loom/db'
import type { Database } from 'better-sqlite3'

export function searchRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /api/search?q=<query>&projectId=&organizationId=
  app.get('/', (c) => {
    const q = c.req.query('q')
    if (!q || q.trim().length === 0) {
      return c.json({ error: 'q (query) parameter required' }, 400)
    }
    const projectId = c.req.query('projectId')
    const organizationId = c.req.query('organizationId')

    const results = searchRecords(db, q.trim(), projectId, organizationId)
    return c.json(results)
  })

  return app
}
