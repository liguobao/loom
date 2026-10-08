/**
 * Loom Plugin for DeepSeek Harness (DSH)
 * 本地对话总结与工作记录归档插件
 * 
 * 核心特性:
 * 1. 本地归档，不依赖 Loom Server；总结使用本机 Agent 的模型配置
 * 2. 自动/手动提取 DeepSeek 对话并提炼总结 (Goal, Outcome, Decisions, Changes, Follow-ups)
 * 3. 自动正则脱敏敏感信息 (API Key, Token, Password 等)
 * 4. 存储到用户文件夹下，按 <workspace>/<project>/<timestamp-id>.md 规范组织
 */
import { archiveWork, type ArchiveOptions, type ArchiveResult, getDefaultStorageDir, resolveWorkspaceAndProject } from './archive.js'
import { extractConversationFromSession } from './session-adapter.js'
import type { ConversationMessage, SummaryConfig } from '@loom/distill'

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
  on?(event: string, listener: (...args: unknown[]) => void | Promise<void>): () => void
  commands?: {
    register(definition: {
      name: string
      description: string
      handler(invocation: { rawInput: string; signal: AbortSignal }): unknown
    }): () => void
  }
  sessions?: {
    list(): unknown[]
    get(id: unknown): unknown
  }
  [key: string]: unknown
}

export interface LoomPluginConfig {
  enabled?: boolean
  autoArchiveOnDispose?: boolean
  outputDir?: string
  workspace?: string
  project?: string
  summary?: SummaryConfig
}

export class LoomPluginService {
  private active = false
  private currentSession: unknown = null
  private archivedSessionIds = new Set<string>()

  constructor(
    private ctx: CordisContext,
    private config: LoomPluginConfig,
  ) {}

  setActiveSession(session: unknown): void {
    this.currentSession = session
  }

  getActiveSession(): unknown {
    if (this.currentSession) return this.currentSession
    // 尝试从 sessions.list() 获取最后一个活跃会话
    try {
      const sessions = this.ctx.sessions?.list?.()
      if (Array.isArray(sessions) && sessions.length > 0) {
        return sessions[sessions.length - 1]
      }
    } catch {
      // ignore
    }
    return null
  }

  /**
   * 归档指定会话
   */
  async archiveSession(session: unknown, options: Partial<ArchiveOptions> = {}): Promise<ArchiveResult | null> {
    if (!session) return null
    const s = session as Record<string, unknown>
    const sessionId = String(s['id'] || '')

    const conversations = extractConversationFromSession(session)
    if (conversations.length === 0) {
      return null
    }

    // 检查是否有实质内容 (至少包含 1 条 user 消息)
    const hasUserMsg = conversations.some((m) => m.role === 'user')
    if (!hasUserMsg) return null

    // 解析工作目录
    const header = s['header'] as Record<string, unknown> | undefined
    const meta = header?.['meta'] as Record<string, unknown> | undefined
    const sessionCwd = typeof meta?.['cwd'] === 'string' ? meta['cwd'] : process.cwd()

    const { workspace, project } = resolveWorkspaceAndProject(sessionCwd, {
      workspace: options.workspace ?? this.config.workspace,
      project: options.project ?? this.config.project,
    })

    const result = await archiveWork({
      conversations,
      cwd: sessionCwd,
      workspace,
      project,
      title: options.title,
      outputDir: options.outputDir ?? this.config.outputDir,
      summary: options.summary ?? this.config.summary,
      ...options,
    })

    if (sessionId) {
      this.archivedSessionIds.add(sessionId)
    }

    this.ctx.logger.info(`[dsh-loom] Work record archived: ${result.relativePath} (redacted: ${result.redactedCount})`)
    return result
  }

  /**
   * 归档当前会话
   */
  async archiveCurrent(options: Partial<ArchiveOptions> = {}): Promise<ArchiveResult | null> {
    const session = this.getActiveSession()
    return this.archiveSession(session, options)
  }

  /**
   * 直接归档传入的消息列表
   */
  async archiveMessages(
    conversations: ConversationMessage[],
    options: Partial<ArchiveOptions> = {},
  ): Promise<ArchiveResult> {
    const cwd = options.cwd ?? process.cwd()
    const { workspace, project } = resolveWorkspaceAndProject(cwd, {
      workspace: options.workspace ?? this.config.workspace,
      project: options.project ?? this.config.project,
    })

    const result = await archiveWork({
      conversations,
      cwd,
      workspace,
      project,
      title: options.title,
      outputDir: options.outputDir ?? this.config.outputDir,
      summary: options.summary ?? this.config.summary,
      ...options,
    })

    this.ctx.logger.info(`[dsh-loom] Messages archived: ${result.relativePath}`)
    return result
  }

  async start(): Promise<void> {
    if (this.config.enabled === false) {
      this.ctx.logger.info('[dsh-loom] Plugin is disabled in configuration')
      return
    }

    this.active = true
    const storageDir = this.config.outputDir ?? getDefaultStorageDir()
    this.ctx.logger.info(`[dsh-loom] Plugin active (local-only mode, output: ${storageDir})`)
  }

  destroy(): void {
    this.active = false
    this.currentSession = null
    this.archivedSessionIds.clear()
    this.ctx.logger.info('[dsh-loom] Plugin disposed')
  }
}

export const name = 'dsh-loom'

export function apply(ctx: CordisContext, config: LoomPluginConfig = {}): void {
  // A headless DSH summary may load this bundle; never archive the summarizer itself.
  if (process.env.LOOM_SUMMARY_RUNTIME === '1') return
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

  // 注入服务到 Cordis
  if (typeof safeCtx.provide === 'function') {
    safeCtx.provide('loom', service)
  }

  // 监听 DSH 会话生命周期
  const setupSessionListeners = (sessionsCtx: CordisContext) => {
    if (typeof sessionsCtx.on !== 'function') return

    // 追踪当前活动会话与事件
    sessionsCtx.on('session/event', (session: unknown) => {
      service.setActiveSession(session)
    })

    sessionsCtx.on('session/created', (session: unknown) => {
      service.setActiveSession(session)
    })

    // 当会话关闭/销毁时，自动总结归档
    sessionsCtx.on('session/disposed', async (session: unknown) => {
      if (config.autoArchiveOnDispose !== false) {
        try {
          await service.archiveSession(session)
        } catch (err) {
          logger.warn(`[dsh-loom] Auto-archive on session disposal failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })
  }

  // 注册 /loom 交互命令
  const setupCommands = (cmdCtx: CordisContext) => {
    const commands = (cmdCtx.commands || cmdCtx.get('commands')) as CordisContext['commands']
    if (!commands || typeof commands.register !== 'function') return

    commands.register({
      name: 'loom',
      description: 'Archive current conversation to local workspace/project Markdown',
      handler: async (invocation) => {
        const title = invocation.rawInput?.trim() || undefined
        try {
          const res = await service.archiveCurrent({ title })
          if (!res) {
            return { kind: 'error', text: '未检测到当前会话或对话内容为空。' }
          }
          return {
            kind: 'success',
            text: `[Loom] 会话已总结并归档到: ${res.localPath}\n(敏感信息脱敏项: ${res.redactedCount})`,
          }
        } catch (err) {
          return {
            kind: 'error',
            text: `[Loom] 归档失败: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      },
    })
  }

  // 生命周期管理
  if (typeof safeCtx.effect === 'function') {
    safeCtx.effect(async () => {
      await service.start()

      // 尝试注入 sessions 和 commands 服务
      if (typeof safeCtx.inject === 'function') {
        safeCtx.inject(['sessions'], setupSessionListeners)
        safeCtx.inject(['commands'], setupCommands)
      } else {
        setupSessionListeners(safeCtx)
        setupCommands(safeCtx)
      }

      return () => {
        service.destroy()
      }
    }, 'dsh-loom:local-runtime')
  } else {
    service.start().catch((err) => {
      logger.error(`[dsh-loom] Startup error: ${err instanceof Error ? err.message : String(err)}`)
    })
  }
}
