import { open, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { sessions, type Session, type SessionRef } from 'huihua'
import { conversationOf, fileChangesOf, millisOf } from 'huihua/observe'
import { distillConversation, generateMarkdown, redactSecrets, type ConversationMessage } from '@loom/distill'
import { atomicWrite, digest, workspaceId, type Config } from './config.js'

interface Entry { fingerprint: string; file: string; createdAt: string }
interface State { version: 1; entries: Record<string, Entry> }
export interface ArchiveReport { archived: number; unchanged: number; skipped: number; failures: string[]; files: string[] }
export interface Collector {
  scan: typeof sessions.scan
  read: typeof sessions.read
}
function sourceKey(ref: SessionRef): string {
  return digest(JSON.stringify([ref.provider, ref.id, ref.source]))
}
export function messagesOf(session: Session): ConversationMessage[] {
  return conversationOf(session).map(event => ({
    role: event.type === 'user_message' ? 'user' as const : 'assistant' as const,
    content: event.data.content.filter(block => block.type === 'text').map(block => block.data).join('\n'),
  })).filter(message => message.content.trim().length > 0)
}
export async function inWorkspace(path: string | undefined, workspace: string): Promise<boolean> {
  if (!path || !isAbsolute(path)) return false
  let canonical: string
  try { canonical = await realpath(path) } catch { canonical = resolve(path) }
  const rel = relative(workspace, canonical)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
function timestamp(value: Session['createdAt']): string | undefined {
  const time = millisOf(value)
  return time !== undefined && Number.isFinite(time) ? new Date(time).toISOString() : undefined
}
async function loadState(path: string): Promise<State> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as State
    if (value.version !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw new Error('Invalid archive state')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: {} }
    throw error
  }
}
// An exclusive file lock prevents parallel watch/cron/manual jobs from racing.
// Dead owner PIDs are recoverable after a crash; young empty locks are never removed.
async function acquireLock(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600)
      try { await handle.writeFile(String(process.pid)) } finally { await handle.close() }
      return () => rm(path, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let pid: number
      try { pid = Number(await readFile(path, 'utf8')) } catch { throw new Error('Archive lock changed; retry later') }
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); throw new Error('Another archive job is running') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      } else if (Date.now() - (await stat(path)).mtimeMs < 60000) {
        throw new Error('Another archive job is starting')
      }
      await rm(path, { force: true })
    }
  }
  throw new Error('Could not acquire archive lock')
}
export async function archiveWorkspace(config: Config, collector: Collector = sessions): Promise<ArchiveReport> {
  const directory = join(config.outputDir, `${basename(config.workspace) || 'workspace'}-${workspaceId(config.workspace)}`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const unlock = await acquireLock(join(directory, '.lock'))
  const report: ArchiveReport = { archived: 0, unchanged: 0, skipped: 0, failures: [], files: [] }
  try {
    const statePath = join(directory, '.state.json')
    const state = await loadState(statePath)
    const { refs, failures } = await collector.scan({ providers: config.providers, roots: config.roots, homeDir: config.homeDir })
    report.failures.push(...failures.map(f => `${f.provider}: ${f.message}`))
    for (const ref of refs) {
      try {
        // Some providers only establish the workspace during a full read.
        if (ref.workspace?.path && !await inWorkspace(ref.workspace.path, config.workspace)) { report.skipped++; continue }
        const session = await collector.read(ref)
        if (!await inWorkspace(session.workspace?.path ?? ref.workspace?.path, config.workspace)) { report.skipped++; continue }
        if (session.diagnostics.length > 0) {
          report.failures.push(`${ref.provider}/${ref.id}: parse diagnostics; retrying on the next run`)
          continue
        }
        const conversations = messagesOf(session)
        if (!conversations.length) { report.skipped++; continue }
        const key = sourceKey(ref)
        const changedFiles = fileChangesOf(session).map(event => event.data.path)
        const fingerprint = digest(JSON.stringify([conversations, changedFiles, session.title, session.workspace, session.createdAt, session.updatedAt]))
        const previous = state.entries[key]
        const file = `${key}.md`
        if (previous?.fingerprint === fingerprint) {
          try { await stat(join(directory, file)); report.unchanged++; continue }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        }
        const createdAt = timestamp(session.createdAt) ?? previous?.createdAt ?? new Date().toISOString()
        const { workRecord } = distillConversation({
          conversations,
          title: session.title,
          meta: {
            id: key, workspace: config.workspace, project: basename(config.workspace),
            createdAt, tags: [session.provider], sourceConversationCount: 1,
            repository: session.workspace?.repository, branch: session.workspace?.branch,
          },
          gitContext: { changedFiles: [...new Set(changedFiles)] },
        })
        // Do not mark snapshots as completed or attribute today's Git changes to older sessions.
        const markdown = redactSecrets(generateMarkdown(workRecord)).content
        await atomicWrite(join(directory, file), markdown)
        state.entries[key] = { fingerprint, file, createdAt }
        // Persist each success so another failing source cannot lose progress.
        await atomicWrite(statePath, JSON.stringify(state, null, 2) + '\n')
        report.archived++
        report.files.push(join(directory, file))
      } catch (error) {
        report.failures.push(`${ref.provider}/${ref.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return report
  } finally { await unlock() }
}
