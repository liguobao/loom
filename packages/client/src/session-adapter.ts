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
  const toolNames = new Map<string, string>()
  for (const msg of rawMessages) {
    if (!msg || typeof msg !== 'object') continue
    const m = msg as Record<string, unknown>
    const source = m['source'] as Record<string, unknown> | undefined
    const role = m['role'] === 'tool' || source?.['kind'] === 'tool' ? 'tool' : m['role']
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue
    const timestamp = typeof m['timestamp'] === 'string' ? m['timestamp'] : undefined
    const callId = m['toolCallId'] ?? m['tool_call_id'] ?? source?.['callId']
    const toolName = typeof m['name'] === 'string' ? m['name']
      : typeof callId === 'string' ? toolNames.get(callId) : undefined
    const isError = m['isError'] ?? m['is_error']
    const initialCount = result.length
    const parts: string[] = []
    const flush = () => {
      const content = parts.splice(0).join('\n').trim()
      if (!content && role !== 'tool') return
      result.push({ role, timestamp, toolName, content: role === 'tool'
        ? JSON.stringify({ type: 'tool_result', callId, toolName, isError, result: content }) : content })
    }
    if (typeof m['content'] === 'string') parts.push(m['content'])
    else if (Array.isArray(m['content'])) {
      for (const block of m['content']) {
        if (typeof block === 'string') { parts.push(block); continue }
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b['type'] === 'tool-call' || b['type'] === 'tool_use' || b['type'] === 'tool_call') {
          // Keep each call separate from assistant claims and in block order.
          if (parts.length) flush()
          const name = typeof b['name'] === 'string' ? b['name'] : 'unknown'
          const id = b['id'] ?? b['call_id']
          if (typeof id === 'string') toolNames.set(id, name)
          result.push({ role: 'tool', timestamp, toolName: name, content: JSON.stringify({
            type: 'tool_call', callId: id, toolName: name, arguments: b['arguments'] ?? b['input'] ?? {},
          }) })
        } else if (b['type'] === 'tool_result') {
          if (parts.length) flush()
          const id = b['tool_use_id'] ?? callId
          const name = typeof id === 'string' ? toolNames.get(id) : toolName
          result.push({ role: 'tool', timestamp, toolName: name, content: JSON.stringify({
            type: 'tool_result', callId: id, toolName: name, isError: b['is_error'] ?? isError, result: b['content'] ?? '',
          }) })
        } else if (typeof b['text'] === 'string') parts.push(b['text'])
      }
    }
    if (parts.length || (role === 'tool' && result.length === initialCount)) flush()
  }
  return result
}
