#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { sessions } from 'huihua'
import { archiveWorkspace } from './archive.js'
import { atomicWrite, canonicalWorkspace, defaultConfigPath, loadConfig, loomHome, validateConfig, type Config } from './config.js'
import { schedule } from './schedule.js'

declare const LOOM_CLI_VERSION: string

const help = `Loom CLI — local workspace conversation archives

Usage:
  loom init [--workspace path] [--providers codex,claude,deepseek]
  loom archive [--workspace path | --config file]
  loom watch [--workspace path | --config file]
  loom schedule install|uninstall|status [--workspace path | --config file]
  loom providers

Options:
  --output path        Archive directory (default: ~/.loom/records)
  --interval seconds   Time between scans (default: 300, range: 1..86400)
  --config file        JSON configuration; init writes to this path
  --force              Replace an existing config with init
  --help, -h           Show help
  --version, -v        Show version

init defaults to all Huihua providers. roots/homeDir can be set in JSON.
Archives are redacted Markdown summaries; original agent stores are read only.
`
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      workspace: { type: 'string' }, output: { type: 'string' }, providers: { type: 'string' },
      interval: { type: 'string' }, config: { type: 'string' }, force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    },
  })
  if (values.version) { console.log(LOOM_CLI_VERSION); return }
  if (values.help || !positionals.length) { console.log(help); return }
  const [command, action] = positionals
  if (!['init', 'archive', 'watch', 'schedule', 'providers'].includes(command)) throw new Error(`Unknown command: ${command}`)
  if (positionals.length > (command === 'schedule' ? 2 : 1)) throw new Error('Unexpected positional arguments')
  if (command === 'providers') { console.log(sessions.providers().map(p => p.id).join('\n')); return }
  const workspace = await canonicalWorkspace(values.workspace || process.cwd())
  const configPath = resolve(values.config || defaultConfigPath(workspace))
  let config: Config
  if (command === 'init') {
    if (!values.force) {
      try { await stat(configPath); throw new Error(`Config exists: ${configPath}. Use --force to replace it.`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    config = validateConfig({ version: 1, workspace, outputDir: resolve(values.output || process.env.LOOM_STORAGE_DIR || join(loomHome(), 'records')),
      providers: values.providers ? values.providers.split(',').map(p => p.trim()) : sessions.providers().map(p => p.id),
      intervalSeconds: Number(values.interval || 300) })
    await atomicWrite(configPath, JSON.stringify(config, null, 2) + '\n')
    console.log(`Created ${configPath}\nRun loom archive, loom watch, or loom schedule install.`)
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
  })
  if (command === 'schedule') {
    if (values.output || values.providers || values.interval || (values.workspace && config.workspace !== (await loadConfig(configPath)).workspace))
      throw new Error('Save service options in the config with loom init --force before installing a schedule')
    console.log(await schedule(action || '', config, configPath)); return
  }
  const run = async () => {
    const report = await archiveWorkspace(config)
    console.log(`${new Date().toISOString()} archived=${report.archived} unchanged=${report.unchanged} skipped=${report.skipped} failures=${report.failures.length}`)
    for (const file of report.files) console.log(file)
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
