import type Database from 'better-sqlite3'
import { ulid } from 'ulid'
import type { Project, ProjectMember, ProjectRepository } from '@loom/protocol'

interface ProjectRow {
  id: string
  workspace_id: string
  organization_id: string
  slug: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

interface ProjectMemberRow {
  project_id: string
  user_id: string
  role: string
  joined_at: string
}

interface ProjectRepoRow {
  id: string
  project_id: string
  repo_url: string
  created_at: string
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToMember(row: ProjectMemberRow): ProjectMember {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role as ProjectMember['role'],
    joinedAt: row.joined_at,
  }
}

function rowToRepo(row: ProjectRepoRow): ProjectRepository {
  return {
    id: row.id,
    projectId: row.project_id,
    repoUrl: row.repo_url,
    createdAt: row.created_at,
  }
}

/**
 * 创建项目，同时将创建者设为 owner
 */
export function createProject(
  db: Database.Database,
  params: {
    workspaceId: string
    organizationId: string
    slug: string
    name: string
    description?: string
    creatorId: string
  },
): Project {
  const now = new Date().toISOString()
  const id = ulid()

  const insertProject = db.prepare(
    `INSERT INTO projects (id, workspace_id, organization_id, slug, name, description, created_at, updated_at)
     VALUES (@id, @workspaceId, @organizationId, @slug, @name, @description, @now, @now)`,
  )
  const insertMember = db.prepare(
    `INSERT OR IGNORE INTO project_members (project_id, user_id, role, joined_at)
     VALUES (@projectId, @userId, 'owner', @now)`,
  )

  const run = db.transaction(() => {
    insertProject.run({
      id,
      workspaceId: params.workspaceId,
      organizationId: params.organizationId,
      slug: params.slug,
      name: params.name,
      description: params.description ?? null,
      now,
    })
    insertMember.run({ projectId: id, userId: params.creatorId, now })
  })
  run()

  return rowToProject({
    id,
    workspace_id: params.workspaceId,
    organization_id: params.organizationId,
    slug: params.slug,
    name: params.name,
    description: params.description ?? null,
    created_at: now,
    updated_at: now,
  })
}

/**
 * 按 ID 查询项目
 */
export function getProjectById(db: Database.Database, id: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  return row ? rowToProject(row) : undefined
}

/**
 * 列出工作空间下所有项目
 */
export function listProjects(db: Database.Database, workspaceId: string): Project[] {
  const rows = db
    .prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at ASC')
    .all(workspaceId) as ProjectRow[]
  return rows.map(rowToProject)
}

/**
 * 添加项目仓库关联
 */
export function addProjectRepository(
  db: Database.Database,
  params: { projectId: string; repoUrl: string },
): ProjectRepository {
  const now = new Date().toISOString()
  const id = ulid()
  db.prepare(
    `INSERT OR IGNORE INTO project_repositories (id, project_id, repo_url, created_at)
     VALUES (@id, @projectId, @repoUrl, @now)`,
  ).run({ id, projectId: params.projectId, repoUrl: params.repoUrl, now })

  return { id, projectId: params.projectId, repoUrl: params.repoUrl, createdAt: now }
}

/**
 * 列出项目下所有仓库
 */
export function listProjectRepositories(db: Database.Database, projectId: string): ProjectRepository[] {
  const rows = db
    .prepare('SELECT * FROM project_repositories WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as ProjectRepoRow[]
  return rows.map(rowToRepo)
}

/**
 * 查询项目单个成员关系
 */
export function getProjectMember(
  db: Database.Database,
  projectId: string,
  userId: string,
): ProjectMember | undefined {
  const row = db
    .prepare('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId) as ProjectMemberRow | undefined
  return row ? rowToMember(row) : undefined
}

/**
 * 添加项目成员
 */
export function addProjectMember(
  db: Database.Database,
  params: { projectId: string; userId: string; role: ProjectMember['role'] },
): ProjectMember {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT OR REPLACE INTO project_members (project_id, user_id, role, joined_at)
     VALUES (@projectId, @userId, @role, @now)`,
  ).run({ projectId: params.projectId, userId: params.userId, role: params.role, now })

  return { projectId: params.projectId, userId: params.userId, role: params.role, joinedAt: now }
}
