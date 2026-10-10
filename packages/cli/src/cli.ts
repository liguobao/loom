#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { sessions } from 'huihua'
import { archiveWorkspace } from './archive.js'
import { defaultConfigPath, findConfigPath, loadConfig, resolveWorkspace, saveConfig, validateConfig, type Config } from './config.js'
import { schedule } from './schedule.js'
import { startArchiveServer } from './server.js'
import { createSummaryModel, resolveSummaryCommand } from './model.js'

declare const LOOM_CLI_VERSION: string

const help = `Loom CLI — local workspace conversation archives

Usage:
  loom init [--workspace path] [--providers codex,claude,deepseek]
  loom archive [--workspace path | --config file]
  loom watch [--workspace path | --config file]
  loom schedule install|uninstall|status [--workspace path | --config file]
  loom providers
  loom server [--workspace path] [--port 8787] [--output path | --config file]
  loom serve           Alias for server

Options:
  --workspace path     Workspace path (default: current Git root or directory)
  --port number        Local browser server port (default: 8787)
  --output path        Archive directory (default: <workspace>/.loom/records)
  --interval seconds   Time between scans (default: 300, range: 1..86400)
  --summarizer backend Local summary backend: codex-server or dsh (default: codex-server)
  --summary-command p  Executable path (default: codex or dsh)
  --summary-profile p  DSH headless profile (default: headless)
  --config file        JSON configuration; init writes to this path
  --force              Replace an existing config with init
  --help, -h           Show help
  --version, -v        Show version

init defaults to all Huihua providers. roots/homeDir can be set in JSON.
init stores config and records in the Git root's .loom directory (or current directory outside Git).
Archives are redacted Markdown summaries; original agent stores are read only.
`
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      workspace: { type: 'string' }, output: { type: 'string' }, providers: { type: 'string' },
      summarizer: { type: 'string' }, 'summary-command': { type: 'string' }, 'summary-profile': { type: 'string' },
      port: { type: 'string' }, interval: { type: 'string' }, config: { type: 'string' }, force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    },
  })
  if (values.version) { console.log(LOOM_CLI_VERSION); return }
  if (values.help || !positionals.length) { console.log(help); return }
  const [command, action] = positionals
  if (!['init', 'archive', 'watch', 'schedule', 'providers', 'server', 'serve'].includes(command)) throw new Error(`Unknown command: ${command}`)
  if (positionals.length > (command === 'schedule' ? 2 : 1)) throw new Error('Unexpected positional arguments')
  if (command === 'providers') { console.log(sessions.providers().map(p => p.id).join('\n')); return }
  if (command === 'server' || command === 'serve') {
    const server = await startArchiveServer({ port: values.port === undefined ? undefined : Number(values.port),
      workspace: values.workspace, outputDir: values.output ? resolve(values.output) : undefined, configPath: values.config ? resolve(values.config) : undefined })
    const address = server.address()
    console.log(`Loom archive browser: http://127.0.0.1:${typeof address === 'object' && address ? address.port : values.port || 8787}`)
    console.log('Press Ctrl+C to stop. Refresh the page to see new archives.')
    const stop = () => { server.close(); server.closeAllConnections(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop) }
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
    return
  }
  const workspace = await resolveWorkspace(values.workspace || process.cwd())
  const configPath = resolve(values.config || (command === 'init' ? undefined : await findConfigPath(workspace)) || defaultConfigPath(workspace))
  const summaryOverride = (existing: Config['summary']): Config['summary'] => {
    const base = existing || { provider: 'codex-server' as const }
    if (!values.summarizer && !values['summary-command'] && !values['summary-profile']) return base
    const provider = values.summarizer || base.provider
    if (provider !== 'codex-server' && provider !== 'dsh') throw new Error('--summarizer must be codex-server or dsh')
    return { ...(provider === base.provider ? base : {}), provider,
      ...(values['summary-command'] ? { command: values['summary-command'] } : {}),
      ...(values['summary-profile'] ? { profile: values['summary-profile'] } : {}),
    }
  }
  let config: Config
  if (command === 'init') {
    if (!values.force) {
      try { await stat(configPath); throw new Error(`Config exists: ${configPath}. Use --force to replace it.`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const customOutput = values.output || process.env.LOOM_STORAGE_DIR
    config = validateConfig({ version: 1, workspace, outputDir: resolve(customOutput || join(workspace, '.loom', 'records')),
      archiveLayout: customOutput ? 'workspace' : 'flat',
      providers: values.providers ? values.providers.split(',').map(p => p.trim()) : sessions.providers().map(p => p.id),
      intervalSeconds: Number(values.interval || 300), summary: summaryOverride(undefined) })
    await mkdir(config.outputDir, { recursive: true, mode: 0o700 })
    await saveConfig(configPath, config)
    console.log(`Created ${configPath}\nArchives: ${config.outputDir}\nRun loom archive (default summarizer: codex-server), or use --summarizer dsh.\nBrowse with loom server.`)
    return
  }
  try { config = await loadConfig(configPath) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Missing config: ${configPath}. Run loom init first.`)
    throw error
  }
  config = validateConfig({ ...config,
    workspace: values.workspace ? workspace : config.workspace,
    outputDir: values.output ? resolve(values.output) : config.outputDir,
    providers: values.providers ? values.providers.split(',').map(p => p.trim()) : config.providers,
    intervalSeconds: values.interval ? Number(values.interval) : config.intervalSeconds,
    summary: summaryOverride(config.summary),
  })
  if (command === 'schedule') {
    if (values.output || values.providers || values.interval || (values.workspace && config.workspace !== (await loadConfig(configPath)).workspace))
      throw new Error('Save service options in the config with loom init --force before installing a schedule')
    if (action === 'install') {
      createSummaryModel(config.summary)
      config.summary = await resolveSummaryCommand(config.summary!)
      await saveConfig(configPath, config)
    }
    console.log(await schedule(action || '', config, configPath)); return
  }
  const model = createSummaryModel(config.summary)
  const run = async () => {
    const report = await archiveWorkspace(config, undefined, model)
    console.log(`${new Date().toISOString()} archived=${report.archived} unchanged=${report.unchanged} skipped=${report.skipped} failures=${report.failures.length} warnings=${report.warnings.length}`)
    for (const file of report.files) console.log(file)
    for (const warning of report.warnings) console.error(`Warning: ${warning}`)
    for (const failure of report.failures) console.error(failure)
    return report
  }
  if (command === 'archive') { if ((await run()).failures.length) process.exitCode = 1; return }
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  console.log(`Watching ${config.workspace} every ${config.intervalSeconds}s`)
  try {
    while (!controller.signal.aborted) {
      try { await run() } catch (error) { console.error(error instanceof Error ? error.message : String(error)) }
      if (controller.signal.aborted) break
      await setTimeout(config.intervalSeconds * 1000, undefined, { signal: controller.signal })
    }
  } catch (error) { if (!controller.signal.aborted) throw error }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop) }
}
main().catch(error => { console.error(`loom: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
