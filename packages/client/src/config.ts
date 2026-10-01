/**
 * Loom Client 本地配置管理
 * 存储位置: ~/.config/loom/config.json (通过 conf 包)
 */
import Conf from 'conf'
import { generateKeyPair, serializeKeyPair, deserializeKeyPair } from '@loom/crypto'
import type { KeyPair } from '@loom/crypto'

export interface LoomConfig {
  serverUrl: string
  token?: string
  userId?: string
  username?: string
  // 本地 Noise 静态密钥对 (用于 E2EE)
  staticKey?: {
    privateKey: string
    publicKey: string
  }
  // 当前绑定的项目 (按目录)
  projectBindings: Record<string, ProjectBinding>
  // 注册的 machines
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

const conf = new Conf<LoomConfig>({
  projectName: 'loom',
  defaults: {
    serverUrl: 'http://localhost:3000',
    projectBindings: {},
    machines: [],
  },
})

export function getConfig(): LoomConfig {
  return conf.store
}

export function setServerUrl(url: string): void {
  conf.set('serverUrl', url.replace(/\/$/, ''))
}

export function setToken(token: string, userId: string, username: string): void {
  conf.set('token', token)
  conf.set('userId', userId)
  conf.set('username', username)
}

export function clearToken(): void {
  conf.delete('token')
  conf.delete('userId')
  conf.delete('username')
}

export function getOrCreateStaticKey(): KeyPair {
  const stored = conf.get('staticKey')
  if (stored) {
    return deserializeKeyPair(stored)
  }
  const kp = generateKeyPair()
  const serialized = serializeKeyPair(kp)
  conf.set('staticKey', serialized)
  return kp
}

export function getStaticPublicKeyBase64(): string | undefined {
  const stored = conf.get('staticKey')
  if (!stored) return undefined
  return stored.publicKey
}

export function bindProject(cwd: string, binding: ProjectBinding): void {
  const bindings = conf.get('projectBindings') ?? {}
  bindings[cwd] = binding
  conf.set('projectBindings', bindings)
}

export function getProjectBinding(cwd: string): ProjectBinding | undefined {
  const bindings = conf.get('projectBindings') ?? {}
  return bindings[cwd]
}

export function addMachine(machine: MachineConfig): void {
  const machines = conf.get('machines') ?? []
  const existing = machines.findIndex(m => m.machineId === machine.machineId)
  if (existing >= 0) {
    machines[existing] = machine
  } else {
    machines.push(machine)
  }
  conf.set('machines', machines)
}

export function isLoggedIn(): boolean {
  return !!conf.get('token')
}
