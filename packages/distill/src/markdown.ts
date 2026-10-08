import matter from 'gray-matter'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface WorkRecordMeta {
  id: string
  workspace: string
  project: string
  organization?: string
  owner?: string
  createdAt: string
  completedAt?: string
  repository?: string
  branch?: string
  baseCommit?: string
  finalCommit?: string
  tags: string[]
  sourceConversationCount: number
}

export interface WorkRecordContent {
  /** Front Matter 元数据 */
  meta: WorkRecordMeta
  /** Markdown 正文各节 */
  goal: string
  requirements: string
  interaction: string
  outcome: string
  investigation: string
  keyDecisions: string
  rejectedApproaches: string
  changedAreas: string
  followUps: string
  /** 原始 markdown 正文（不含 front matter） */
  rawBody: string
}

export interface WorkRecordInput {
  meta: WorkRecordMeta
  title: string
  goal: string
  requirements?: string
  interaction?: string
  outcome: string
  investigation?: string
  keyDecisions?: string
  rejectedApproaches?: string
  changedAreas?: string[]
  followUps?: string
}

// ──────────────────────────────────────────────
// generateMarkdown
// ──────────────────────────────────────────────

/**
 * 从 WorkRecordInput 生成完整 Markdown 字符串（含 YAML Front Matter）。
 *
 * Front Matter 使用 snake_case 字段名以保持 Markdown 可读性；
 * 正文各节按固定顺序排列，空节仍输出标题（保持格式统一）。
 */
export function generateMarkdown(input: WorkRecordInput): string {
  const { meta, title, goal, requirements, interaction, outcome, investigation, keyDecisions, rejectedApproaches, changedAreas, followUps } =
    input

  // 构造 Front Matter 对象（gray-matter 会负责序列化）
  const frontMatter: Record<string, unknown> = {
    id: meta.id,
    workspace: meta.workspace,
    project: meta.project,
    created_at: meta.createdAt,
  }
  if (meta.organization) frontMatter.organization = meta.organization
  if (meta.owner) frontMatter.owner = meta.owner

  if (meta.completedAt) frontMatter.completed_at = meta.completedAt
  if (meta.repository) frontMatter.repository = meta.repository
  if (meta.branch) frontMatter.branch = meta.branch
  if (meta.baseCommit) frontMatter.base_commit = meta.baseCommit
  if (meta.finalCommit) frontMatter.final_commit = meta.finalCommit
  frontMatter.tags = meta.tags ?? []
  frontMatter.source_conversation_count = meta.sourceConversationCount ?? 0

  // 严格过滤所有 undefined 属性，防止 js-yaml dump 报错
  const cleanFrontMatter: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(frontMatter)) {
    if (val !== undefined) {
      cleanFrontMatter[key] = val
    }
  }

  // 格式化 changedAreas 为 bullet list
  const changedAreasText =
    changedAreas && changedAreas.length > 0
      ? changedAreas.map((f) => `- ${f}`).join('\n')
      : ''

  const body = [
    `# ${title}`,
    '',
    '## Goal',
    '',
    goal || '',
    '',
    '## Requirements',
    '',
    requirements || '',
    '',
    '## Interaction Summary',
    '',
    interaction || '',
    '',
    '## Outcome',
    '',
    outcome || '',
    '',
    '## Investigation',
    '',
    investigation || '',
    '',
    '## Key Decisions',
    '',
    keyDecisions || '',
    '',
    '## Rejected Approaches',
    '',
    rejectedApproaches || '',
    '',
    '## Changed Areas',
    '',
    changedAreasText,
    '',
    '## Follow-ups',
    '',
    followUps || '',
    '',
  ].join('\n')

  // 使用 gray-matter stringify 生成带 front matter 的文档
  return matter.stringify(body, cleanFrontMatter)
}


// ──────────────────────────────────────────────
// parseMarkdown
// ──────────────────────────────────────────────

/**
 * 解析 Markdown 文件内容，提取 Front Matter 元数据和各节正文。
 *
 * 各节通过 `## <Section Title>` 定位，支持大小写不敏感匹配。
 * 解析时对缺失字段给出安全默认值，不抛出异常。
 */
export function parseMarkdown(content: string): WorkRecordContent {
  const { data, content: rawBody } = matter(content)

  const meta: WorkRecordMeta = {
    id: String(data.id ?? ''),
    organization: String(data.organization ?? ''),
    workspace: String(data.workspace ?? ''),
    project: String(data.project ?? ''),
    owner: String(data.owner ?? ''),
    createdAt: String(data.created_at ?? ''),
    completedAt: data.completed_at ? String(data.completed_at) : undefined,
    repository: data.repository ? String(data.repository) : undefined,
    branch: data.branch ? String(data.branch) : undefined,
    baseCommit: data.base_commit ? String(data.base_commit) : undefined,
    finalCommit: data.final_commit ? String(data.final_commit) : undefined,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    sourceConversationCount: Number(data.source_conversation_count ?? 0),
  }

  return {
    meta,
    goal: extractSection(rawBody, 'Goal'),
    requirements: extractSection(rawBody, 'Requirements'),
    interaction: extractSection(rawBody, 'Interaction Summary'),
    outcome: extractSection(rawBody, 'Outcome'),
    investigation: extractSection(rawBody, 'Investigation'),
    keyDecisions: extractSection(rawBody, 'Key Decisions'),
    rejectedApproaches: extractSection(rawBody, 'Rejected Approaches'),
    changedAreas: extractSection(rawBody, 'Changed Areas'),
    followUps: extractSection(rawBody, 'Follow-ups'),
    rawBody,
  }
}

/**
 * 从正文中提取指定二级标题下的内容（不含标题行本身）。
 *
 * 终止条件：遇到下一个 `## ` 或文档结束。
 */
function extractSection(body: string, sectionTitle: string): string {
  // 匹配 ## <title>（忽略大小写，忽略 Follow-ups 连字符变体）
  const escapedTitle = sectionTitle.replace(/[-]/g, '[-]')
  const startRe = new RegExp(`^##\\s+${escapedTitle}\\s*$`, 'im')
  const startMatch = startRe.exec(body)
  if (!startMatch) return ''

  const afterStart = body.slice(startMatch.index + startMatch[0].length)
  // 找下一个 ## 节
  const nextSectionRe = /^##\s+/m
  const nextMatch = nextSectionRe.exec(afterStart)
  const sectionBody = nextMatch ? afterStart.slice(0, nextMatch.index) : afterStart

  return sectionBody.trim()
}

// ──────────────────────────────────────────────
// generateRecordPath
// ──────────────────────────────────────────────

/**
 * 根据元数据生成 Work Record 的存储路径。
 *
 * 格式：organizations/<org>/workspaces/<ws>/projects/<proj>/records/<YYYY>/<MM>/<id>.md
 * 年月从 createdAt 中解析；若解析失败则使用当前时间。
 */
export function generateRecordPath(meta: WorkRecordMeta): string {
  let date: Date
  try {
    date = new Date(meta.createdAt)
    if (isNaN(date.getTime())) throw new Error('invalid date')
  } catch {
    date = new Date()
  }

  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')

  return [
    'organizations',
    meta.organization,
    'workspaces',
    meta.workspace,
    'projects',
    meta.project,
    'records',
    String(year),
    month,
    `${meta.id}.md`,
  ].join('/')
}
