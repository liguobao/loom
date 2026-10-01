import type Database from 'better-sqlite3'
import { ulid } from 'ulid'
import type { Machine, HostInstance } from '@loom/protocol'

interface MachineRow {
  id: string
  owner_id: string
  organization_id: string
  name: string
  platform: string
  created_at: string
  last_seen_at: string
}

interface HostInstanceRow {
  id: string
  machine_id: string
  owner_id: string
  organization_id: string
  name: string
  harness_version: string | null
  plugin_version: string | null
  status: string
  capabilities: string // JSON
  observe_permission: string
  created_at: string
  last_seen_at: string
}

function rowToMachine(row: MachineRow): Machine {
  return {
    id: row.id,
    ownerId: row.owner_id,
    organizationId: row.organization_id,
    name: row.name,
    platform: row.platform,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

function rowToHostInstance(row: HostInstanceRow): HostInstance {
  return {
    id: row.id,
    machineId: row.machine_id,
    ownerId: row.owner_id,
    organizationId: row.organization_id,
    name: row.name,
    harnessVersion: row.harness_version ?? undefined,
    pluginVersion: row.plugin_version ?? undefined,
    status: row.status as HostInstance['status'],
    capabilities: JSON.parse(row.capabilities) as string[],
    observePermission: row.observe_permission as HostInstance['observePermission'],
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

/**
 * 注册机器
 */
export function registerMachine(
  db: Database.Database,
  params: { ownerId: string; organizationId: string; name: string; platform: string },
): Machine {
  const now = new Date().toISOString()
  const id = ulid()
  db.prepare(
    `INSERT INTO machines (id, owner_id, organization_id, name, platform, created_at, last_seen_at)
     VALUES (@id, @ownerId, @organizationId, @name, @platform, @now, @now)`,
  ).run({ id, ownerId: params.ownerId, organizationId: params.organizationId, name: params.name, platform: params.platform, now })

  return rowToMachine({
    id,
    owner_id: params.ownerId,
    organization_id: params.organizationId,
    name: params.name,
    platform: params.platform,
    created_at: now,
    last_seen_at: now,
  })
}

/**
 * 按 ID 查询机器
 */
export function getMachineById(db: Database.Database, id: string): Machine | undefined {
  const row = db.prepare('SELECT * FROM machines WHERE id = ?').get(id) as MachineRow | undefined
  return row ? rowToMachine(row) : undefined
}

/**
 * 列出用户的所有机器
 */
export function listUserMachines(db: Database.Database, userId: string): Machine[] {
  const rows = db
    .prepare('SELECT * FROM machines WHERE owner_id = ? ORDER BY created_at ASC')
    .all(userId) as MachineRow[]
  return rows.map(rowToMachine)
}

/**
 * 更新机器的 last_seen_at
 */
export function touchMachine(db: Database.Database, id: string): void {
  db.prepare('UPDATE machines SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id)
}

/**
 * 注册 HostInstance
 */
export function registerHostInstance(
  db: Database.Database,
  params: {
    machineId: string
    ownerId: string
    organizationId: string
    name: string
    harnessVersion?: string
    pluginVersion?: string
    capabilities: string[]
    observePermission?: HostInstance['observePermission']
  },
): HostInstance {
  const now = new Date().toISOString()
  const id = ulid()
  const observePermission = params.observePermission ?? 'presence'

  db.prepare(
    `INSERT INTO host_instances
       (id, machine_id, owner_id, organization_id, name, harness_version, plugin_version,
        status, capabilities, observe_permission, created_at, last_seen_at)
     VALUES
       (@id, @machineId, @ownerId, @organizationId, @name, @harnessVersion, @pluginVersion,
        'offline', @capabilities, @observePermission, @now, @now)`,
  ).run({
    id,
    machineId: params.machineId,
    ownerId: params.ownerId,
    organizationId: params.organizationId,
    name: params.name,
    harnessVersion: params.harnessVersion ?? null,
    pluginVersion: params.pluginVersion ?? null,
    capabilities: JSON.stringify(params.capabilities),
    observePermission,
    now,
  })

  return rowToHostInstance({
    id,
    machine_id: params.machineId,
    owner_id: params.ownerId,
    organization_id: params.organizationId,
    name: params.name,
    harness_version: params.harnessVersion ?? null,
    plugin_version: params.pluginVersion ?? null,
    status: 'offline',
    capabilities: JSON.stringify(params.capabilities),
    observe_permission: observePermission,
    created_at: now,
    last_seen_at: now,
  })
}

/**
 * 按 ID 查询 HostInstance
 */
export function getHostInstanceById(db: Database.Database, id: string): HostInstance | undefined {
  const row = db.prepare('SELECT * FROM host_instances WHERE id = ?').get(id) as HostInstanceRow | undefined
  return row ? rowToHostInstance(row) : undefined
}

/**
 * 列出机器的所有 HostInstance
 */
export function listMachineHostInstances(db: Database.Database, machineId: string): HostInstance[] {
  const rows = db
    .prepare('SELECT * FROM host_instances WHERE machine_id = ? ORDER BY created_at ASC')
    .all(machineId) as HostInstanceRow[]
  return rows.map(rowToHostInstance)
}

/**
 * 更新 HostInstance 在线状态
 */
export function updateHostInstanceStatus(
  db: Database.Database,
  id: string,
  status: 'online' | 'offline',
): void {
  db.prepare('UPDATE host_instances SET status = ?, last_seen_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    id,
  )
}

/**
 * 更新 HostInstance 的观看权限
 */
export function updateHostInstanceObservePermission(
  db: Database.Database,
  id: string,
  permission: 'hidden' | 'presence' | 'observe',
): void {
  db.prepare('UPDATE host_instances SET observe_permission = ? WHERE id = ?').run(permission, id)
}

/**
 * 更新 HostInstance 的 last_seen_at
 */
export function touchHostInstance(db: Database.Database, id: string): void {
  db.prepare('UPDATE host_instances SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id)
}
