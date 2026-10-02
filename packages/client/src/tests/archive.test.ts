import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveWork, resolveWorkspaceAndProject } from '../archive.js'
import { extractConversationFromSession } from '../session-adapter.js'

describe('Local Archive & Session Adapter', () => {
  const testDir = join(tmpdir(), `loom-test-${Date.now()}`)

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {}
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
    expect(fileContent).toContain('[REDACTED:API_KEY]')


    // 验证 Markdown 各小节完整
    expect(fileContent).toContain('workspace: org-frontend')
    expect(fileContent).toContain('project: mobile-app')
    expect(fileContent).toContain('# 重构网络模块为纯本地模式')
    expect(fileContent).toContain('## Goal')
    expect(fileContent).toContain('## Outcome')
    expect(fileContent).toContain('## Key Decisions')
  })
})
