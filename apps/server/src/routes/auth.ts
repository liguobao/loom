/**
 * 认证路由 - 注册/登录/获取当前用户
 */
import { Hono } from 'hono'
import { createUser, getUserByUsername, getUserByEmail, getUserById } from '@loom/db'
import { createSession, getSessionByToken } from '@loom/db'
import { hashToken } from '@loom/crypto'
import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'

function hashPassword(password: string): string {
  // 简单 SHA-256 hash，生产应使用 bcrypt/argon2
  return createHash('sha256').update(password + 'loom-salt-v1').digest('hex')
}

export function authRoutes(db: Database): Hono {
  const app = new Hono()

  // POST /api/auth/register
  app.post('/register', async (c) => {
    const body = await c.req.json()
    const { username, displayName, email, password } = body

    if (!username || !email || !password) {
      return c.json({ error: 'username, email, password are required' }, 400)
    }

    // 检查用户名/邮箱是否已存在
    const existingUsername = getUserByUsername(db, username)
    if (existingUsername) {
      return c.json({ error: 'Username already taken' }, 409)
    }
    const existingEmail = getUserByEmail(db, email)
    if (existingEmail) {
      return c.json({ error: 'Email already registered' }, 409)
    }

    const user = createUser(db, {
      username,
      displayName: displayName || username,
      email,
      passwordHash: hashPassword(password),
    })

    const session = createSession(db, user.id)
    return c.json({
      token: session.token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
      },
    }, 201)
  })

  // POST /api/auth/login
  app.post('/login', async (c) => {
    const body = await c.req.json()
    const { username, password } = body

    if (!username || !password) {
      return c.json({ error: 'username and password are required' }, 400)
    }

    const user = getUserByUsername(db, username)
    if (!user || user.passwordHash !== hashPassword(password)) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    const session = createSession(db, user.id)
    return c.json({
      token: session.token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
      },
    })
  })

  // GET /api/auth/me (需要 token)
  app.get('/me', async (c) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const session = getSessionByToken(db, authHeader.slice(7))
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const user = getUserById(db, session.userId)
    if (!user) return c.json({ error: 'User not found' }, 404)
    return c.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
    })
  })

  return app
}
