import Database from 'better-sqlite3'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { ulid } from 'ulid'

export type { Database }

// 完整建表 DDL
const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  avatar_url  TEXT,
  password_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 组织表
CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 组织成员表
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  joined_at       TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

-- 工作空间表
CREATE TABLE IF NOT EXISTS workspaces (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (organization_id, slug)
);

-- 工作空间成员表
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',
  joined_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

-- 项目表
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (workspace_id, slug)
);

-- 项目成员表
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

-- 项目仓库关联表
CREATE TABLE IF NOT EXISTS project_repositories (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_url   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, repo_url)
);

-- 机器表
CREATE TABLE IF NOT EXISTS machines (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  platform        TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL
);

-- Host 实例表
CREATE TABLE IF NOT EXISTS host_instances (
  id                TEXT PRIMARY KEY,
  machine_id        TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  harness_version   TEXT,
  plugin_version    TEXT,
  status            TEXT NOT NULL DEFAULT 'offline',
  capabilities      TEXT NOT NULL DEFAULT '[]', -- JSON array
  observe_permission TEXT NOT NULL DEFAULT 'presence',
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL
);

-- 当前活跃工作表（只存 metadata，不含 Conversation 内容）
CREATE TABLE IF NOT EXISTS active_works (
  id               TEXT PRIMARY KEY,
  host_instance_id TEXT NOT NULL REFERENCES host_instances(id) ON DELETE CASCADE,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  repository       TEXT,
  branch           TEXT,
  started_at       TEXT NOT NULL,
  last_active_at   TEXT NOT NULL,
  visibility       TEXT NOT NULL DEFAULT 'presence'
);

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Presence 表（复合主键）
CREATE TABLE IF NOT EXISTS presence (
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_instance_id TEXT NOT NULL REFERENCES host_instances(id) ON DELETE CASCADE,
  active_work_id   TEXT,
  project_id       TEXT,
  status           TEXT NOT NULL DEFAULT 'offline',
  last_seen_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, host_instance_id)
);

CREATE INDEX IF NOT EXISTS idx_presence_project_id ON presence(project_id);

-- Work Record 索引表（Control Plane，Markdown 文件才是正文真源）
CREATE TABLE IF NOT EXISTS record_index (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  owner_id        TEXT NOT NULL,
  relative_path   TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  repository      TEXT,
  branch          TEXT,
  final_commit    TEXT,
  tags            TEXT NOT NULL DEFAULT '[]', -- JSON array
  changed_areas   TEXT NOT NULL DEFAULT '[]', -- JSON array
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_record_project_id ON record_index(project_id);
CREATE INDEX IF NOT EXISTS idx_record_org_id ON record_index(organization_id);
CREATE INDEX IF NOT EXISTS idx_record_owner_id ON record_index(owner_id);

-- FTS5 全文搜索虚拟表
CREATE VIRTUAL TABLE IF NOT EXISTS record_fts USING fts5(
  title,
  tags,
  changed_areas,
  content='record_index',
  content_rowid='rowid'
);

-- FTS 触发器：保持 FTS 与 record_index 同步
CREATE TRIGGER IF NOT EXISTS record_fts_insert AFTER INSERT ON record_index BEGIN
  INSERT INTO record_fts(rowid, title, tags, changed_areas)
  VALUES (new.rowid, new.title, new.tags, new.changed_areas);
END;

CREATE TRIGGER IF NOT EXISTS record_fts_update AFTER UPDATE ON record_index BEGIN
  INSERT INTO record_fts(record_fts, rowid, title, tags, changed_areas)
  VALUES ('delete', old.rowid, old.title, old.tags, old.changed_areas);
  INSERT INTO record_fts(rowid, title, tags, changed_areas)
  VALUES (new.rowid, new.title, new.tags, new.changed_areas);
END;

CREATE TRIGGER IF NOT EXISTS record_fts_delete AFTER DELETE ON record_index BEGIN
  INSERT INTO record_fts(record_fts, rowid, title, tags, changed_areas)
  VALUES ('delete', old.rowid, old.title, old.tags, old.changed_areas);
END;
`

/**
 * 初始化数据库，执行建表 SQL，返回 Database 实例
 */
export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  // 执行多条语句需要用 exec
  db.exec(SCHEMA_SQL)
  return db
}

/**
 * 扫描 dataDir 下所有 .md 文件，从 frontmatter 重建 record_index
 * 注意：这是一个简化实现，完整解析 frontmatter 需要依赖具体格式
 */
export function rebuildRecordIndex(db: Database.Database, dataDir: string): void {
  // 清空 FTS（通过删除所有记录触发触发器）
  db.prepare('DELETE FROM record_index').run()

  const insert = db.prepare(`
    INSERT OR REPLACE INTO record_index
      (id, organization_id, workspace_id, project_id, owner_id,
       relative_path, title, tags, changed_areas, created_at, updated_at)
    VALUES
      (@id, @organizationId, @workspaceId, @projectId, @ownerId,
       @relativePath, @title, @tags, @changedAreas, @createdAt, @updatedAt)
  `)

  function scanDir(dir: string) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        scanDir(fullPath)
      } else if (stat.isFile() && extname(entry) === '.md') {
        const relativePath = relative(dataDir, fullPath)
        try {
          const content = readFileSync(fullPath, 'utf-8')
          const meta = parseFrontmatter(content)
          if (meta) {
            insert.run({
              id: meta.id ?? ulid(),
              organizationId: meta.organizationId ?? '',
              workspaceId: meta.workspaceId ?? '',
              projectId: meta.projectId ?? '',
              ownerId: meta.ownerId ?? '',
              relativePath,
              title: meta.title ?? entry.replace('.md', ''),
              tags: JSON.stringify(meta.tags ?? []),
              changedAreas: JSON.stringify(meta.changedAreas ?? []),
              createdAt: meta.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
          }
        } catch {
          // 跳过解析失败的文件
        }
      }
    }
  }

  scanDir(dataDir)
}

/**
 * 简单 YAML frontmatter 解析（--- ... --- 块）
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null

  const yaml = match[1]
  const result: Record<string, unknown> = {}

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const rawValue = line.slice(colonIdx + 1).trim()

    // 简单处理数组（- item 格式不在这里，只处理 [a, b] 格式）
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const items = rawValue
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
      result[key] = items
    } else {
      result[key] = rawValue.replace(/^['"]|['"]$/g, '')
    }
  }

  return result
}
