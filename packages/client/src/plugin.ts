/**
 * Loom Plugin for DeepSeek Harness (DSH)
 * 基于 Cordis IoC 容器规范实现的 DSH Host 插件
 */
import { getConfig, setServerUrl, isLoggedIn, type LoomConfig } from './config.js'
import { PresenceClient } from './presence.js'
import { ObserverHost } from './observer.js'
import { archiveWork, type ArchiveOptions, type ArchiveResult } from './archive.js'
import { getGitContext } from '@loom/distill'

export interface CordisLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface CordisContext {
  logger: CordisLogger
  effect(
    callback: () => void | Promise<void> | (() => void | Promise<void>) | Promise<() => void | Promise<void>>,
    name?: string,
  ): () => void
  provide(name: string, service: unknown): void
  get(name: string, required?: boolean): unknown
  inject(deps: string[], callback: (ctx: CordisContext) => void): void
  on?(event: string, listener: (...args: unknown[]) => void): () => void
  [key: string]: unknown
}

export interface LoomPluginConfig {
  enabled?: boolean
  serverUrl?: string
  autoPresence?: boolean
  observePermission?: 'hidden' | 'presence' | 'observe'
}

export class LoomPluginService {
  private presenceClient: PresenceClient | null = null
  private observerHost: ObserverHost | null = null
  private hostInstanceId: string
  private active = false

  constructor(
    private ctx: CordisContext,
    private config: LoomPluginConfig,
  ) {
    this.hostInstanceId = process.env['DSH_HOST_INSTANCE_ID'] || `dsh-${process.pid}`
  }

  async start(): Promise<void> {
    if (this.config.enabled === false) {
      this.ctx.logger.info('[dsh-loom] Plugin is disabled in configuration')
      return
    }

    if (this.config.serverUrl) {
      setServerUrl(this.config.serverUrl)
    }

    const localConfig = getConfig()
    this.active = true

    if (!isLoggedIn()) {
      this.ctx.logger.info('[dsh-loom] Plugin loaded (unauthenticated, awaiting login)')
      return
    }

    // 初始化 Observer Host
    this.observerHost = new ObserverHost({
      hostInstanceId: this.hostInstanceId,
      onObserverJoined: (id) => {
        this.ctx.logger.info(`[dsh-loom] Observer joined: ${id}`)
      },
      onObserverLeft: (id) => {
        this.ctx.logger.info(`[dsh-loom] Observer left: ${id}`)
      },
    })

    // 如果开启自动 Presence，启动并上报状态
    if (this.config.autoPresence !== false) {
      try {
        this.presenceClient = new PresenceClient({
          hostInstanceId: this.hostInstanceId,
          onConnected: () => {
            this.ctx.logger.info(`[dsh-loom] Connected to Loom Server (${localConfig.serverUrl})`)
            this.reportInitialPresence()
          },
          onDisconnected: () => {
            this.ctx.logger.warn('[dsh-loom] Disconnected from Loom Server, reconnecting...')
          },
          onError: (err) => {
            this.ctx.logger.warn(`[dsh-loom] Presence connection error: ${err.message}`)
          },
        })

        this.presenceClient.connect()
      } catch (err) {
        this.ctx.logger.warn(`[dsh-loom] Failed to start Presence client: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private async reportInitialPresence(): Promise<void> {
    if (!this.presenceClient) return
    try {
      const gitContext = await getGitContext(process.cwd())
      this.presenceClient.updatePresence({
        status: 'online',
        title: gitContext.repository ? `Working on ${gitContext.repository}` : 'Active Session',
        observePermission: this.config.observePermission ?? 'presence',
      })
    } catch {
      this.presenceClient.updatePresence({
        status: 'online',
        title: 'Active Session',
        observePermission: this.config.observePermission ?? 'presence',
      })
    }
  }

  async archive(options: ArchiveOptions): Promise<ArchiveResult> {
    this.ctx.logger.info(`[dsh-loom] Archiving work record: ${options.title}`)
    return archiveWork(options)
  }

  getObserverHost(): ObserverHost | null {
    return this.observerHost
  }

  getPresenceClient(): PresenceClient | null {
    return this.presenceClient
  }

  isActive(): boolean {
    return this.active
  }

  destroy(): void {
    this.active = false
    if (this.presenceClient) {
      this.presenceClient.destroy()
      this.presenceClient = null
    }
    if (this.observerHost) {
      this.observerHost.destroy()
      this.observerHost = null
    }
    this.ctx.logger.info('[dsh-loom] Plugin disposed')
  }
}

export const name = 'dsh-loom'

export function apply(ctx: CordisContext, config: LoomPluginConfig = {}): void {
  // 安全双写日志：既输出到 DSH 官方 logger，也输出到 stdout 方便桌面与命令行检索
  const logger: CordisLogger = {
    debug: (msg, ...args) => {
      try { ctx.logger?.debug?.(msg, ...args) } catch {}
      console.debug(msg, ...args)
    },
    info: (msg, ...args) => {
      try { ctx.logger?.info?.(msg, ...args) } catch {}
      console.info(msg, ...args)
    },
    warn: (msg, ...args) => {
      try { ctx.logger?.warn?.(msg, ...args) } catch {}
      console.warn(msg, ...args)
    },
    error: (msg, ...args) => {
      try { ctx.logger?.error?.(msg, ...args) } catch {}
      console.error(msg, ...args)
    },

  }
  const safeCtx: CordisContext = { ...ctx, logger }

  const service = new LoomPluginService(safeCtx, config)

  // 向 Cordis 容器注入 loom 服务
  if (typeof safeCtx.provide === 'function') {
    safeCtx.provide('loom', service)
  }

  // 绑定生命周期
  if (typeof safeCtx.effect === 'function') {
    safeCtx.effect(async () => {
      await service.start()
      return () => {
        service.destroy()
      }
    }, 'dsh-loom:runtime')
  } else {
    // 降级直接启动
    service.start().catch((err) => {
      logger.error(`Startup error: ${err instanceof Error ? err.message : String(err)}`)
    })
  }
}

