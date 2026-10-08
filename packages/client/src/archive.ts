/**
 * Loom Local Archive - 本地总结、脱敏并存储 Work Record
 * 纯本地运行，不依赖 Server 端
 * 存储格式: <userDir>/<workspace>/<project>/<timestamp-id>.md
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname, basename, resolve } from 'node:path'
import { homedir } from 'node:os'
import { redactSecrets, generateMarkdown, summarizeConversation, createSummaryModel, extractChangedAreas, getGitContext } from '@loom/distill'
import { ulid } from 'ulid'
import type { WorkRecordMeta, ConversationMessage, SummaryConfig, SummaryModel } from '@loom/distill'

export interface ArchiveOptions {
  conversations: ConversationMessage[]
  title?: string
  workspace?: string
  project?: string
  cwd?: string
  outputDir?: string
  summary?: SummaryConfig
  summaryModel?: SummaryModel
  // 可选 Git 信息覆盖
  repository?: string
  branch?: string
  baseCommit?: string
  finalCommit?: string
  tags?: string[]
  sourceConversationCount?: number
}

export interface ArchiveResult {
  recordId: string
  workspace: string
  project: string
  relativePath: string
  localPath: string
  title: string
  redactedCount: number
}

/**
 * 推导 workspace 与 project 名称
 */
export function resolveWorkspaceAndProject(
  cwd: string = process.cwd(),
  explicit?: { workspace?: string; project?: string },
): { workspace: string; project: string } {
  if (explicit?.workspace && explicit?.project) {
    return { workspace: explicit.workspace, project: explicit.project }
  }

  const normalizedCwd = resolve(cwd)
  const currentDir = basename(normalizedCwd)
  const parentDir = basename(dirname(normalizedCwd))

  // 避免将根目录或系统目录识别为 workspace
  const isSystemParent = !parentDir || parentDir === '/' || parentDir === '.' || parentDir === 'home' || parentDir === 'root'

  const project = explicit?.project || currentDir || 'default-project'
  const workspace = explicit?.workspace || (isSystemParent ? 'default' : parentDir)

  return { workspace, project }
}

/**
 * 格式化时间戳为文件名友好的字符串: YYYY-MM-DD-HHmmss
 */
function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const ss = pad(date.getSeconds())
  return `${y}-${m}-${d}-${hh}${mm}${ss}`
}

/**
 * 获取本地归档基础存储目录 (默认: ~/.loom/records)
 */
export function getDefaultStorageDir(): string {
  const custom = process.env['LOOM_STORAGE_DIR'] || process.env['LOOM_OUTPUT_DIR']
  if (custom) return custom
  return join(homedir(), '.loom', 'records')
}

/**
 * 执行本地对话总结与归档:
 * 1. 提取/推导 workspace 和 project
 * 2. 读取当前目录 Git context
 * 3. 使用共享语义总结器归纳全轮次对话与工具证据
 * 4. 生成标准 Markdown (带 Front Matter)
 * 5. 执行敏感信息正则脱敏 (redactSecrets)
 * 6. 保存到用户文件夹下: <outputDir>/<workspace>/<project>/<timestamp-id>.md
 */
export async function archiveWork(options: ArchiveOptions): Promise<ArchiveResult> {
  const cwd = options.cwd ?? process.cwd()
  const { workspace, project } = resolveWorkspaceAndProject(cwd, {
    workspace: options.workspace,
    project: options.project,
  })

  // 1. 获取 Git context
  const gitContext = await getGitContext(cwd)

  // 2. 生成唯一记录 ID
  const recordId = ulid()
  const now = new Date()
  const nowIso = now.toISOString()

  const meta: WorkRecordMeta = {
    id: recordId,
    workspace,
    project,
    createdAt: nowIso,
    repository: options.repository ?? gitContext.repository,
    branch: options.branch ?? gitContext.branch,
    baseCommit: options.baseCommit ?? gitContext.baseCommit,
    finalCommit: options.finalCommit ?? gitContext.finalCommit,
    tags: options.tags ?? [],
    sourceConversationCount: options.sourceConversationCount ?? 1,
  }

  // 3. 提炼并总结对话
  const model = options.summaryModel ?? createSummaryModel(options.summary ?? { provider: 'dsh' })
  const summary = await summarizeConversation(options.conversations, model, options.summary?.maxInputChars)
  const workRecord = {
    ...summary,
    meta,
    title: options.title ?? summary.title,
    changedAreas: [...new Set(extractChangedAreas(options.conversations))],
  }

  // 4. 生成规范 Markdown
  const rawMarkdown = generateMarkdown(workRecord)

  // 5. 敏感信息脱敏
  const { content: redactedMarkdown, redactedCount: outputRedactedCount } = redactSecrets(rawMarkdown)
  const redactedCount = outputRedactedCount + options.conversations.reduce((count, message) => count + redactSecrets(message.content).redactedCount, 0)

  // 6. 确定存储路径: <workspace>/<project>/<timestamp-shortId>.md
  const timeStr = formatTimestamp(now)
  const shortId = recordId.slice(-6).toLowerCase()
  const filename = `${timeStr}-${shortId}.md`
  const relativePath = `${workspace}/${project}/${filename}`

  const baseDir = options.outputDir ?? getDefaultStorageDir()
  const localPath = join(baseDir, relativePath)

  // 7. 写入本地文件
  await mkdir(dirname(localPath), { recursive: true })
  await writeFile(localPath, redactedMarkdown, 'utf-8')

  return {
    recordId,
    workspace,
    project,
    relativePath,
    localPath,
    title: workRecord.title || options.title || 'Untitled Work',
    redactedCount,
  }
}
