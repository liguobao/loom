import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { appendFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessions, type Session } from 'huihua'
import { archiveWorkspace as collectWorkspace, inWorkspace, type Collector } from './archive.js'
import type { SummaryModel } from './summary.js'
import { validateConfig, workspaceId, type Config } from './config.js'
import { serviceDefinition } from './schedule.js'

// A deterministic model double isolates filesystem/Huihua tests from paid model calls.
const testModel: SummaryModel = async (_system, input) => {
  const messages = input.split('\n').map(line => JSON.parse(line))
  const users = messages.filter(message => message.role === 'user')
  const assistants = messages.filter(message => message.role === 'assistant')
  return JSON.stringify({ title: 'Workspace archiving', goal: users[0]?.text || 'Workspace archive',
    requirements: 'Summarize the initial requirement and later corrections. END OF LONG REQUEST',
    interaction: 'The user refined the archive requirements after implementation.',
    outcome: assistants.at(-1)?.text || 'Unverified', investigation: '', keyDecisions: '', rejectedApproaches: '', followUps: '' })
}
const archiveWorkspace = (config: Config, collector?: Collector, model: SummaryModel = testModel) => collectWorkspace(config, collector, model)
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-test-')))
  directories.push(root)
  const workspace = join(root, 'project')
  const store = join(root, 'sessions')
  await mkdir(workspace)
  await mkdir(store)
  const config: Config = { version: 1, workspace, outputDir: join(root, 'records'), providers: ['codex'], intervalSeconds: 300, roots: { codex: [store] }, homeDir: root }
  const source = join(store, 'rollout.jsonl')
  const fixture = (cwd = workspace, response = 'We decided to use TypeScript for reliable local archives.') => [
    { type: 'session_meta', timestamp: '2026-10-01T00:00:00Z', payload: { id: 'session-1', cwd, timestamp: '2026-10-01T00:00:00Z' } },
    { type: 'response_item', timestamp: '2026-10-01T00:01:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Implement local workspace archiving. sk-abcdefghijklmnopqrstuvwxyz123456' }] } },
    { type: 'response_item', timestamp: '2026-10-01T00:02:00Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: response }] } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
  await writeFile(source, fixture())
  return { config, root, source, fixture }
}
describe('workspace archiving through Huihua', () => {
  it('scans real Codex JSONL, redacts, skips repeats and updates one stable record', async () => {
    const { config, source, fixture } = await setup()
    const first = await archiveWorkspace(config)
    expect(first.failures).toEqual([])
    expect(first.archived).toBe(1)
    const markdown = await readFile(first.files[0], 'utf8')
    expect(markdown).toContain('Implement local workspace archiving')
    expect(markdown).toContain('[REDACTED:API_KEY]')
    expect(markdown).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(markdown).not.toContain('completed_at')
    expect((await archiveWorkspace(config)).unchanged).toBe(1)
    await writeFile(source, fixture(config.workspace, 'We decided to update the archive after more work was completed.'))
    const next = await archiveWorkspace(config)
    expect(next.files).toEqual(first.files)
    expect(await readFile(next.files[0], 'utf8')).toContain('update the archive')
    // Deleted output is recreated even when the source has not changed.
    await rm(next.files[0])
    expect((await archiveWorkspace(config)).archived).toBe(1)
  })
  it('upgrades legacy archives into summaries without copying the conversation', async () => {
    const { config, source, fixture } = await setup()
    const context = { type: 'event_msg', payload: { type: 'user_message', message: '<environment_context>cwd: /project</environment_context>' } }
    const long = 'Keep every user requirement and every assistant response. '.repeat(60) + 'END OF LONG REQUEST'
    const followup = { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: long }] } }
    const short = { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] } }
    const originalRows = fixture().trim().split('\n')
    originalRows.splice(1, 0, JSON.stringify(context))
    await writeFile(source, [...originalRows, JSON.stringify(followup), JSON.stringify(short)].join('\n') + '\n')
    const first = await archiveWorkspace(config)
    const markdown = await readFile(first.files[0], 'utf8')
    expect(markdown).toContain('## Requirements')
    expect(markdown).toContain('## Interaction Summary')
    expect(markdown).not.toContain('## Conversation')
    expect(markdown).not.toContain(long)
    expect(markdown).toContain('END OF LONG REQUEST')
    expect(markdown).not.toContain('### 1. User')
    expect(markdown).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(markdown.split('## Goal\n')[1].split('## Outcome')[0]).toContain('Implement local workspace archiving')
    expect(markdown.split('## Goal\n')[1].split('## Outcome')[0]).not.toContain('environment_context')
    const statePath = join(first.files[0], '..', '.state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    for (const entry of Object.values(state.entries)) (entry as { formatVersion?: number }).formatVersion = 3
    await writeFile(statePath, JSON.stringify(state))
    await writeFile(first.files[0], '# Legacy summary-only record\n')
    const upgrade = await archiveWorkspace(config)
    expect(upgrade.archived).toBe(1)
    expect(upgrade.files).toEqual(first.files)
    expect(await readFile(first.files[0], 'utf8')).toContain('## Requirements')
    expect((await archiveWorkspace(config)).unchanged).toBe(1)
  })
  it('preserves the previous summary when a model call fails', async () => {
    const { config, source, fixture } = await setup()
    const first = await archiveWorkspace(config)
    const previous = await readFile(first.files[0], 'utf8')
    await writeFile(source, fixture(config.workspace, 'New assistant response requiring a summary refresh.'))
    const failed = await archiveWorkspace(config, undefined, async () => { throw new Error('Summary model unavailable') })
    expect(failed.failures[0]).toContain('Summary model unavailable')
    expect(await readFile(first.files[0], 'utf8')).toBe(previous)
    expect((await archiveWorkspace(config)).archived).toBe(1)
  })
  it('summarizes real tool evidence in source order and refreshes when only results change', async () => {
    const { config, source, fixture } = await setup()
    const call = { type: 'response_item', payload: { type: 'function_call', call_id: 'test-1', name: 'exec_command', arguments: JSON.stringify({ cmd: 'pnpm test' }) } }
    const output = (text: string) => ({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'test-1', output: text } })
    const rows = fixture().trim().split('\n')
    let input = ''
    const model: SummaryModel = async (system, value) => { input = value; return testModel(system, value) }
    await writeFile(source, [...rows, JSON.stringify(call), JSON.stringify(output('FAIL auth.test.ts; exit code 1; sk-abcdefghijklmnopqrstuvwxyz123456'))].join('\n') + '\n')
    const first = await archiveWorkspace(config, undefined, model)
    expect(first.failures).toEqual([])
    const events = input.split('\n').map(line => JSON.parse(line))
    expect(events.map(event => event.role)).toEqual(['user', 'assistant', 'tool', 'tool'])
    expect(input).toContain('pnpm test')
    expect(input).toContain('FAIL auth.test.ts; exit code 1')
    expect(input).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(input).toContain('[REDACTED:API_KEY]')
    expect((await archiveWorkspace(config, undefined, model)).unchanged).toBe(1)
    await writeFile(source, [...rows, JSON.stringify(call), JSON.stringify(output('PASS auth.test.ts; exit code 0'))].join('\n') + '\n')
    const next = await archiveWorkspace(config, undefined, model)
    expect(next.archived).toBe(1)
    expect(next.files).toEqual(first.files)
    expect(input).toContain('PASS auth.test.ts; exit code 0')
  })
  it('excludes sibling workspaces and unknown workspace metadata', async () => {
    const { config, source, fixture } = await setup()
    await writeFile(source, fixture(config.workspace + '-other'))
    const result = await archiveWorkspace(config)
    expect(result.archived).toBe(0)
    expect(result.skipped).toBe(1)
    expect(await inWorkspace(undefined, config.workspace)).toBe(false)
    expect(await inWorkspace('relative-path', config.workspace)).toBe(false)
    expect(await inWorkspace(join(config.workspace, 'subdir'), config.workspace)).toBe(true)
  })
  it('does not checkpoint partial sessions and retries failures', async () => {
    const { config, source } = await setup()
    const session = await sessions.parse('codex', { path: source })
    const collector: Collector = {
      scan: async () => ({ refs: [session], failures: [] }),
      read: async () => ({ ...session, diagnostics: [{ code: 'PartialParse', message: 'Partial test record' }] } as Session),
    }
    const partial = await archiveWorkspace(config, collector)
    expect(partial.archived).toBe(0)
    expect(partial.failures).toHaveLength(1)
    expect((await archiveWorkspace(config)).archived).toBe(1)
  })
  it('archives real Codex text despite status records, freeform tool arguments and pending results', async () => {
    const { config, source } = await setup()
    const extra = [
      ...['task_started', 'world_state', 'item_completed', 'thread_settings_applied', 'mcp_tool_call_end', 'patch_apply_end'].map(type => ({ type: 'event_msg', payload: { type } })),
      { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'pending-call', name: 'apply_patch', input: '*** Begin Patch\n*** End Patch' } },
    ]
    await appendFile(source, extra.map(row => JSON.stringify(row)).join('\n') + '\n')
    const session = await sessions.parse('codex', { path: source })
    expect(session.diagnostics).toHaveLength(8)
    const result = await archiveWorkspace(config)
    expect(result.failures).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.archived).toBe(1)
    expect(await readFile(result.files[0], 'utf8')).toContain('Implement local workspace archiving')
    expect((await archiveWorkspace(config)).unchanged).toBe(1)
  })
  it('preserves a good archive on malformed JSON and retries after repair', async () => {
    const { config, source, fixture } = await setup()
    const original = await archiveWorkspace(config)
    const markdown = await readFile(original.files[0], 'utf8')
    await appendFile(source, '{broken-json\n')
    const broken = await archiveWorkspace(config)
    expect(broken.archived).toBe(0)
    expect(broken.failures).toHaveLength(1)
    expect(broken.failures[0]).not.toContain('parse diagnostics;')
    expect(await readFile(original.files[0], 'utf8')).toBe(markdown)
    await writeFile(source, fixture(config.workspace, 'We decided to archive the repaired complete conversation now.'))
    expect((await archiveWorkspace(config)).archived).toBe(1)
  })
  it('serializes concurrent jobs and releases locks on failure', async () => {
    const { config } = await setup()
    let release!: () => void
    let started!: () => void
    const barrier = new Promise<void>(resolve => { started = resolve })
    const waiting = new Promise<void>(resolve => { release = resolve })
    const collector: Collector = {
      scan: async () => { started(); await waiting; throw new Error('scan failed') }, read: sessions.read,
    }
    const running = archiveWorkspace(config, collector)
    const failed = expect(running).rejects.toThrow('scan failed')
    await barrier
    await expect(archiveWorkspace(config)).rejects.toThrow('Another archive job is running')
    release()
    await failed
    expect((await archiveWorkspace(config)).archived).toBe(1)
    const dirs = await readdir(config.outputDir)
    expect(await readdir(join(config.outputDir, dirs[0]))).not.toContain('.lock')
  })
})
describe('configuration and service definitions', () => {
  it('rejects bad intervals and unknown providers', async () => {
    const { config } = await setup()
    expect(() => validateConfig({ ...config, intervalSeconds: 0 })).toThrow('intervalSeconds')
    expect(() => validateConfig({ ...config, providers: ['not-a-provider'] })).toThrow()
  })
  it('quotes executable/config paths and isolates services by workspace', async () => {
    const { config, root } = await setup()
    const mac = serviceDefinition('darwin', config, '/tmp/a&b/config.json', '/node path/node', '/cli path/cli.js')
    expect(mac.content).toContain('/tmp/a&amp;b/config.json')
    expect(mac.content).toContain('<string>/node path/node</string>')
    expect(mac.name).toContain(workspaceId(config.workspace))
    if (process.platform === 'darwin') {
      const plist = join(root, 'service.plist')
      await writeFile(plist, mac.content)
      expect(execFileSync('plutil', ['-lint', plist], { encoding: 'utf8' })).toContain('OK')
    }
    const linux = serviceDefinition('linux', config, '/tmp/100%/$config.json', '/node path/node', '/cli path/cli.js')
    expect(linux.content).toContain('"/node path/node"')
    expect(linux.content).toContain('/tmp/100%%/$$config.json')
    expect(() => serviceDefinition('win32', config, '', '', '')).toThrow('macOS and Linux')
  })
})
