/**
 * Active Work 路由 — 正在进行的工作（只存 metadata）
 */
import { Hono } from 'hono'
import { ulid } from 'ulid'
import { getProjectMember, getProjectById } from '@loom/db'
import type { Database } from 'better-sqlite3'
import type { ActiveWork } from '@loom/protocol'

// 内存中维护 active work（也可以用 SQLite，这里用内存以保持简单）
// 重启后会丢失，但 Active Work 本来就是临时状态
const activeWorks = new Map<string, ActiveWork>()

export function activeWorkRoutes(db: Database): Hono {
  const app = new Hono()

  // POST /api/active-work — 开始 Active Work
  app.post('/', async (c) => {
    const userId = c.get('userId')
    const body = await c.req.json()
    const { hostInstanceId, projectId, title, repository, branch, visibility } = body

    if (!hostInstanceId || !projectId || !title) {
      return c.json({ error: 'hostInstanceId, projectId, title required' }, 400)
    }

    const proj = getProjectById(db, projectId)
    if (!proj) return c.json({ error: 'Project not found' }, 404)
    const member = getProjectMember(db, projectId, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)

    const work: ActiveWork = {
      id: ulid(),
      hostInstanceId,
      ownerId: userId,
      projectId,
      title,
      repository,
      branch,
      startedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      visibility: visibility ?? 'presence',
    }
    activeWorks.set(work.id, work)

    // 通知 WebSocket 在线的项目成员
    broadcastToProject(projectId, {
      type: 'active_work_update',
      payload: work,
    })

    return c.json(work, 201)
  })

  // PATCH /api/active-work/:id
  app.patch('/:id', async (c) => {
    const userId = c.get('userId')
    const work = activeWorks.get(c.req.param('id'))
    if (!work) return c.json({ error: 'Not found' }, 404)
    if (work.ownerId !== userId) return c.json({ error: 'Forbidden' }, 403)

    const updates = await c.req.json()
    const updated: ActiveWork = {
      ...work,
      ...updates,
      id: work.id,
      ownerId: work.ownerId,
      lastActiveAt: new Date().toISOString(),
    }
    activeWorks.set(work.id, updated)

    broadcastToProject(work.projectId, {
      type: 'active_work_update',
      payload: updated,
    })

    return c.json(updated)
  })

  // DELETE /api/active-work/:id — 结束 Active Work
  app.delete('/:id', (c) => {
    const userId = c.get('userId')
    const work = activeWorks.get(c.req.param('id'))
    if (!work) return c.json({ error: 'Not found' }, 404)
    if (work.ownerId !== userId) return c.json({ error: 'Forbidden' }, 403)

    activeWorks.delete(work.id)
    broadcastToProject(work.projectId, {
      type: 'active_work_end',
      payload: { id: work.id },
    })

    return c.json({ ok: true })
  })

  // GET /api/projects/:id/active-work (委托这里处理)
  app.get('/by-project/:projectId', (c) => {
    const userId = c.get('userId')
    const projectId = c.req.param('projectId')
    const proj = getProjectById(db, projectId)
    if (!proj) return c.json({ error: 'Not found' }, 404)
    const member = getProjectMember(db, projectId, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)

    const works = Array.from(activeWorks.values()).filter(w => w.projectId === projectId)
    return c.json(works)
  })

  return app
}

// WebSocket 广播（由 ws handler 注入）
type BroadcastFn = (projectId: string, msg: object) => void
let _broadcast: BroadcastFn = () => {}
export function setBroadcast(fn: BroadcastFn): void {
  _broadcast = fn
}
function broadcastToProject(projectId: string, msg: object): void {
  _broadcast(projectId, msg)
}

// 导出给 project routes 使用
export function listProjectActiveWork(projectId: string): ActiveWork[] {
  return Array.from(activeWorks.values()).filter(w => w.projectId === projectId)
}
