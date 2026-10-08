import { describe, it, expect } from 'vitest'
import { redactSecrets } from '../src/redact.js'
import { generateMarkdown, parseMarkdown, generateRecordPath } from '../src/markdown.js'
import {
  distillConversation,
  extractChangedAreas,
  extractKeyDecisions,
  isNoiseMessage,
  type ConversationMessage,
} from '../src/distill.js'

// ──────────────────────────────────────────────
// redact
// ──────────────────────────────────────────────
describe('redactSecrets', () => {
  it('应脱敏 OpenAI API key', () => {
    const input = 'export API_KEY=sk-abcdefghijklmnopqrstu1234'
    const result = redactSecrets(input)
    expect(result.content).not.toContain('sk-abcdefghijklmnopqrstu1234')
    expect(result.redactedCount).toBeGreaterThan(0)
    expect(result.patterns.length).toBeGreaterThan(0)
  })

  it('应脱敏 AWS Access Key', () => {
    const input = 'key: AKIAIOSFODNN7EXAMPLE'
    const result = redactSecrets(input)
    expect(result.content).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(result.patterns).toContain('AWS_ACCESS_KEY')
  })

  it('应脱敏 GitHub PAT', () => {
    const input = 'token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890'
    const result = redactSecrets(input)
    expect(result.content).not.toContain('ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890')
    expect(result.patterns).toContain('GITHUB_TOKEN')
  })

  it('应脱敏 .env 风格 SECRET', () => {
    // 使用不含 password 关键词的变量名，避免被 CONFIG_PASSWORD 规则优先命中
    const input = 'STRIPE_SECRET=sk_live_abcde12345fghij67890'
    const result = redactSecrets(input)
    expect(result.content).not.toContain('sk_live_abcde12345fghij67890')
    // ENV_SECRET 或 API_KEY 规则均可脱敏（只要敏感值被移除即可）
    expect(result.patterns.length).toBeGreaterThan(0)
  })

  it('应脱敏 Bearer token', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload'
    const result = redactSecrets(input)
    expect(result.content).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    expect(result.patterns).toContain('BEARER_TOKEN')
  })

  it('应脱敏数据库 URL', () => {
    const input = 'postgres://admin:s3cr3t@db.example.com:5432/mydb'
    const result = redactSecrets(input)
    expect(result.content).not.toContain('s3cr3t')
    expect(result.patterns).toContain('DATABASE_URL')
  })

  it('不含敏感信息时返回原始内容', () => {
    const input = 'Hello, world! This is a normal text.'
    const result = redactSecrets(input)
    expect(result.content).toBe(input)
    expect(result.redactedCount).toBe(0)
    expect(result.patterns).toHaveLength(0)
  })
})

// ──────────────────────────────────────────────
// markdown
// ──────────────────────────────────────────────
describe('generateMarkdown + parseMarkdown', () => {
  const meta = {
    id: '01KABC123',
    organization: 'org_1',
    workspace: 'ws_1',
    project: 'proj_1',
    owner: 'user_1',
    createdAt: '2026-10-01T01:30:00+08:00',
    completedAt: '2026-10-01T02:10:00+08:00',
    repository: 'liguobao/loom',
    branch: 'feat/live-view',
    baseCommit: 'abc123',
    finalCommit: 'def456',
    tags: ['remote', 'websocket', 'permissions'],
    sourceConversationCount: 2,
  }

  it('应生成包含 front matter 和各节的 Markdown', () => {
    const md = generateMarkdown({
      meta,
      title: '实现 WebSocket 实时推送',
      goal: '实现 WebSocket 实时推送功能',
      outcome: '完成了 WebSocket 推送，支持房间订阅',
      changedAreas: ['packages/server/src/ws.ts', 'packages/client/src/hooks/useWs.ts'],
      keyDecisions: '- 选择 ws 库而非 socket.io，减少依赖体积',
    })

    expect(md).toContain('id: 01KABC123')
    expect(md).toContain('organization: org_1')
    expect(md).toContain('## Goal')
    expect(md).toContain('## Outcome')
    expect(md).toContain('## Changed Areas')
    expect(md).toContain('packages/server/src/ws.ts')
  })

  it('生成后能被 parseMarkdown 正确解析', () => {
    const md = generateMarkdown({
      meta,
      title: '测试标题',
      goal: '测试目标',
      requirements: '保留新增需求与约束',
      interaction: '初次尝试失败，用户纠正后修复并通过测试',
      outcome: '测试结果',
    })

    const parsed = parseMarkdown(md)
    expect(parsed.meta.id).toBe('01KABC123')
    expect(parsed.meta.organization).toBe('org_1')
    expect(parsed.meta.tags).toEqual(['remote', 'websocket', 'permissions'])
    expect(parsed.goal).toBe('测试目标')
    expect(parsed.requirements).toBe('保留新增需求与约束')
    expect(parsed.interaction).toBe('初次尝试失败，用户纠正后修复并通过测试')
    expect(parsed.outcome).toBe('测试结果')
  })
})

describe('generateRecordPath', () => {
  it('应生成正确的路径格式', () => {
    const meta = {
      id: '01KABC123',
      organization: 'org_1',
      workspace: 'ws_1',
      project: 'proj_1',
      owner: 'user_1',
      createdAt: '2026-10-01T01:30:00Z',
      tags: [],
      sourceConversationCount: 1,
    }
    const path = generateRecordPath(meta)
    expect(path).toBe(
      'organizations/org_1/workspaces/ws_1/projects/proj_1/records/2026/10/01KABC123.md',
    )
  })
})

// ──────────────────────────────────────────────
// distill
// ──────────────────────────────────────────────
describe('isNoiseMessage', () => {
  it('tool 角色消息应视为噪声', () => {
    const msg: ConversationMessage = { role: 'tool', content: 'file content...' }
    expect(isNoiseMessage(msg)).toBe(true)
  })

  it('极短的 user 确认消息应视为噪声', () => {
    expect(isNoiseMessage({ role: 'user', content: 'ok' })).toBe(true)
    expect(isNoiseMessage({ role: 'user', content: '好的' })).toBe(true)
  })

  it('正常 user 消息不应视为噪声', () => {
    expect(isNoiseMessage({ role: 'user', content: '请帮我实现 WebSocket 功能' })).toBe(false)
  })
})

describe('extractKeyDecisions', () => {
  it('应提取含决策关键词的句子', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'assistant',
        content: '我们决定使用 ws 库而非 socket.io，因为它更轻量。',
      },
    ]
    const result = extractKeyDecisions(messages)
    expect(result).toContain('决定')
    expect(result).toContain('因为')
  })
})

describe('distillConversation', () => {
  const meta = {
    id: '01KABC123',
    organization: 'org_1',
    workspace: 'ws_1',
    project: 'proj_1',
    owner: 'user_1',
    createdAt: '2026-10-01T01:30:00Z',
    tags: [],
    sourceConversationCount: 1,
  }

  it('应从对话中提取基本 Work Record', () => {
    const conversations: ConversationMessage[] = [
      { role: 'user', content: '帮我实现 WebSocket 实时推送功能，支持多房间订阅' },
      { role: 'assistant', content: '好的，我来分析需求并实现。首先需要选择合适的 WebSocket 库。' },
      { role: 'tool', content: 'reading file...', toolName: 'read_file' },
      { role: 'assistant', content: '我们决定使用 ws 库，因为它更轻量。实现已完成，支持房间订阅和广播功能。' },
    ]

    const result = distillConversation({ conversations, meta })
    expect(result.workRecord.goal).toContain('WebSocket')
    expect(result.workRecord.outcome).toContain('已完成')
    expect(result.warnings).toHaveLength(0)
  })

  it('全噪声消息时应有警告', () => {
    const conversations: ConversationMessage[] = [
      { role: 'tool', content: 'output...' },
      { role: 'user', content: 'ok' },
    ]
    const result = distillConversation({ conversations, meta })
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
