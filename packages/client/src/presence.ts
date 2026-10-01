/**
 * Loom Client Presence - 上报本地 Host 的在线状态和 Active Work
 */
import WebSocket from 'ws'
import { getConfig } from './config.js'
import type { WsMessage, PresenceUpdateMessage } from '@loom/protocol'

export interface PresenceOptions {
  hostInstanceId: string
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (err: Error) => void
}

export class PresenceClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private destroyed = false
  private reconnectDelay = 1000

  constructor(private options: PresenceOptions) {}

  connect(): void {
    if (this.destroyed) return
    const config = getConfig()
    const wsUrl = config.serverUrl.replace(/^http/, 'ws') + '/ws'

    this.ws = new WebSocket(wsUrl)

    this.ws.on('open', () => {
      this.reconnectDelay = 1000
      // 发送认证
      this.send({
        type: 'auth',
        payload: {
          token: config.token!,
          hostInstanceId: this.options.hostInstanceId,
        },
      })
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage
        if (msg.type === 'auth_ok') {
          this.options.onConnected?.()
          this.startPing()
        } else if (msg.type === 'ping') {
          this.send({ type: 'pong' })
        }
      } catch {
        // ignore malformed
      }
    })

    this.ws.on('close', () => {
      this.stopPing()
      this.options.onDisconnected?.()
      if (!this.destroyed) {
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (err) => {
      this.options.onError?.(err)
    })
  }

  updatePresence(update: Omit<PresenceUpdateMessage['payload'], 'hostInstanceId'>): void {
    this.send({
      type: 'presence_update',
      payload: {
        hostInstanceId: this.options.hostInstanceId,
        ...update,
      },
    } satisfies PresenceUpdateMessage)
  }

  private send(msg: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' })
    }, 30_000)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
      this.connect()
    }, this.reconnectDelay)
  }

  destroy(): void {
    this.destroyed = true
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    this.ws?.close()
    this.ws = null
  }
}
