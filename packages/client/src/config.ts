/**
 * Loom 本地配置与存储
 * 存储位置: ~/.config/loom/config.json
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { generateKeyPair, serializeKeyPair, deserializeKeyPair } from '@loom/crypto'
import type { KeyPair } from '@loom/crypto'

export interface LoomConfig {
  serverUrl: string
  token?: string
  userId?: string
  username?: string
  staticKey?: {
    privateKey: string
    publicKey: string
  }
  projectBindings: Record<string, ProjectBinding>
  machines: MachineConfig[]
}

export interface ProjectBinding {
  projectId: string
  projectName: string
  organizationId: string
  workspaceId: string
  boundAt: string
}

export interface MachineConfig {
  machineId: string
  machineName: string
  organizationId: string
}

const CONFIG_DIR = join(homedir(), '.config', 'loom')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

function loadConfig(): LoomConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch {
    // ignore
  }
  return {
    serverUrl: 'http://localhost:3000',
    projectBindings: {},
    machines: [],
  }
}

function saveConfig(cfg: LoomConfig): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save config:', err)
  }
}

export function getConfig(): LoomConfig {
  return loadConfig()
}

export function setServerUrl(url: string): void {
  const cfg = loadConfig()
  cfg.serverUrl = url.replace(/\/$/, '')
  saveConfig(cfg)
}

export function setToken(token: string, userId: string, username: string): void {
  const cfg = loadConfig()
  cfg.token = token
  cfg.userId = userId
  cfg.username = username
  saveConfig(cfg)
}

export function clearToken(): void {
  const cfg = loadConfig()
  delete cfg.token
  delete cfg.userId
  delete cfg.username
  saveConfig(cfg)
}

export function getOrCreateStaticKey(): KeyPair {
  const cfg = loadConfig()
  if (cfg.staticKey) {
    return deserializeKeyPair(cfg.staticKey)
  }
  const kp = generateKeyPair()
  cfg.staticKey = serializeKeyPair(kp)
  saveConfig(cfg)
  return kp
}

export function getStaticPublicKeyBase64(): string | undefined {
  const cfg = loadConfig()
  return cfg.staticKey?.publicKey
}

export function bindProject(cwd: string, binding: ProjectBinding): void {
  const cfg = loadConfig()
  cfg.projectBindings[cwd] = binding
  saveConfig(cfg)
}

export function getProjectBinding(cwd: string): ProjectBinding | undefined {
  const cfg = loadConfig()
  return cfg.projectBindings[cwd]
}

export function addMachine(machine: MachineConfig): void {
  const cfg = loadConfig()
  const existing = cfg.machines.findIndex((m: MachineConfig) => m.machineId === machine.machineId)
  if (existing >= 0) {
    cfg.machines[existing] = machine
  } else {
    cfg.machines.push(machine)
  }
  saveConfig(cfg)
}

export function isLoggedIn(): boolean {
  const cfg = loadConfig()
  return !!cfg.token
}
