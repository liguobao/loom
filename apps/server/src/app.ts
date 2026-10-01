/**
 * Loom Server Hono 应用
 * 三个 Plane: Control (SQLite) + Archive (Markdown) + Live (WebSocket relay)
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import type { Database } from 'better-sqlite3'
import { authRoutes } from './routes/auth.js'
import { organizationRoutes } from './routes/organizations.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { projectRoutes } from './routes/projects.js'
import { machineRoutes } from './routes/machines.js'
import { recordRoutes } from './routes/records.js'
import { searchRoutes } from './routes/search.js'
import { activeWorkRoutes } from './routes/active-work.js'
import { createAuthMiddleware } from './middleware/auth.js'

export type AppEnv = {
  Variables: {
    userId: string
    db: Database
    dataDir: string
  }
}

export function createApp(db: Database, dataDir: string): Hono {
  const app = new Hono()

  // 全局中间件
  app.use('*', logger())
  app.use('*', cors({
    origin: process.env['CORS_ORIGIN'] ?? '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }))
  app.use('*', secureHeaders())

  // 注入 db 和 dataDir 到 context
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('dataDir', dataDir)
    await next()
  })

  // Auth middleware (除了 auth 路由本身)
  const requireAuth = createAuthMiddleware(db)

  // 健康检查
  app.get('/', (c) => c.json({
    name: 'Loom',
    description: 'Keep the work, not the chat.',
    version: '0.1.0',
    status: 'ok',
  }))

  app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }))

  // 路由挂载
  const api = new Hono()
  api.route('/auth', authRoutes(db))
  api.use('/organizations/*', requireAuth)
  api.use('/workspaces/*', requireAuth)
  api.use('/projects/*', requireAuth)
  api.use('/machines/*', requireAuth)
  api.use('/records/*', requireAuth)
  api.use('/search*', requireAuth)
  api.use('/active-work/*', requireAuth)
  api.route('/organizations', organizationRoutes(db))
  api.route('/workspaces', workspaceRoutes(db))
  api.route('/projects', projectRoutes(db))
  api.route('/machines', machineRoutes(db))
  api.route('/records', recordRoutes(db, dataDir))
  api.route('/search', searchRoutes(db))
  api.route('/active-work', activeWorkRoutes(db))

  app.route('/api', api)

  // 404
  app.notFound((c) => c.json({ error: 'Not Found' }, 404))

  // 错误处理
  app.onError((err, c) => {
    console.error('[loom] Error:', err)
    return c.json({ error: err.message }, 500)
  })

  return app
}
