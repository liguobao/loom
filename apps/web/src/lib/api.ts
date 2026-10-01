// API 请求封装 — 读取 localStorage 中的 loom_token 作为 Bearer token

const BASE = '/api'
const TOKEN_KEY = 'loom_token'

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body.message ?? body.error ?? message
    } catch {
      // ignore parse error
    }
    throw new Error(message)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string
  user: {
    id: string
    username: string
    displayName: string
    email: string
  }
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function register(
  username: string,
  email: string,
  password: string,
  displayName: string,
): Promise<LoginResponse> {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password, displayName }),
  })
}

export function getMe(): Promise<LoginResponse['user']> {
  return request('/auth/me')
}

// ─── Organizations ────────────────────────────────────────────────────────────

import type { Organization, Workspace, Project, RecordIndex, WorkRecord, ActiveWork } from '@loom/protocol'

export function listOrganizations(): Promise<Organization[]> {
  return request('/organizations')
}

// ─── Workspaces ───────────────────────────────────────────────────────────────

export function listWorkspaces(orgId: string): Promise<Workspace[]> {
  return request(`/organizations/${orgId}/workspaces`)
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export function listProjects(workspaceId: string): Promise<Project[]> {
  return request(`/workspaces/${workspaceId}/projects`)
}

export function getProject(projectId: string): Promise<Project> {
  return request(`/projects/${projectId}`)
}

// ─── Work Records ─────────────────────────────────────────────────────────────

export interface ListRecordsOptions {
  limit?: number
  offset?: number
  repository?: string
  branch?: string
  tag?: string
}

export function listProjectRecords(
  projectId: string,
  opts: ListRecordsOptions = {},
): Promise<RecordIndex[]> {
  const params = new URLSearchParams()
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.offset !== undefined) params.set('offset', String(opts.offset))
  if (opts.repository) params.set('repository', opts.repository)
  if (opts.branch) params.set('branch', opts.branch)
  if (opts.tag) params.set('tag', opts.tag)
  const qs = params.toString()
  return request(`/projects/${projectId}/records${qs ? `?${qs}` : ''}`)
}

export function getRecord(recordId: string): Promise<{ meta: RecordIndex; content: string }> {
  return request(`/records/${recordId}`)
}

// ─── Active Work ──────────────────────────────────────────────────────────────

export function listProjectActiveWork(projectId: string): Promise<ActiveWork[]> {
  return request(`/projects/${projectId}/active-work`)
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function searchRecords(query: string, projectId?: string): Promise<RecordIndex[]> {
  const params = new URLSearchParams({ q: query })
  if (projectId) params.set('projectId', projectId)
  return request(`/search?${params.toString()}`)
}

