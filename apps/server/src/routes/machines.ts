/**
 * Machine 和 HostInstance 路由
 */
import { Hono } from 'hono'
import {
  registerMachine,
  getMachineById,
  listUserMachines,
  touchMachine,
  registerHostInstance,
  getHostInstanceById,
  listMachineHostInstances,
  updateHostInstanceStatus,
  updateHostInstanceObservePermission,
} from '@loom/db'
import type { Database } from 'better-sqlite3'
import { platform } from 'node:os'

export function machineRoutes(db: Database): Hono {
  const app = new Hono()

  // GET /api/machines — 列出我的 machines
  app.get('/', (c) => {
    const userId = c.get('userId')
    const machines = listUserMachines(db, userId)
    return c.json(machines)
  })

  // POST /api/machines — 注册 machine
  app.post('/', async (c) => {
    const userId = c.get('userId')
    const { organizationId, name, platform: plt } = await c.req.json()
    if (!organizationId || !name) {
      return c.json({ error: 'organizationId and name required' }, 400)
    }
    const machine = registerMachine(db, {
      ownerId: userId,
      organizationId,
      name,
      platform: plt ?? 'unknown',
    })
    return c.json(machine, 201)
  })

  // GET /api/machines/:id
  app.get('/:id', (c) => {
    const userId = c.get('userId')
    const machine = getMachineById(db, c.req.param('id'))
    if (!machine) return c.json({ error: 'Not found' }, 404)
    if (machine.ownerId !== userId) return c.json({ error: 'Forbidden' }, 403)
    return c.json(machine)
  })

  // GET /api/machines/:id/hosts — 列出 machine 的 host instances
  app.get('/:id/hosts', (c) => {
    const userId = c.get('userId')
    const machine = getMachineById(db, c.req.param('id'))
    if (!machine) return c.json({ error: 'Not found' }, 404)
    if (machine.ownerId !== userId) return c.json({ error: 'Forbidden' }, 403)
    const hosts = listMachineHostInstances(db, machine.id)
    return c.json(hosts)
  })

  // POST /api/machines/:id/hosts — 注册 host instance
  app.post('/:id/hosts', async (c) => {
    const userId = c.get('userId')
    const machineId = c.req.param('id')
    const machine = getMachineById(db, machineId)
    if (!machine) return c.json({ error: 'Machine not found' }, 404)
    if (machine.ownerId !== userId) return c.json({ error: 'Forbidden' }, 403)

    const { name, harnessVersion, pluginVersion, capabilities, publicKey } = await c.req.json()
    if (!name) return c.json({ error: 'name required' }, 400)

    const host = registerHostInstance(db, {
      machineId,
      ownerId: userId,
      organizationId: machine.organizationId,
      name,
      harnessVersion,
      pluginVersion,
      capabilities: capabilities ?? ['observe', 'presence'],
      publicKey,
    })
    return c.json(host, 201)
  })

  // PATCH /api/machines/:machineId/hosts/:hostId — 更新 host instance
  app.patch('/:machineId/hosts/:hostId', async (c) => {
    const userId = c.get('userId')
    const host = getHostInstanceById(db, c.req.param('hostId'))
    if (!host) return c.json({ error: 'Not found' }, 404)
    if (host.ownerId !== userId) return c.json({ error: 'Forbidden' }, 403)

    const { status, observePermission } = await c.req.json()
    if (status) updateHostInstanceStatus(db, host.id, status)
    if (observePermission) updateHostInstanceObservePermission(db, host.id, observePermission)

    return c.json(getHostInstanceById(db, host.id))
  })

  return app
}
