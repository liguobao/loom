/**
 * Loom Client Observer - 提供 Host 端的只读观察端点
 * 当其他成员请求 Watch 时，这个模块负责在 E2EE 下流式发送 Conversation 片段
 *
 * 重要：实际 Conversation 内容经过 Noise IK 加密后通过 Server relay 转发，
 * Server 不能读取明文。
 */
import WebSocket from 'ws'
import { getConfig, getOrCreateStaticKey } from './config.js'
import { encryptMessage } from '@loom/crypto'
import type { WsMessage, ObserveStreamMessage } from '@loom/protocol'
import type { NoiseState } from '@loom/crypto'

export interface ObserverSession {
  observerId: string
  noiseState: NoiseState
  ws: WebSocket
}

export interface ObserverHostOptions {
  hostInstanceId: string
  onObserverJoined?: (observerId: string) => void
  onObserverLeft?: (observerId: string) => void
}

/**
 * ObserverHost 在 Host 端运行，
 * 接受来自服务器的 observe_request 并建立 E2EE 连接
 */
export class ObserverHost {
  private sessions: Map<string, ObserverSession> = new Map()

  constructor(private options: ObserverHostOptions) {}

  /**
   * 广播加密后的 Conversation 片段到所有当前 Observer
   * 参数 chunk 是要发送的明文片段（JSON string）
   */
  broadcastChunk(chunk: string, ws: WebSocket): void {
    const encoder = new TextEncoder()
    const plaintext = encoder.encode(chunk)

    for (const [observerId, session] of this.sessions.entries()) {
      try {
        const encrypted = encryptMessage(session.noiseState, plaintext)
        const msg: ObserveStreamMessage = {
          type: 'observe_stream',
          payload: {
            hostInstanceId: this.options.hostInstanceId,
            encryptedChunk: Buffer.from(encrypted).toString('base64'),
            nonce: String(session.noiseState.sendNonce - 1),
          },
        }
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify(msg))
        }
      } catch (err) {
        // 加密失败时移除该 observer
        this.removeSession(observerId)
      }
    }
  }

  addSession(session: ObserverSession): void {
    this.sessions.set(session.observerId, session)
    this.options.onObserverJoined?.(session.observerId)
  }

  removeSession(observerId: string): void {
    this.sessions.delete(observerId)
    this.options.onObserverLeft?.(observerId)
  }

  getObserverCount(): number {
    return this.sessions.size
  }

  destroy(): void {
    this.sessions.clear()
  }
}
