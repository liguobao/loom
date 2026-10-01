/**
 * 认证中间件 - 验证 Bearer token
 */
import type { MiddlewareHandler } from 'hono'
import { getSessionByToken } from '@loom/db'
import type { Database } from 'better-sqlite3'

export function createAuthMiddleware(db: Database): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const token = authHeader.slice(7)
    const session = getSessionByToken(db, token)
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    // token 过期检查
    if (new Date(session.expiresAt) < new Date()) {
      return c.json({ error: 'Token expired' }, 401)
    }
    c.set('userId', session.userId)
    await next()
  }
}
