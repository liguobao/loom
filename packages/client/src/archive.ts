/**
 * Loom Client Archive - 本地生成并上传 Work Record
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { getConfig } from './config.js'
import { uploadWorkRecord } from './api.js'
import { redactSecrets, generateMarkdown, distillConversation, getGitContext } from '@loom/distill'
import { ulid } from 'ulid'
import type { WorkRecordMeta } from '@loom/distill'
import type { ConversationMessage } from '@loom/distill'

export interface ArchiveOptions {
  projectId: string
  organizationId: string
  workspaceId: string
  title: string
  conversations: ConversationMessage[]
  cwd?: string
  // 手动覆盖 Git 信息
  repository?: string
  branch?: string
  baseCommit?: string
  finalCommit?: string
  tags?: string[]
  sourceConversationCount?: number
}

export interface ArchiveResult {
  recordId: string
  relativePath: string
  localPath: string
  redactedCount: number
  uploaded: boolean
}

/**
 * 执行完整的本地归档流程:
 * 1. 读取 Git context
 * 2. 从 conversation 中 distill work record
 * 3. 生成 Markdown
 * 4. Secret Redaction
 * 5. 保存到本地
 * 6. 上传到 Loom Server
 */
export async function archiveWork(options: ArchiveOptions): Promise<ArchiveResult> {
  const config = getConfig()
  const cwd = options.cwd ?? process.cwd()

  // 1. 获取 Git context
  const gitContext = await getGitContext(cwd)

  // 2. 生成 Work Record ID
  const recordId = ulid()
  const now = new Date().toISOString()

  const meta: WorkRecordMeta = {
    id: recordId,
    organization: options.organizationId,
    workspace: options.workspaceId,
    project: options.projectId,
    owner: config.userId!,
    createdAt: now,
    completedAt: now,
    repository: options.repository ?? gitContext.repository,
    branch: options.branch ?? gitContext.branch,
    baseCommit: options.baseCommit ?? gitContext.baseCommit,
    finalCommit: options.finalCommit ?? gitContext.headCommit,
    tags: options.tags ?? [],
    sourceConversationCount: options.sourceConversationCount ?? 1,
  }

  // 3. Distill conversation
  const { workRecord } = distillConversation({
    conversations: options.conversations,
    meta,
    title: options.title,
    gitContext: {
      repository: gitContext.repository,
      branch: gitContext.branch,
      changedFiles: gitContext.changedFiles,
      commitMessages: gitContext.commitMessages,
    },
  })

  // 4. 生成 Markdown
  const rawMarkdown = generateMarkdown(workRecord)

  // 5. Secret Redaction (在本地执行，不依赖服务端)
  const { content: redactedMarkdown, redactedCount } = redactSecrets(rawMarkdown)

  // 6. 确定路径
  const dateObj = new Date()
  const year = dateObj.getFullYear()
  const month = String(dateObj.getMonth() + 1).padStart(2, '0')
  const relativePath = `organizations/${options.organizationId}/workspaces/${options.workspaceId}/projects/${options.projectId}/records/${year}/${month}/${recordId}.md`

  // 7. 保存本地副本 (可选，默认保存到 ~/.local/share/loom/records)
  const localPath = join(process.env['HOME'] ?? '~', '.local', 'share', 'loom', relativePath)
  await mkdir(dirname(localPath), { recursive: true })
  await writeFile(localPath, redactedMarkdown, 'utf-8')

  // 8. 上传到 Server
  let uploaded = false
  try {
    await uploadWorkRecord({
      projectId: options.projectId,
      organizationId: options.organizationId,
      workspaceId: options.workspaceId,
      title: workRecord.title ?? options.title,
      repository: meta.repository,
      branch: meta.branch,
      baseCommit: meta.baseCommit,
      finalCommit: meta.finalCommit,
      tags: meta.tags,
      changedAreas: workRecord.changedAreas ?? [],
      sourceConversationCount: meta.sourceConversationCount,
      markdownContent: redactedMarkdown,
    })
    uploaded = true
  } catch (err) {
    // 上传失败时不影响本地保存，记录警告
    console.warn('[loom] Failed to upload work record:', err instanceof Error ? err.message : err)
  }

  return {
    recordId,
    relativePath,
    localPath,
    redactedCount,
    uploaded,
  }
}
