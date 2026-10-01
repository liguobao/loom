/**
 * WebSocket 消息处理器 — Live Plane
 *
 * 职责:
 * - 认证 WebSocket 连接
 * - 管理 Presence (在线状态广播)
 * - Observer 请求中继 (E2EE, 服务端不读明文)
 * - Relay signaling (offer/answer/ice)
 * - Ping/Pong 心跳
 */
import type { IncomingMessage } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { getSessionByToken, upsertPresence, clearPresence, listWorkspacePresence } from '@loom/db'
import type { Database } from 'better-sqlite3'
import type { WsMessage, PresenceUpdateMessage, ObserveStreamMessage, RelayMessage } from '@loom/protocol'
import { setBroadcast } from '../routes/active-work.js'

interface ConnectedClient {
  ws: WebSocket
  userId: string
  hostInstanceId?: string
  projectSubscriptions: Set<string>
  workspaceSubscriptions: Set<string>
}

export class WsHandler {
  private clients: Map<string, ConnectedClient> = new Map() // clientId -> client

  constructor(private db: Database) {
    // 注册广播函数给 active-work 路由使用
    setBroadcast((projectId, msg) => {
      this.broadcastToProject(projectId, msg)
    })
  }

  handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = Math.random().toString(36).slice(2)
    let client: ConnectedClient | null = null

    // 连接超时：10 秒内未完成认证则断开
    const authTimeout = setTimeout(() => {
      if (!client) {
        ws.close(4001, 'Authentication timeout')
      }
    }, 10_000)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage
        this.handleMessage(clientId, ws, msg, (c) => {
          client = c
          clearTimeout(authTimeout)
        })
      } catch (err) {
        this.sendError(ws, 'Invalid JSON message')
      }
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
      if (client) {
        // 下线时清理 presence
        if (client.hostInstanceId) {
          clearPresence(this.db, client.userId, client.hostInstanceId)
          // 广播离线
          this.broadcastPresenceUpdate(client.userId, client.hostInstanceId, 'offline')
        }
        this.clients.delete(clientId)
      }
    })

    ws.on('error', (err) => {
      console.error('[loom/ws] Error:', err.message)
    })
  }

  private handleMessage(
    clientId: string,
    ws: WebSocket,
    msg: WsMessage,
    onAuth: (client: ConnectedClient) => void,
  ): void {
    const client = this.clients.get(clientId)

    switch (msg.type) {
      case 'auth': {
        const { token, hostInstanceId } = (msg as WsMessage & { payload: { token: string; hostInstanceId?: string } }).payload as { token: string; hostInstanceId?: string }
        const session = getSessionByToken(this.db, token)
        if (!session || new Date(session.expiresAt) < new Date()) {
          this.send(ws, { type: 'auth_error', payload: { message: 'Invalid or expired token' } })
          ws.close(4001, 'Unauthorized')
          return
        }

        const newClient: ConnectedClient = {
          ws,
          userId: session.userId,
          hostInstanceId,
          projectSubscriptions: new Set(),
          workspaceSubscriptions: new Set(),
        }
        this.clients.set(clientId, newClient)
        onAuth(newClient)
        this.send(ws, { type: 'auth_ok', payload: { userId: session.userId } })
        break
      }

      case 'ping': {
        this.send(ws, { type: 'pong' })
        break
      }

      case 'presence_update': {
        if (!client) return
        const payload = (msg as PresenceUpdateMessage).payload
        if (client.hostInstanceId) {
          upsertPresence(this.db, {
            userId: client.userId,
            hostInstanceId: client.hostInstanceId,
            activeWorkId: payload.activeWorkId,
            projectId: payload.projectId,
            status: payload.status,
          })
          // 广播给订阅了该 workspace/project 的其他用户
          this.broadcastPresenceUpdate(client.userId, client.hostInstanceId, payload.status, payload)
        }
        break
      }

      case 'presence_subscribe': {
        if (!client) return
        const { projectId, workspaceId } = (msg.payload ?? {}) as { projectId?: string; workspaceId?: string }
        if (projectId) client.projectSubscriptions.add(projectId)
        if (workspaceId) client.workspaceSubscriptions.add(workspaceId)
        // 立即发送当前在线列表
        if (workspaceId) {
          const presences = listWorkspacePresence(this.db, workspaceId)
          this.send(ws, { type: 'presence_list', payload: presences })
        }
        break
      }

      // Observer 相关: 服务端只做 relay，不读明文
      case 'observe_request': {
        if (!client) return
        const { targetHostId } = (msg.payload ?? {}) as { targetHostId?: string }
        if (!targetHostId) return

        // 找到目标 Host 的连接
        const targetClient = this.findClientByHostId(targetHostId)
        if (!targetClient) {
          this.send(ws, {
            type: 'observe_deny',
            payload: { reason: 'Host not connected', hostInstanceId: targetHostId },
          })
          return
        }
        // 转发请求给目标 Host
        this.send(targetClient.ws, {
          type: 'observe_request',
          payload: { from: client.userId, fromClientId: clientId, ...msg.payload },
        })
        break
      }

      case 'observe_accept':
      case 'observe_deny': {
        if (!client) return
        // Host -> Server -> Observer relay
        const { to } = (msg.payload ?? {}) as { to?: string }
        if (to) {
          const targetClient = this.clients.get(to)
          if (targetClient) {
            this.send(targetClient.ws, msg)
          }
        }
        break
      }

      case 'observe_stream': {
        if (!client) return
        // Host 向 Observer 发送加密流 — 服务端透明转发，不解密
        const payload = (msg as ObserveStreamMessage).payload
        const targetClient = this.findClientByHostId(payload.hostInstanceId)
        // 注意：这里转发给所有请求观察该 host 的 observers
        // 实际实现中应维护 host-observer 映射，这里简化处理
        this.broadcastObserveStream(payload.hostInstanceId, msg)
        break
      }

      // Relay signaling
      case 'relay_offer':
      case 'relay_answer':
      case 'relay_ice': {
        if (!client) return
        const { to } = (msg as RelayMessage).payload
        const targetClient = this.clients.get(to)
        if (targetClient) {
          this.send(targetClient.ws, msg)
        }
        break
      }

      default: {
        // 未知消息类型，忽略
        break
      }
    }
  }

  private send(ws: WebSocket, msg: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: 'error', payload: { message } })
  }

  private findClientByHostId(hostInstanceId: string): ConnectedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.hostInstanceId === hostInstanceId) return client
    }
    return undefined
  }

  broadcastToProject(projectId: string, msg: object): void {
    for (const client of this.clients.values()) {
      if (client.projectSubscriptions.has(projectId)) {
        this.send(client.ws, msg)
      }
    }
  }

  private broadcastPresenceUpdate(
    userId: string,
    hostInstanceId: string,
    status: string,
    extra?: object,
  ): void {
    const msg = {
      type: 'presence_update',
      payload: { userId, hostInstanceId, status, ...extra },
    }
    // 广播给所有连接的客户端（后续可按 workspace 过滤）
    for (const client of this.clients.values()) {
      this.send(client.ws, msg)
    }
  }

  private broadcastObserveStream(hostInstanceId: string, msg: object): void {
    // 向所有正在观察该 host 的 observer 转发（E2EE 加密内容）
    // 这里简化为广播给所有 clients（实际应维护 observer 订阅表）
    for (const client of this.clients.values()) {
      if (client.hostInstanceId !== hostInstanceId) {
        this.send(client.ws, msg)
      }
    }
  }
}

export function createWsHandler(db: Database): WsHandler {
  return new WsHandler(db)
}
