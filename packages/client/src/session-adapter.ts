/**
 * DSH 会话消息转 Loom ConversationMessage 适配器
 */
import type { ConversationMessage } from '@loom/distill'

export function extractConversationFromSession(session: unknown): ConversationMessage[] {
  if (!session || typeof session !== 'object') return []

  const s = session as Record<string, unknown>
  let rawMessages: unknown[] = []

  try {
    if (typeof s['deriveMessages'] === 'function') {
      rawMessages = (s['deriveMessages'] as () => unknown[])()
    } else if (Array.isArray(s['messages'])) {
      rawMessages = s['messages']
    }
  } catch {
    if (Array.isArray(s['messages'])) {
      rawMessages = s['messages']
    }
  }

  const result: ConversationMessage[] = []

  for (const msg of rawMessages) {
    if (!msg || typeof msg !== 'object') continue
    const m = msg as Record<string, unknown>
    const source = m['source'] as Record<string, unknown> | undefined
    const isTool = source?.['kind'] === 'tool'
    const role = m['role'] === 'user' ? (isTool ? 'tool' : 'user') : m['role']

    // 忽略纯系统提示词
    if (role === 'system') continue

    let content = ''
    let toolName: string | undefined

    if (typeof m['content'] === 'string') {
      content = m['content']
    } else if (Array.isArray(m['content'])) {
      const parts: string[] = []
      for (const block of m['content']) {
        if (!block) continue
        if (typeof block === 'string') {
          parts.push(block)
        } else if (typeof block === 'object') {
          const b = block as Record<string, unknown>
          if (typeof b['text'] === 'string') {
            parts.push(b['text'])
          } else if (b['type'] === 'tool_use' || b['type'] === 'tool_call') {
            toolName = typeof b['name'] === 'string' ? b['name'] : undefined
            parts.push(`[Tool Call: ${b['name'] || 'unknown'}(${JSON.stringify(b['arguments'] || b['input'] || {})})]`)
          } else if (b['type'] === 'tool_result') {
            const resText = typeof b['content'] === 'string' ? b['content'] : JSON.stringify(b['content'] ?? '')
            parts.push(resText)
          }
        }
      }
      content = parts.join('\n')
    }

    if (content.trim()) {
      result.push({
        role: (role as 'user' | 'assistant' | 'tool') || 'user',
        content: content.trim(),
        toolName,
      })
    }
  }

  return result
}
