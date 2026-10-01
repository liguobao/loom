/**
 * Loom Server 入口
 */
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createApp } from './app.js'
import { createWsHandler } from './ws/handler.js'
import { initDatabase } from '@loom/db'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'

const PORT = parseInt(process.env['PORT'] ?? '3000', 10)
const DATA_DIR = process.env['DATA_DIR'] ?? join(process.cwd(), 'data')
const DB_PATH = join(DATA_DIR, 'loom.db')

async function main() {
  // 确保数据目录存在
  await mkdir(DATA_DIR, { recursive: true })

  // 初始化数据库
  const db = initDatabase(DB_PATH)
  console.log(`[loom] Database: ${DB_PATH}`)

  // 创建 Hono app
  const app = createApp(db, DATA_DIR)

  // 创建 Node HTTP server
  const httpServer = createServer()

  // WebSocket server (共享 HTTP server)
  const wss = new WebSocketServer({ server: httpServer })
  const wsHandler = createWsHandler(db)
  wss.on('connection', (ws, req) => wsHandler.handleConnection(ws, req))

  // 挂载 Hono 到 HTTP server
  serve({ fetch: app.fetch, port: PORT, serverCreator: () => httpServer })

  console.log(`[loom] Server running on http://localhost:${PORT}`)
  console.log(`[loom] WebSocket on ws://localhost:${PORT}/ws`)
  console.log(`[loom] Data dir: ${DATA_DIR}`)
}

main().catch(err => {
  console.error('[loom] Fatal error:', err)
  process.exit(1)
})
