import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { startArchiveServer } from './server.js'
import { defaultConfigPath, legacyConfigPath, saveConfig, workspaceId, type Config } from './config.js'

const servers: Server[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'loom-server-'))
  directories.push(root)
  const output = join(root, 'records')
  const directory = join(output, 'project-123')
  await mkdir(directory, { recursive: true })
  const server = await startArchiveServer({ port: 0, outputDir: output, home: root })
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  return { root, output, directory, base: `http://127.0.0.1:${address.port}` }
}
it('browses a workspace and its Markdown, and reads new archives on refresh', async () => {
  const { directory, base } = await setup()
  await writeFile(join(directory, 'one.md'), '---\ntitle: "First work record"\nworkspace: /projects/example\n---\n# First work record\n\n## Outcome\n\n**Finished**\n\n```ts\nconst x = 1\n```\n')
  const index = await (await fetch(base)).text()
  expect(index).toContain('example')
  expect(index).toContain('1 篇文档')
  const workspace = index.match(/href="(\/workspaces\/[^"/]+)"/)![1]
  const list = await (await fetch(base + workspace)).text()
  expect(list).toContain('First work record')
  const document = await fetch(base + workspace + '/one.md')
  const html = await document.text()
  expect(document.status).toBe(200)
  expect(html).toContain('<h2>Outcome</h2>')
  expect(html).toContain('<strong>Finished</strong>')
  expect(html).toContain('<pre><code>const x = 1</code></pre>')
  expect(html).toContain('查看 Markdown 原文')
  await writeFile(join(directory, 'two.md'), '# Another record\n')
  expect(await (await fetch(base + workspace)).text()).toContain('Another record')
})
it('rejects traversal, symlinks, private state files and writes; escapes archived HTML', async () => {
  const { root, directory, base } = await setup()
  await writeFile(join(root, 'secret.md'), 'OUTSIDE_SECRET')
  await symlink(join(root, 'secret.md'), join(directory, 'linked.md'))
  await writeFile(join(directory, '.state.json'), 'PRIVATE_STATE')
  await writeFile(join(directory, 'attack.md'), '# <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n')
  const index = await (await fetch(base)).text()
  const workspace = index.match(/href="(\/workspaces\/[^"/]+)"/)![1]
  const list = await (await fetch(base + workspace)).text()
  expect(list).not.toContain('linked.md')
  for (const path of ['/linked.md', '/.state.json', '/%2E%2E%2Fsecret.md', '/unknown.md']) {
    const response = await fetch(base + workspace + path)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('OUTSIDE_SECRET')
  }
  const response = await fetch(base + workspace + '/attack.md')
  const html = await response.text()
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('href="javascript:')
  expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect((await fetch(base, { method: 'POST' })).status).toBe(405)
  expect((await fetch(base + '/workspaces/%ZZ')).status).toBe(400)
})
it('discovers configured custom outputs and shows registered workspaces with no archives', async () => {
  const { root, base } = await setup()
  const workspace = join(root, 'custom-project')
  const configDir = join(root, 'workspaces', workspaceId(workspace))
  await mkdir(configDir, { recursive: true })
  await writeFile(join(configDir, 'config.json'), JSON.stringify({ workspace, outputDir: '../../custom-records' }))
  let index = await (await fetch(base)).text()
  expect(index).toContain('custom-project')
  // An explicit output overrides the configured output.
  const archive = join(root, 'records', `custom-project-${workspaceId(workspace)}`)
  await mkdir(archive, { recursive: true })
  await writeFile(join(archive, 'entry.md'), '# Configured output\n')
  index = await (await fetch(base)).text()
  expect(index).toContain('1 篇文档')
  const server = await startArchiveServer({ port: 0, home: root })
  servers.push(server)
  const address = server.address() as { port: number }
  const custom = join(root, 'custom-records', `custom-project-${workspaceId(workspace)}`)
  await mkdir(custom, { recursive: true })
  await writeFile(join(custom, 'entry.md'), '# Custom archive\n')
  const other = await (await fetch(`http://127.0.0.1:${address.port}`)).text()
  expect(other).toContain('2 篇文档')
})
it('starts without an archive directory and reports an empty state', async () => {
  const { root } = await setup()
  const server = await startArchiveServer({ port: 0, home: join(root, 'missing-home') })
  servers.push(server)
  const address = server.address() as { port: number }
  const response = await fetch(`http://127.0.0.1:${address.port}`)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('暂无归档')
  await expect(startArchiveServer({ port: -1 })).rejects.toThrow('Port')
})
it('loads only the repository-local config from a Git subdirectory and refreshes flat records', async () => {
  const { root, directory } = await setup()
  await writeFile(join(directory, 'global.md'), '# Unrelated global archive\n')
  const workspace = join(root, 'local-project')
  const nested = join(workspace, 'src')
  const outputDir = join(workspace, '.loom', 'records')
  await mkdir(nested, { recursive: true })
  await mkdir(join(workspace, '.git'))
  const config: Config = { version: 1, workspace, outputDir, archiveLayout: 'flat', providers: ['codex'], intervalSeconds: 300 }
  await saveConfig(defaultConfigPath(workspace), config)
  await saveConfig(legacyConfigPath(workspace, root), { ...config, outputDir: join(root, 'records'), archiveLayout: undefined })
  const server = await startArchiveServer({ port: 0, workspace: nested, home: root })
  servers.push(server)
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  const index = await (await fetch(base)).text()
  expect(index).toContain('local-project')
  expect(index).toContain('1 个工作区 · 0 篇文档')
  expect(index).not.toContain('project-123')
  const link = index.match(/href="(\/workspaces\/[^"/]+)"/)![1]
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, 'local.md'), '# Repository record\n\n## Outcome\n\nDone\n')
  await writeFile(join(outputDir, '.state.json'), 'PRIVATE_STATE')
  expect(await (await fetch(base + link)).text()).toContain('Repository record')
  expect(await (await fetch(base + link + '/local.md')).text()).toContain('<h2>Outcome</h2>')
  expect((await fetch(base + link + '/.state.json')).status).toBe(404)
  expect(await (await fetch(base)).text()).toContain('1 个工作区 · 1 篇文档')
})
it('browses flat records through an explicit output directory without initialization', async () => {
  const { root } = await setup()
  const outputDir = join(root, 'flat-records')
  await mkdir(outputDir)
  await writeFile(join(outputDir, 'entry.md'), '# Flat archive\n')
  const server = await startArchiveServer({ port: 0, outputDir, home: root })
  servers.push(server)
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  const index = await (await fetch(base)).text()
  expect(index).toContain('1 个工作区 · 1 篇文档')
  const link = index.match(/href="(\/workspaces\/[^"/]+)"/)![1]
  expect(await (await fetch(base + link + '/entry.md')).text()).toContain('Flat archive')
})
