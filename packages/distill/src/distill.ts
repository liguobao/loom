import type { WorkRecordInput, WorkRecordMeta } from './markdown.js'

// ──────────────────────────────────────────────
// Types (re-exported for consumers)
// ──────────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  timestamp?: string
}

export interface GitContext {
  repository?: string
  branch?: string
  baseCommit?: string
  finalCommit?: string
  changedFiles?: string[]
  commitMessages?: string[]
}

export interface DistillInput {
  conversations: ConversationMessage[]
  meta: WorkRecordMeta
  title?: string
  gitContext?: GitContext
}

export interface DistillResult {
  workRecord: WorkRecordInput
  warnings: string[]
}

// ──────────────────────────────────────────────
// 噪声判断
// ──────────────────────────────────────────────

/**
 * 判断一条消息是否是噪声（工具调用、文件读取、纯终端输出等）。
 *
 * 噪声消息不应进入 Work Record 的摘要。
 */
export function isNoiseMessage(message: ConversationMessage): boolean {
  // tool 角色的消息本身就是工具输出，直接视为噪声
  if (message.role === 'tool') return true

  // assistant 消息：如果包含工具调用且正文非常短（几乎是纯调用），视为噪声
  if (message.role === 'assistant') {
    const content = message.content.trim()
    // 非常短的 assistant 消息（<20 字）大概率是占位
    if (content.length < 20) return true
    return false
  }

  // user 消息：通常不视为噪声，但极短的确认消息（"ok", "好的"等）视为噪声
  if (message.role === 'user') {
    const content = message.content.trim()
    if (content.length < 5) return true
    const ackPatterns = /^(ok|好的|明白|continue|继续|yes|no|是|否|嗯|哦)\.?$/i
    if (ackPatterns.test(content)) return true
  }

  return false
}

// ──────────────────────────────────────────────
// 从 conversation 提取各节内容
// ──────────────────────────────────────────────

/**
 * 从 messages 中提取工具调用涉及的文件修改列表。
 *
 * 扫描 tool 消息的 toolName 和 content，识别常见的文件写/改操作。
 */
export function extractChangedAreas(messages: ConversationMessage[]): string[] {
  const files = new Set<string>()

  // 识别文件路径的简单正则
  const filePathRe = /([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,10})/g

  for (const msg of messages) {
    if (msg.role !== 'tool') continue
    const toolName = msg.toolName?.toLowerCase() ?? ''
    // 只关注写/改/删工具
    const isWriteTool =
      toolName.includes('write') ||
      toolName.includes('edit') ||
      toolName.includes('create') ||
      toolName.includes('replace') ||
      toolName.includes('delete') ||
      toolName.includes('patch')
    if (!isWriteTool) continue

    let m: RegExpExecArray | null
    filePathRe.lastIndex = 0
    while ((m = filePathRe.exec(msg.content)) !== null) {
      const p = m[1]
      // 排除太短或像版本号的字符串
      if (p.length > 4 && !p.match(/^\d+\.\d+/)) {
        files.add(p)
      }
    }
  }

  return Array.from(files)
}

/**
 * 从 messages 中提取关键决策段落。
 *
 * 扫描 user + assistant 消息，找含有决策关键词的句子/段落。
 */
export function extractKeyDecisions(messages: ConversationMessage[]): string {
  const decisionKeywords = [
    '因为', '决定', '选择', '采用', '放弃', '改用',
    'because', 'decided', 'chose', 'adopted', 'dropped',
    'we decided', '决策', 'trade-off', 'tradeoff',
  ]

  const decisionLines: string[] = []

  for (const msg of messages) {
    if (msg.role === 'tool') continue
    const lines = msg.content.split(/\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length < 10) continue
      const lower = trimmed.toLowerCase()
      if (decisionKeywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        // 避免重复
        if (!decisionLines.includes(trimmed)) {
          decisionLines.push(trimmed)
        }
      }
    }
  }

  if (decisionLines.length === 0) return ''
  // 以 bullet list 输出
  return decisionLines.map((l) => `- ${l}`).join('\n')
}

// ──────────────────────────────────────────────
// distillConversation
// ──────────────────────────────────────────────

/**
 * 从 conversation 中提取高价值工程记录，生成结构化 WorkRecordInput。
 *
 * 处理步骤：
 * 1. 过滤噪声消息
 * 2. 提取 user 首条主要 prompt 作为 Goal
 * 3. 取 assistant 最后一条主要回复作为 Outcome
 * 4. 从中间对话拼接 Investigation
 * 5. 提取 Key Decisions
 * 6. 从 git context + tool calls 提取 Changed Areas
 * 7. 提取 Follow-ups
 */
export function distillConversation(input: DistillInput): DistillResult {
  const { conversations, meta, title, gitContext } = input
  const warnings: string[] = []

  // ── 1. 过滤噪声 ──
  const meaningful = conversations.filter((m) => !isNoiseMessage(m))

  if (meaningful.length === 0) {
    warnings.push('所有消息均被识别为噪声，Work Record 内容将为空')
  }

  // ── 2. Goal：user 的第一条有意义的长消息 ──
  const userMessages = meaningful.filter((m) => m.role === 'user')
  const firstUserMsg = userMessages[0]
  const goal = firstUserMsg
    ? truncateSmart(firstUserMsg.content, 800)
    : ''

  if (!goal) warnings.push('未找到有效的 user 消息，Goal 为空')

  // ── 3. Outcome：assistant 最后一条主要回复 ──
  const assistantMessages = meaningful.filter((m) => m.role === 'assistant')
  const lastAssistantMsg = assistantMessages[assistantMessages.length - 1]
  const outcome = lastAssistantMsg
    ? truncateSmart(lastAssistantMsg.content, 1200)
    : ''

  if (!outcome) warnings.push('未找到有效的 assistant 消息，Outcome 为空')

  // ── 4. Investigation：中间对话摘要 ──
  // 排除第一条 user 消息和最后一条 assistant 消息，取中间部分
  const middleMessages = meaningful.slice(
    firstUserMsg ? 1 : 0,
    lastAssistantMsg ? meaningful.length - 1 : meaningful.length,
  )
  const investigation = buildInvestigation(middleMessages)

  // ── 5. Key Decisions ──
  const keyDecisions = extractKeyDecisions(conversations) // 用全量消息，覆盖更广

  // ── 6. Changed Areas ──
  // 优先从 git context 取，其次从 tool calls 提取
  let changedAreas: string[] = []
  if (gitContext?.changedFiles && gitContext.changedFiles.length > 0) {
    changedAreas = gitContext.changedFiles
  } else {
    changedAreas = extractChangedAreas(conversations)
  }

  // ── 7. Follow-ups ──
  const followUps = extractFollowUps(conversations)

  // ── 8. Rejected Approaches ──
  const rejectedApproaches = extractRejectedApproaches(conversations)

  // ── 9. 合并 git context 到 meta ──
  const enrichedMeta: WorkRecordMeta = {
    ...meta,
    repository: gitContext?.repository ?? meta.repository,
    branch: gitContext?.branch ?? meta.branch,
    baseCommit: gitContext?.baseCommit ?? meta.baseCommit,
    finalCommit: gitContext?.finalCommit ?? meta.finalCommit,
  }

  const workRecord: WorkRecordInput = {
    meta: enrichedMeta,
    title: title ?? deriveTitle(goal),
    goal,
    outcome,
    investigation: investigation || undefined,
    keyDecisions: keyDecisions || undefined,
    rejectedApproaches: rejectedApproaches || undefined,
    changedAreas: changedAreas.length > 0 ? changedAreas : undefined,
    followUps: followUps || undefined,
  }

  return { workRecord, warnings }
}

// ──────────────────────────────────────────────
// 内部辅助函数
// ──────────────────────────────────────────────

/**
 * 从中间消息构建 Investigation 段落。
 * 取 assistant 消息中有实质内容的段落（每条限 300 字），合并为一段。
 */
function buildInvestigation(messages: ConversationMessage[]): string {
  const parts: string[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const trimmed = msg.content.trim()
    if (trimmed.length < 30) continue
    parts.push(truncateSmart(trimmed, 300))
  }
  return parts.join('\n\n')
}

/**
 * 提取 Follow-ups（TODO、后续、follow-up 等关键词所在句子）。
 */
function extractFollowUps(messages: ConversationMessage[]): string {
  const followUpKeywords = [
    'TODO', 'FIXME', '后续', 'follow-up', 'follow up',
    '未来', '下一步', 'next step', '待办', '待处理',
    'should be done', '需要', 'TBD',
  ]
  const items: string[] = []

  for (const msg of messages) {
    if (msg.role === 'tool') continue
    const lines = msg.content.split(/\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length < 5) continue
      const lower = trimmed.toLowerCase()
      if (followUpKeywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        if (!items.includes(trimmed)) items.push(trimmed)
      }
    }
  }

  return items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : ''
}

/**
 * 提取被拒绝的方案（"放弃", "不用", "rejected", "instead" 等关键词）。
 */
function extractRejectedApproaches(messages: ConversationMessage[]): string {
  const rejectedKeywords = [
    '放弃', '不用', '不采用', '改用', '替换',
    'rejected', 'instead', 'abandoned', 'not use',
    '没有采用', '考虑过但',
  ]
  const items: string[] = []

  for (const msg of messages) {
    if (msg.role === 'tool') continue
    const lines = msg.content.split(/\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length < 10) continue
      const lower = trimmed.toLowerCase()
      if (rejectedKeywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        if (!items.includes(trimmed)) items.push(trimmed)
      }
    }
  }

  return items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : ''
}

/**
 * 将长文本截断到指定字符数，在句子边界截断（尽量不截断单词）。
 */
function truncateSmart(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  // 尝试在最后一个句号/换行处截断
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('。'), cut.lastIndexOf('. '))
  if (lastBreak > maxLen * 0.7) {
    return cut.slice(0, lastBreak + 1).trimEnd() + '\n\n…（内容已截断）'
  }
  return cut.trimEnd() + '\n\n…（内容已截断）'
}

/**
 * 从 Goal 文本派生标题（取第一行或前 60 字）。
 */
function deriveTitle(goal: string): string {
  const firstLine = goal.split('\n')[0].trim()
  if (firstLine.length <= 60) return firstLine
  return firstLine.slice(0, 60).trimEnd() + '…'
}
