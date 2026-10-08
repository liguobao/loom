import { describe, it, expect, afterEach, vi } from 'vitest'
import { rm, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveWork, resolveWorkspaceAndProject } from '../archive.js'
import { extractConversationFromSession } from '../session-adapter.js'
import { LoomPluginService, apply } from '../plugin.js'
import type { CordisContext } from '../plugin.js'
import type { SummaryModel } from '@loom/distill'

const semanticSummary = {
  title: '本地归档', goal: '重构网络层为本地归档', requirements: '移除 Server 连接，保留用户纠正',
  interaction: '最初要求重构网络层；之后纠正方案；测试失败后修复并重新验证。',
  outcome: '测试已通过；CLI 尚待完善', investigation: '定位测试失败并修复',
  keyDecisions: '采用本地存储', rejectedApproaches: '放弃 Server 连接', followUps: '完善 CLI',
}
const testModel: SummaryModel = async () => JSON.stringify(semanticSummary)

describe('Local Archive & Session Adapter', () => {
  const testDir = join(tmpdir(), `loom-test-${Date.now()}`)

  afterEach(async () => {
    vi.unstubAllEnvs()
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {}
  })

  it('does not activate the archive plugin inside summary subprocesses', () => {
    vi.stubEnv('LOOM_SUMMARY_RUNTIME', '1')
    const provide = vi.fn()
    const effect = vi.fn()
    apply({ provide, effect } as unknown as CordisContext)
    expect(provide).not.toHaveBeenCalled()
    expect(effect).not.toHaveBeenCalled()
  })

  it('resolveWorkspaceAndProject 应根据路径解析 workspace 和 project', () => {
    const res = resolveWorkspaceAndProject('/var/lib/dsh/workspace/loom')
    expect(res.workspace).toBe('workspace')
    expect(res.project).toBe('loom')

    const custom = resolveWorkspaceAndProject('/some/path', {
      workspace: 'team-infra',
      project: 'api-service',
    })
    expect(custom.workspace).toBe('team-infra')
    expect(custom.project).toBe('api-service')
  })

  it('extractConversationFromSession 应正确从 Session 中提炼对话', () => {
    const fakeSession = {
      id: 'session-123',
      header: { meta: { cwd: '/var/lib/dsh/workspace/loom' } },
      deriveMessages: () => [
        { role: 'system', content: 'You are an agent.' },
        {
          role: 'user',
          content: [{ type: 'text', text: '请帮我实现一个鉴权功能' }],
        },
        {
          role: 'user',
          source: { kind: 'tool' },
          content: [
            {
              type: 'tool_result',
              content: 'Created auth.ts file',
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '鉴权模块已创建完毕，因为 JWT 更简单所以选择 JWT 方案。' }],
        },
      ],
    }

    const conversations = extractConversationFromSession(fakeSession)
    expect(conversations.length).toBe(3)
    expect(conversations[0]?.role).toBe('user')
    expect(conversations[0]?.content).toBe('请帮我实现一个鉴权功能')
    expect(conversations[1]?.role).toBe('tool')
    expect(conversations[2]?.role).toBe('assistant')
  })

  it('archiveWork 应总结对话、脱敏敏感信息并以 workspace/project 格式存储', async () => {
    const conversations = [
      {
        role: 'user' as const,
        content: '我们需要重构网络层，请移除 Server 端连接，秘钥为 sk-test1234567890abcdef1234567890',
      },
      {
        role: 'assistant' as const,
        content: '我排查了网络模块代码，因为不需要 Server 端，决定改用纯本地存储方式。后续还需要完善 CLI。',
      },
    ]

    const result = await archiveWork({
      conversations,
      outputDir: testDir,
      workspace: 'org-frontend',
      project: 'mobile-app',
      title: '重构网络模块为纯本地模式',
      summaryModel: testModel,
    })

    // 检查结果路径结构
    expect(result.workspace).toBe('org-frontend')
    expect(result.project).toBe('mobile-app')
    expect(result.relativePath).toMatch(/^org-frontend\/mobile-app\/\d{4}-\d{2}-\d{2}-\d{6}-[a-z0-9]+\.md$/)
    expect(result.redactedCount).toBeGreaterThanOrEqual(1)

    // 读取存储的文件
    const fileContent = await readFile(result.localPath, 'utf-8')

    // 验证敏感信息已脱敏
    expect(fileContent).not.toContain('sk-test1234567890abcdef1234567890')


    // 验证 Markdown 各小节完整
    expect(fileContent).toContain('workspace: org-frontend')
    expect(fileContent).toContain('project: mobile-app')
    expect(fileContent).toContain('# 重构网络模块为纯本地模式')
    expect(fileContent).toContain('## Goal')
    expect(fileContent).toContain('## Outcome')
    expect(fileContent).toContain('## Key Decisions')
    expect(fileContent).toContain('## Requirements')
    expect(fileContent).toContain(semanticSummary.interaction)
    expect(fileContent).not.toContain('completed_at')
  })

  it('preserves native DSH tool calls, IDs, failure flags and mixed block order', () => {
    const messages = extractConversationFromSession({ messages: [
      { role: 'assistant', content: [
        { type: 'text', text: '先运行测试' },
        { type: 'tool-call', id: 'test-1', name: 'bash', arguments: '{"command":"pnpm test"}' },
        { type: 'text', text: '结果待确认' },
      ] },
      { role: 'tool', toolCallId: 'test-1', isError: true, content: [{ type: 'text', text: 'FAIL auth.test.ts' }] },
      { role: 'user', content: '改一下' },
      { role: 'assistant', content: [{ type: 'tool-call', id: 'edit-1', name: 'edit', arguments: '{"path":"src/auth.ts"}' }] },
      { role: 'tool', toolCallId: 'edit-1', isError: true, content: [] },
    ] })
    expect(messages.map(message => message.role)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'user', 'tool', 'tool'])
    expect(JSON.parse(messages[1].content)).toMatchObject({ type: 'tool_call', callId: 'test-1', toolName: 'bash' })
    expect(JSON.parse(messages[3].content)).toMatchObject({ type: 'tool_result', callId: 'test-1', isError: true, result: 'FAIL auth.test.ts' })
    expect(messages[3].toolName).toBe('bash')
    expect(messages[4].content).toBe('改一下')
    expect(JSON.parse(messages[6].content)).toMatchObject({ type: 'tool_result', callId: 'edit-1', isError: true, result: '' })
  })

  it('uses semantic summaries in the plugin, redacts evidence before the model, and does not write on failure', async () => {
    let input = ''
    const model: SummaryModel = async (_system, value) => { input = value; return JSON.stringify(semanticSummary) }
    const service = new LoomPluginService({ logger: { info() {} } } as unknown as CordisContext,
      { outputDir: testDir, workspace: 'team', project: 'app', summary: { provider: 'codex-server' } })
    const session = { id: 's1', messages: [
      { role: 'user', content: '修复鉴权' },
      { role: 'assistant', content: [{ type: 'tool-call', id: 'test-1', name: 'bash', arguments: '{"command":"pnpm test"}' }] },
      { role: 'tool', toolCallId: 'test-1', isError: true, content: 'FAIL sk-abcdefghijklmnopqrstuvwxyz123456' },
      { role: 'user', content: '只修复，不重构' },
    ] }
    const archived = await service.archiveSession(session, { summaryModel: model })
    expect(input).toContain('pnpm test')
    expect(input).toContain('FAIL')
    expect(input).toContain('只修复，不重构')
    expect(input).toContain('[REDACTED:API_KEY]')
    expect(input).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    const markdown = await readFile(archived!.localPath, 'utf8')
    expect(markdown).toContain(semanticSummary.interaction)
    const files = await readdir(join(testDir, 'team', 'app'))
    await expect(service.archiveSession(session, { summaryModel: async () => { throw new Error('model unavailable') } })).rejects.toThrow('model unavailable')
    expect(await readdir(join(testDir, 'team', 'app'))).toEqual(files)
    expect(await readFile(archived!.localPath, 'utf8')).toBe(markdown)
  })
})
