/**
 * Loom Client API - 与 Loom Server 通信
 */
import { getConfig } from './config.js'
import type {
  Organization,
  Workspace,
  Project,
  Machine,
  HostInstance,
  ActiveWork,
  WorkRecord,
  RecordIndex,
} from '@loom/protocol'

export class LoomApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'LoomApiError'
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const config = getConfig()
  const url = `${config.serverUrl}/api${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`
  }

  const res = await fetch(url, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let msg = body
    try {
      const json = JSON.parse(body)
      msg = json.message ?? json.error ?? body
    } catch {
      // ignore
    }
    throw new LoomApiError(res.status, msg || res.statusText)
  }

  const contentType = res.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    return res.json() as Promise<T>
  }
  return res.text() as unknown as T
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string
  user: {
    id: string
    username: string
    displayName: string
    email: string
  }
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function register(opts: {
  username: string
  displayName: string
  email: string
  password: string
}): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function getMe(): Promise<LoginResponse['user']> {
  return request('/auth/me')
}

// ── Organizations ─────────────────────────────────────────────────────────────

export async function listOrganizations(): Promise<Organization[]> {
  return request('/organizations')
}

export async function createOrganization(opts: {
  slug: string
  name: string
}): Promise<Organization> {
  return request('/organizations', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

// ── Workspaces ────────────────────────────────────────────────────────────────

export async function listWorkspaces(orgId: string): Promise<Workspace[]> {
  return request(`/organizations/${orgId}/workspaces`)
}

export async function createWorkspace(orgId: string, opts: {
  slug: string
  name: string
  description?: string
}): Promise<Workspace> {
  return request(`/organizations/${orgId}/workspaces`, {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects(workspaceId: string): Promise<Project[]> {
  return request(`/workspaces/${workspaceId}/projects`)
}

export async function createProject(workspaceId: string, opts: {
  slug: string
  name: string
  description?: string
}): Promise<Project> {
  return request(`/workspaces/${workspaceId}/projects`, {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function getProject(projectId: string): Promise<Project> {
  return request(`/projects/${projectId}`)
}

// ── Machines ──────────────────────────────────────────────────────────────────

export async function registerMachine(opts: {
  organizationId: string
  name: string
  platform: string
}): Promise<Machine> {
  return request('/machines', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function registerHostInstance(machineId: string, opts: {
  name: string
  harnessVersion?: string
  pluginVersion?: string
  capabilities?: string[]
  publicKey?: string
}): Promise<HostInstance> {
  return request(`/machines/${machineId}/hosts`, {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

// ── Active Work ───────────────────────────────────────────────────────────────

export async function startActiveWork(opts: {
  hostInstanceId: string
  projectId: string
  title: string
  repository?: string
  branch?: string
  visibility?: 'hidden' | 'presence' | 'observe'
}): Promise<ActiveWork> {
  return request('/active-work', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function updateActiveWork(id: string, opts: {
  title?: string
  lastActiveAt?: string
}): Promise<ActiveWork> {
  return request(`/active-work/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(opts),
  })
}

export async function endActiveWork(id: string): Promise<void> {
  return request(`/active-work/${id}`, { method: 'DELETE' })
}

export async function listProjectActiveWork(projectId: string): Promise<ActiveWork[]> {
  return request(`/projects/${projectId}/active-work`)
}

// ── Work Records ──────────────────────────────────────────────────────────────

export async function uploadWorkRecord(opts: {
  projectId: string
  organizationId: string
  workspaceId: string
  title: string
  repository?: string
  branch?: string
  baseCommit?: string
  finalCommit?: string
  tags?: string[]
  changedAreas?: string[]
  sourceConversationCount?: number
  markdownContent: string
}): Promise<RecordIndex> {
  return request('/records', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function listProjectRecords(
  projectId: string,
  opts?: { limit?: number; offset?: number },
): Promise<RecordIndex[]> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.offset) params.set('offset', String(opts.offset))
  return request(`/projects/${projectId}/records?${params}`)
}

export async function getWorkRecord(recordId: string): Promise<{ meta: RecordIndex; content: string }> {
  return request(`/records/${recordId}`)
}

export async function searchRecords(opts: {
  query: string
  projectId?: string
  organizationId?: string
}): Promise<RecordIndex[]> {
  const params = new URLSearchParams({ q: opts.query })
  if (opts.projectId) params.set('projectId', opts.projectId)
  if (opts.organizationId) params.set('organizationId', opts.organizationId)
  return request(`/search?${params}`)
}
