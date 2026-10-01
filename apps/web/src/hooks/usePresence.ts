// WebSocket presence hook — 订阅 project 级别的实时 presence 和 active work 更新
import { useEffect, useRef, useState, useCallback } from 'react'
import type { ActiveWork, Presence } from '@loom/protocol'
import type {
  WsMessage,
  PresenceListMessage,
  PresenceUpdateMessage,
  ActiveWorkUpdateMessage,
  ActiveWorkEndMessage,
} from '@loom/protocol'
import { useAuthStore } from '@/lib/store'

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

// 内部临时扩展 Presence，以便存储 observePermission
interface PresenceEntry extends Presence {
  observePermission: 'hidden' | 'presence' | 'observe'
}

export function useProjectPresence(projectId: string): {
  activeWorks: ActiveWork[]
  presences: Presence[]
} {
  const token = useAuthStore((s) => s.token)
  const [activeWorks, setActiveWorks] = useState<ActiveWork[]>([])
  const [presences, setPresences] = useState<PresenceEntry[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (!token) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      // 1. 认证
      ws.send(JSON.stringify({ type: 'auth', payload: { token } }))
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(event.data) as WsMessage
      } catch {
        return
      }

      switch (msg.type) {
        case 'auth_ok': {
          // 2. 认证成功后订阅 presence
          ws.send(
            JSON.stringify({
              type: 'presence_subscribe',
              payload: { projectId },
            }),
          )
          break
        }

        case 'presence_list': {
          const { presences: list } = (msg as PresenceListMessage).payload
          setPresences(
            list.map((p) => ({
              userId: p.userId,
              hostInstanceId: p.hostInstanceId,
              activeWorkId: p.activeWorkId,
              projectId: p.projectId,
              status: p.status,
              lastSeenAt: p.lastSeenAt,
              observePermission: p.observePermission,
            })),
          )
          break
        }

        case 'presence_update': {
          const p = (msg as PresenceUpdateMessage).payload
          setPresences((prev) => {
            const idx = prev.findIndex((x) => x.hostInstanceId === p.hostInstanceId)
            const updated: PresenceEntry = {
              userId: '',
              hostInstanceId: p.hostInstanceId,
              activeWorkId: p.activeWorkId,
              projectId: p.projectId,
              status: p.status,
              lastSeenAt: new Date().toISOString(),
              observePermission: p.observePermission,
            }
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = { ...prev[idx], ...updated }
              return next
            }
            return [...prev, updated]
          })
          break
        }

        case 'active_work_update': {
          const aw = (msg as ActiveWorkUpdateMessage).payload
          if (aw.projectId !== projectId) break
          setActiveWorks((prev) => {
            const idx = prev.findIndex((x) => x.id === aw.id)
            const updated: ActiveWork = {
              id: aw.id,
              hostInstanceId: aw.hostInstanceId,
              ownerId: '',
              projectId: aw.projectId,
              title: aw.title,
              repository: aw.repository,
              branch: aw.branch,
              startedAt: new Date().toISOString(),
              lastActiveAt: new Date().toISOString(),
              visibility: aw.visibility,
            }
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = { ...prev[idx], ...updated }
              return next
            }
            return [...prev, updated]
          })
          break
        }

        case 'active_work_end': {
          const { id } = (msg as ActiveWorkEndMessage).payload
          setActiveWorks((prev) => prev.filter((x) => x.id !== id))
          break
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }))
          break
        }

        default:
          break
      }
    }

    ws.onclose = () => {
      // 断线重连，5 秒后重试
      reconnectTimerRef.current = setTimeout(connect, 5000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [token, projectId])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { activeWorks, presences }
}
