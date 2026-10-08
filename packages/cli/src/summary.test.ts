import { describe, expect, it } from 'vitest'
import { parseSummary, summarizeConversation, type SemanticSummary } from './summary.js'

const summary: SemanticSummary = {
  title: 'Workspace archive summary', goal: 'Summarize engineering sessions',
  requirements: 'Retain the meaning of all requirements and corrections',
  interaction: 'The user clarified that summaries should replace verbatim transcripts',
  outcome: 'Implementation pending verification', investigation: '',
  keyDecisions: 'Summarize all turns rather than truncating individual messages', rejectedApproaches: 'Verbatim transcript', followUps: 'Configure model',
}
describe('semantic conversation summarization', () => {
  it('sends all turns including short corrections, redacts secrets, and excludes environment context', async () => {
    let input = ''
    const result = await summarizeConversation([
      { role: 'user', content: '<environment_context>cwd: /project</environment_context>' },
      { role: 'user', content: 'Initial request sk-abcdefghijklmnopqrstuvwxyz123456' },
      { role: 'assistant', content: 'I will archive full conversations.' },
      { role: 'user', content: 'No, summarize.' },
      { role: 'tool', toolName: 'exec_command', content: 'FAIL auth.test.ts; exit code 1; sk-abcdefghijklmnopqrstuvwxyz123456' },
      { role: 'assistant', content: 'All tests passed.' },
    ], async (system, value) => {
      expect(system).toContain('后续纠正优先')
      expect(system).toContain('工具调用只证明尝试执行')
      expect(system).toContain('interaction 按发生顺序')
      input = value
      return JSON.stringify(summary)
    })
    expect(input).toContain('No, summarize.')
    expect(input).toContain('[REDACTED:API_KEY]')
    expect(input).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(input).not.toContain('environment_context')
    expect(input).toContain('FAIL auth.test.ts; exit code 1')
    expect(input).toContain('exec_command')
    expect(input).toContain('All tests passed.')
    expect(result).toEqual(summary)
  })
  it('processes the entire long history in bounded chunks and merges its summaries', async () => {
    const text = 'requirement '.repeat(600) + 'LAST USER CORRECTION'
    let collected = ''
    let merges = 0
    await summarizeConversation([{ role: 'tool', toolName: 'test', content: text }], async (system, input) => {
      expect(input.length).toBeLessThanOrEqual(2000)
      if (system.includes('输入是按时间排序')) {
        expect(system).toContain('失败与修复及验证证据')
        merges++
      }
      else for (const line of input.split('\n')) collected += JSON.parse(line).text
      return JSON.stringify(summary)
    }, 2000)
    expect(collected).toBe(text)
    expect(merges).toBeGreaterThan(0)
  })
  it('rejects invalid summaries and provider failures without falling back to truncated text', async () => {
    expect(() => parseSummary('{}')).toThrow('omitted string field')
    await expect(summarizeConversation([{ role: 'user', content: 'Summarize' }], async () => { throw new Error('Model unavailable') })).rejects.toThrow('Model unavailable')
  })
})
