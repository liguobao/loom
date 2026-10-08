import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { loomHome } from './config.js'
import type { SummaryModel } from './summary.js'

export interface SummaryConfig {
  provider: 'codex-server' | 'dsh'
  command?: string
  args?: string[]
  profile?: string
  maxInputChars?: number
  timeoutSeconds?: number
}
export function validateSummaryConfig(value: unknown): SummaryConfig {
  const config = value as SummaryConfig
  if (!config || !['codex-server', 'dsh'].includes(config.provider)) throw new Error('summary.provider must be codex-server or dsh')
  if (config.command !== undefined && (typeof config.command !== 'string' || !config.command.trim())) throw new Error('summary.command must be an executable path or name')
  if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string'))) throw new Error('summary.args must be an array of arguments')
  if (config.profile !== undefined && (config.provider !== 'dsh' || typeof config.profile !== 'string' || !config.profile.trim())) throw new Error('summary.profile is a DSH profile name')
  if (config.maxInputChars !== undefined && (!Number.isSafeInteger(config.maxInputChars) || config.maxInputChars < 2000 || config.maxInputChars > 1000000)) throw new Error('summary.maxInputChars must be an integer between 2000 and 1000000')
  if (config.timeoutSeconds !== undefined && (!Number.isSafeInteger(config.timeoutSeconds) || config.timeoutSeconds < 1 || config.timeoutSeconds > 3600)) throw new Error('summary.timeoutSeconds must be an integer between 1 and 3600')
  return config
}
export async function resolveSummaryCommand(config: SummaryConfig): Promise<SummaryConfig> {
  const name = config.command || (config.provider === 'codex-server' ? 'codex' : 'dsh')
  const candidates = isAbsolute(name) || name.includes(sep)
    ? [resolve(name)] : (process.env.PATH || '').split(delimiter).map(directory => join(directory, name))
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return { ...config, command: await realpath(candidate) } } catch { /* try next PATH entry */ }
  }
  throw new Error(`Local summarizer executable not found: ${name}. Use --summary-command /absolute/path.`)
}
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const prompt = (system: string, input: string) => `${system}\n你只能总结提供的文本，不要使用工具、读写文件或执行命令。\n\n待总结数据：\n${input}`
function stop(child: ChildProcessWithoutNullStreams): void {
  child.stdin.end()
  child.kill('SIGTERM')
  const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 1000)
  timer.unref()
  child.once('close', () => clearTimeout(timer))
}
export function createSummaryModel(config: SummaryConfig | undefined): SummaryModel {
  if (!config) throw new Error('Choose a local summarizer at startup: --summarizer codex-server or --summarizer dsh')
  validateSummaryConfig(config)
  return async (system, input) => {
    // Keep generated agent sessions outside the workspace being collected.
    const cwd = join(loomHome(), 'summary-runtime')
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    const command = config.command || (config.provider === 'codex-server' ? 'codex' : 'dsh')
    const args = config.provider === 'codex-server'
      ? ['app-server', '--stdio', ...(config.args ?? [])]
      : ['--profile', config.profile || 'headless', ...(config.args ?? []), '--json']
    const child = spawn(command, args, { cwd, stdio: 'pipe', shell: false })
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    try {
      return await new Promise<string>((resolve, reject) => {
        let done = false
        let size = 0
        let answer = ''
        let threadId: string | undefined
        const finish = (error?: Error) => {
          if (done) return
          done = true
          clearTimeout(timeout)
          if (error) reject(error)
          else if (!answer.trim()) reject(new Error('Local summarizer returned no final answer'))
          else resolve(answer)
        }
        const timeout = setTimeout(() => finish(new Error(`Local ${config.provider} summary timed out`)), (config.timeoutSeconds ?? 180) * 1000)
        child.on('error', error => finish(new Error(`Cannot start local ${config.provider}: ${error.message}`)))
        child.stdin.on('error', () => finish(new Error(`Local ${config.provider} closed its input`)))
        // Agent reasoning and startup logs stay out of archive logs.
        child.stderr.resume()
        child.on('close', code => finish(new Error(`Local ${config.provider} exited before completing the summary (exit ${code})`)))
        const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n')
        let finalEvent = false
        lines.on('line', line => {
          if (done) return
          size += Buffer.byteLength(line)
          if (size > MAX_OUTPUT_BYTES) { finish(new Error('Local summarizer output exceeded its limit')); return }
          let message: Record<string, unknown>
          try { message = JSON.parse(line) as Record<string, unknown> }
          catch { finish(new Error('Local summarizer returned invalid protocol JSON')); return }
          if (config.provider === 'dsh') {
            if (message.type === 'error') finish(new Error('Local DSH summary failed'))
            if (message.type === 'final' && typeof message.text === 'string') { answer = message.text; finalEvent = true }
            return
          }
          if (message.method && message.id !== undefined) {
            // Reject tool/permission requests rather than executing archival input.
            send({ id: message.id, error: { code: -32601, message: 'Summary client does not support tool or approval requests' } })
            return
          }
          if (message.error) { finish(new Error('Local Codex app-server request failed')); return }
          if (message.id === 1) {
            send({ method: 'initialized' })
            send({ id: 2, method: 'thread/start', params: {
              cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only',
              baseInstructions: system + '\nOnly summarize supplied data. Do not use tools, execute commands, or read files.',
              config: { web_search: 'disabled', 'features.shell_tool': false },
            } })
          } else if (message.id === 2) {
            const result = message.result as { thread?: { id?: string } } | undefined
            threadId = result?.thread?.id
            if (!threadId) { finish(new Error('Local Codex app-server returned no thread identity')); return }
            send({ id: 3, method: 'turn/start', params: { threadId, input: [{ type: 'text', text: input, text_elements: [] }] } })
          } else if (message.method === 'item/completed') {
            const params = message.params as { threadId?: string; item?: { type?: string; text?: string } } | undefined
            if (params && params.threadId === threadId && params.item?.type === 'agentMessage' && typeof params.item.text === 'string') answer = params.item.text
          } else if (message.method === 'turn/completed') {
            const params = message.params as { threadId?: string; turn?: { status?: string } } | undefined
            if (params && params.threadId === threadId) finish(params.turn?.status === 'completed' ? undefined : new Error('Local Codex summary turn failed'))
          }
        })
        if (config.provider === 'codex-server') send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'loom-summary', version: '0.1.0' } } })
        else {
          // DSH's final event is only accepted after a successful process exit.
          child.removeAllListeners('close')
          child.on('close', code => finish(code === 0 && finalEvent ? undefined : new Error(`Local DSH summary failed (exit ${code})`)))
          child.stdin.end(prompt(system, input))
        }
      })
    } finally { lines.close(); stop(child) }
  }
}
