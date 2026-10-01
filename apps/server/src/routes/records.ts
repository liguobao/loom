/**
 * Work Record 路由 — Archive Plane
 * Markdown 是正文真源，SQLite 只存索引
 */
import { Hono } from 'hono'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { ulid } from 'ulid'
import {
  createRecordIndex,
  getRecordById,
  getProjectMember,
  getProjectById,
  deleteRecordIndex,
} from '@loom/db'
import type { Database } from 'better-sqlite3'

export function recordRoutes(db: Database, dataDir: string): Hono {
  const app = new Hono()

  // POST /api/records — 上传 Work Record
  app.post('/', async (c) => {
    const userId = c.get('userId')
    const body = await c.req.json()
    const {
      projectId,
      organizationId,
      workspaceId,
      title,
      repository,
      branch,
      baseCommit,
      finalCommit,
      tags,
      changedAreas,
      sourceConversationCount,
      markdownContent,
    } = body

    if (!projectId || !title || !markdownContent) {
      return c.json({ error: 'projectId, title, markdownContent required' }, 400)
    }

    // 权限检查
    const proj = getProjectById(db, projectId)
    if (!proj) return c.json({ error: 'Project not found' }, 404)
    const member = getProjectMember(db, projectId, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)

    const id = ulid()
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')

    const orgId = organizationId ?? proj.organizationId
    const wsId = workspaceId ?? proj.workspaceId
    const relativePath = `organizations/${orgId}/workspaces/${wsId}/projects/${projectId}/records/${year}/${month}/${id}.md`
    const absolutePath = join(dataDir, relativePath)

    // 写 Markdown 文件到磁盘
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, markdownContent, 'utf-8')

    // 写 SQLite 索引
    const record = createRecordIndex(db, {
      id,
      organizationId: orgId,
      workspaceId: wsId,
      projectId,
      ownerId: userId,
      relativePath,
      title,
      repository,
      branch,
      finalCommit,
      tags: Array.isArray(tags) ? tags.join(',') : (tags ?? ''),
      changedAreas: Array.isArray(changedAreas) ? changedAreas.join(',') : (changedAreas ?? ''),
      createdAt: now.toISOString(),
    })

    return c.json(record, 201)
  })

  // GET /api/records/:id — 获取记录详情（含 Markdown 正文）
  app.get('/:id', async (c) => {
    const userId = c.get('userId')
    const record = getRecordById(db, c.req.param('id'))
    if (!record) return c.json({ error: 'Not found' }, 404)

    // 权限检查
    const member = getProjectMember(db, record.projectId, userId)
    if (!member) return c.json({ error: 'Forbidden' }, 403)

    // 读取 Markdown 文件
    const absolutePath = join(dataDir, record.relativePath)
    let content: string
    try {
      content = await readFile(absolutePath, 'utf-8')
    } catch {
      content = '<!-- Markdown file not found on disk -->'
    }

    return c.json({ meta: record, content })
  })

  // DELETE /api/records/:id
  app.delete('/:id', (c) => {
    const userId = c.get('userId')
    const record = getRecordById(db, c.req.param('id'))
    if (!record) return c.json({ error: 'Not found' }, 404)
    if (record.ownerId !== userId) return c.json({ error: 'Forbidden' }, 403)
    deleteRecordIndex(db, record.id)
    // 注意：不删除 Markdown 文件本身（保留历史记录）
    return c.json({ ok: true })
  })

  return app
}
