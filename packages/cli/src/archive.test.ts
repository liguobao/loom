import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessions, type Session } from 'huihua'
import { archiveWorkspace, inWorkspace, type Collector } from './archive.js'
import { validateConfig, workspaceId, type Config } from './config.js'
import { serviceDefinition } from './schedule.js'

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
