// WebSocket 控制通道消息类型

export type MessageType =
  // 连接/认证
  | 'auth'
  | 'auth_ok'
  | 'auth_error'
  // Presence
  | 'presence_update'
  | 'presence_subscribe'
  | 'presence_list'
  // Active Work
  | 'active_work_update'
  | 'active_work_end'
  // Observer
  | 'observe_request'
  | 'observe_accept'
  | 'observe_deny'
  | 'observe_stream'
  | 'observe_end'
  // Relay / signaling
  | 'relay_offer'
  | 'relay_answer'
  | 'relay_ice'
  // System
  | 'ping'
  | 'pong'
  | 'error'

export interface WsMessage {
  type: MessageType
  id?: string
  payload?: unknown
}

export interface AuthMessage extends WsMessage {
  type: 'auth'
  payload: { token: string; hostInstanceId?: string }
}

export interface AuthOkMessage extends WsMessage {
  type: 'auth_ok'
  payload: { userId: string }
}

export interface AuthErrorMessage extends WsMessage {
  type: 'auth_error'
  payload: { message: string }
}

export interface PresenceUpdateMessage extends WsMessage {
  type: 'presence_update'
  payload: {
    hostInstanceId: string
    status: 'online' | 'offline'
    activeWorkId?: string
    projectId?: string
    title?: string
    observePermission: 'hidden' | 'presence' | 'observe'
  }
}

export interface PresenceSubscribeMessage extends WsMessage {
  type: 'presence_subscribe'
  payload: {
    projectId?: string
    workspaceId?: string
  }
}

export interface PresenceListMessage extends WsMessage {
  type: 'presence_list'
  payload: {
    presences: Array<{
      userId: string
      hostInstanceId: string
      status: 'online' | 'offline'
      activeWorkId?: string
      projectId?: string
      observePermission: 'hidden' | 'presence' | 'observe'
      lastSeenAt: string
    }>
  }
}

export interface ActiveWorkUpdateMessage extends WsMessage {
  type: 'active_work_update'
  payload: {
    id: string
    hostInstanceId: string
    projectId: string
    title: string
    repository?: string
    branch?: string
    visibility: 'hidden' | 'presence' | 'observe'
  }
}

export interface ActiveWorkEndMessage extends WsMessage {
  type: 'active_work_end'
  payload: { id: string; hostInstanceId: string }
}

export interface ObserveRequestMessage extends WsMessage {
  type: 'observe_request'
  payload: {
    hostInstanceId: string // 被观察的 host
    requesterId: string
  }
}

export interface ObserveAcceptMessage extends WsMessage {
  type: 'observe_accept'
  payload: { hostInstanceId: string; requesterId: string }
}

export interface ObserveDenyMessage extends WsMessage {
  type: 'observe_deny'
  payload: { hostInstanceId: string; requesterId: string; reason?: string }
}

export interface ObserveStreamMessage extends WsMessage {
  type: 'observe_stream'
  payload: {
    // E2EE 加密后的数据，服务器只转发不解密
    hostInstanceId: string
    encryptedChunk: string // base64
    nonce: string // base64
  }
}

export interface ObserveEndMessage extends WsMessage {
  type: 'observe_end'
  payload: { hostInstanceId: string }
}

export interface RelayMessage extends WsMessage {
  type: 'relay_offer' | 'relay_answer' | 'relay_ice'
  payload: {
    from: string
    to: string
    data: unknown
  }
}

export interface PingMessage extends WsMessage {
  type: 'ping'
}

export interface PongMessage extends WsMessage {
  type: 'pong'
}

export interface ErrorMessage extends WsMessage {
  type: 'error'
  payload: { code: string; message: string }
}
