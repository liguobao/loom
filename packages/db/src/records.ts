import type Database from 'better-sqlite3'
import { ulid } from 'ulid'
import type { RecordIndex } from '@loom/protocol'

interface RecordIndexRow {
  id: string
  organization_id: string
  workspace_id: string
  project_id: string
  owner_id: string
  relative_path: string
  title: string
  repository: string | null
  branch: string | null
  final_commit: string | null
  tags: string
  changed_areas: string
  created_at: string
  updated_at: string
}

function rowToRecord(row: RecordIndexRow): RecordIndex {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    relativePath: row.relative_path,
    title: row.title,
    repository: row.repository ?? undefined,
    branch: row.branch ?? undefined,
    finalCommit: row.final_commit ?? undefined,
    tags: row.tags,
    changedAreas: row.changed_areas,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 创建 Record 索引条目
 */
export function createRecordIndex(
  db: Database.Database,
  record: Omit<RecordIndex, 'updatedAt'>,
): RecordIndex {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT OR REPLACE INTO record_index
       (id, organization_id, workspace_id, project_id, owner_id, relative_path,
        title, repository, branch, final_commit, tags, changed_areas, created_at, updated_at)
     VALUES
       (@id, @organizationId, @workspaceId, @projectId, @ownerId, @relativePath,
        @title, @repository, @branch, @finalCommit, @tags, @changedAreas, @createdAt, @updatedAt)`,
  ).run({
    id: record.id,
    organizationId: record.organizationId,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    ownerId: record.ownerId,
    relativePath: record.relativePath,
    title: record.title,
    repository: record.repository ?? null,
    branch: record.branch ?? null,
    finalCommit: record.finalCommit ?? null,
    tags: record.tags,
    changedAreas: record.changedAreas,
    createdAt: record.createdAt,
    updatedAt: now,
  })

  return { ...record, updatedAt: now }
}

/**
 * 按 ID 查询 Record
 */
export function getRecordById(db: Database.Database, id: string): RecordIndex | undefined {
  const row = db.prepare('SELECT * FROM record_index WHERE id = ?').get(id) as RecordIndexRow | undefined
  return row ? rowToRecord(row) : undefined
}

/**
 * 列出项目下的所有 Record（支持分页）
 */
export function listProjectRecords(
  db: Database.Database,
  projectId: string,
  limit = 20,
  offset = 0,
): RecordIndex[] {
  const rows = db
    .prepare(
      'SELECT * FROM record_index WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    .all(projectId, limit, offset) as RecordIndexRow[]
  return rows.map(rowToRecord)
}

/**
 * 全文搜索 Records（使用 FTS5）
 * 支持按 projectId 或 organizationId 过滤
 */
export function searchRecords(
  db: Database.Database,
  query: string,
  projectId?: string,
  organizationId?: string,
): RecordIndex[] {
  // FTS5 match 语法
  let sql = `
    SELECT r.* FROM record_index r
    JOIN record_fts ON record_fts.rowid = r.rowid
    WHERE record_fts MATCH ?
  `
  const params: unknown[] = [query]

  if (projectId) {
    sql += ' AND r.project_id = ?'
    params.push(projectId)
  } else if (organizationId) {
    sql += ' AND r.organization_id = ?'
    params.push(organizationId)
  }

  sql += ' ORDER BY rank LIMIT 50'

  const rows = db.prepare(sql).all(...params) as RecordIndexRow[]
  return rows.map(rowToRecord)
}

/**
 * 删除 Record 索引
 */
export function deleteRecordIndex(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM record_index WHERE id = ?').run(id)
}

/**
 * 按路径查询 Record
 */
export function getRecordByPath(db: Database.Database, relativePath: string): RecordIndex | undefined {
  const row = db
    .prepare('SELECT * FROM record_index WHERE relative_path = ?')
    .get(relativePath) as RecordIndexRow | undefined
  return row ? rowToRecord(row) : undefined
}

/**
 * 列出组织下所有 Record（支持分页）
 */
export function listOrganizationRecords(
  db: Database.Database,
  organizationId: string,
  limit = 20,
  offset = 0,
): RecordIndex[] {
  const rows = db
    .prepare(
      'SELECT * FROM record_index WHERE organization_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    .all(organizationId, limit, offset) as RecordIndexRow[]
  return rows.map(rowToRecord)
}
