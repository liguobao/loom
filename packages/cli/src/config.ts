import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { sessions } from 'huihua'
import { validateSummaryConfig, type SummaryConfig } from './model.js'

export interface Config {
  version: 1
  workspace: string
  outputDir: string
  providers: string[]
  intervalSeconds: number
  roots?: Record<string, string[]>
  homeDir?: string
  summary?: SummaryConfig
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const loomHome = () => resolve(process.env.LOOM_HOME || join(homedir(), '.loom'))
export const workspaceId = (workspace: string) => digest(workspace).slice(0, 20)
export const defaultConfigPath = (workspace: string) => join(loomHome(), 'workspaces', workspaceId(workspace), 'config.json')
export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, content, { mode: 0o600 })
  await rename(temp, path)
}
export async function canonicalWorkspace(path: string): Promise<string> {
  const canonical = await realpath(resolve(path))
  if (!(await stat(canonical)).isDirectory()) throw new Error('Workspace must be a directory')
  return canonical
}
export function validateConfig(value: unknown): Config {
  const config = value as Config
  if (!config || config.version !== 1 || typeof config.workspace !== 'string' || typeof config.outputDir !== 'string')
    throw new Error('Config requires version: 1, workspace and outputDir')
  if (!Number.isSafeInteger(config.intervalSeconds) || config.intervalSeconds < 1 || config.intervalSeconds > 86400)
    throw new Error('intervalSeconds must be an integer between 1 and 86400')
  if (!Array.isArray(config.providers) || config.providers.length === 0 || config.providers.some(p => typeof p !== 'string'))
    throw new Error('providers must be a nonempty array of provider IDs')
  for (const provider of config.providers) sessions.require(provider)
  if (config.homeDir !== undefined && typeof config.homeDir !== 'string') throw new Error('homeDir must be a path')
  if (config.roots !== undefined) {
    if (!config.roots || typeof config.roots !== 'object' || Array.isArray(config.roots)) throw new Error('roots must be an object')
    for (const [provider, paths] of Object.entries(config.roots)) {
      sessions.require(provider)
      if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) throw new Error(`Invalid roots for ${provider}`)
    }
  }
  if (config.summary !== undefined) validateSummaryConfig(config.summary)
  return config
}
export async function loadConfig(path: string): Promise<Config> {
  const config = validateConfig(JSON.parse(await readFile(path, 'utf8')))
  const base = dirname(resolve(path))
  return {
    ...config,
    workspace: await canonicalWorkspace(resolve(base, config.workspace)),
    outputDir: resolve(base, config.outputDir),
    homeDir: config.homeDir ? resolve(base, config.homeDir) : undefined,
    roots: config.roots ? Object.fromEntries(Object.entries(config.roots).map(([key, paths]) => [key, paths.map(p => resolve(base, p))])) : undefined,
  }
}
