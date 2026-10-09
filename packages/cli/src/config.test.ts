import { afterEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveDirectory, defaultConfigPath, findConfigPath, legacyConfigPath, loadConfig, resolveWorkspace, saveConfig, validateConfig, workspaceId, type Config } from './config.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-config-')))
  directories.push(root)
  const workspace = join(root, 'project')
  await mkdir(workspace)
  const config: Config = { version: 1, workspace, outputDir: join(workspace, '.loom', 'records'), archiveLayout: 'flat', providers: ['codex'], intervalSeconds: 300 }
  return { root, workspace, config }
}
it('resolves the Git root from subdirectories and symlinks, including worktrees', async () => {
  const { root, workspace } = await setup()
  const nested = join(workspace, 'src', 'nested')
  await mkdir(nested, { recursive: true })
  expect(await resolveWorkspace(nested)).toBe(nested)
  await mkdir(join(workspace, '.git'))
  expect(await resolveWorkspace(nested)).toBe(workspace)
  const alias = join(root, 'alias')
  await symlink(nested, alias)
  expect(await resolveWorkspace(alias)).toBe(workspace)
  await rm(join(workspace, '.git'), { recursive: true })
  await writeFile(join(workspace, '.git'), 'gitdir: /path/to/main/.git/worktrees/project\n')
  expect(await resolveWorkspace(nested)).toBe(workspace)
})
it('prefers repository-local config and falls back to the legacy global config', async () => {
  const { root, workspace, config } = await setup()
  const home = join(root, 'home')
  const local = defaultConfigPath(workspace)
  const legacy = legacyConfigPath(workspace, home)
  expect(local).toBe(join(workspace, '.loom', 'config.json'))
  expect(await findConfigPath(workspace, home)).toBeUndefined()
  await saveConfig(legacy, { ...config, archiveLayout: undefined })
  expect(await findConfigPath(workspace, home)).toBe(legacy)
  await saveConfig(local, config)
  expect(await findConfigPath(workspace, home)).toBe(local)
})
it('stores relative paths and keeps flat archives discoverable after moving the repository', async () => {
  const { root, workspace, config } = await setup()
  await saveConfig(defaultConfigPath(workspace), config)
  const saved = JSON.parse(await readFile(defaultConfigPath(workspace), 'utf8'))
  expect(saved.workspace).toBe('..')
  expect(saved.outputDir).toBe('records')
  const moved = join(root, 'moved-project')
  await rename(workspace, moved)
  const loaded = await loadConfig(defaultConfigPath(moved))
  expect(loaded.workspace).toBe(moved)
  expect(archiveDirectory(loaded)).toBe(join(moved, '.loom', 'records'))
})
it('preserves the legacy workspace layout and validates explicit layouts', async () => {
  const { config } = await setup()
  expect(archiveDirectory(config)).toBe(config.outputDir)
  const legacy = join(config.outputDir, `project-${workspaceId(config.workspace)}`)
  expect(archiveDirectory({ ...config, archiveLayout: undefined })).toBe(legacy)
  expect(archiveDirectory({ ...config, archiveLayout: 'workspace' })).toBe(legacy)
  expect(() => validateConfig({ ...config, archiveLayout: 'unknown' })).toThrow('archiveLayout')
})
