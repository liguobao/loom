import { open, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { sessions, type Diagnostic, type Session, type SessionRef } from 'huihua'
import { conversationOf, fileChangesOf, millisOf } from 'huihua/observe'
import { generateMarkdown, redactSecrets, type ConversationMessage } from '@loom/distill'
import { summarizeConversation, type SummaryModel } from './summary.js'
import { createSummaryModel } from './model.js'
import { atomicWrite, digest, workspaceId, type Config } from './config.js'

const ARCHIVE_FORMAT_VERSION = 3
interface Entry { fingerprint: string; file: string; createdAt: string; formatVersion?: number }
interface State { version: 1; entries: Record<string, Entry> }
export interface ArchiveReport { archived: number; unchanged: number; skipped: number; failures: string[]; warnings: string[]; files: string[] }
export interface Collector {
  scan: typeof sessions.scan
  read: typeof sessions.read
}
// These Codex diagnostics concern data the Markdown summarizer does not consume.
// Keep unknown diagnostic kinds blocking: malformed message data must not replace a good archive.
export function isNonConversationDiagnostic(provider: string, diagnostic: Diagnostic): boolean {
  if (provider !== 'codex' || diagnostic.code !== 'PartialParse') return false
  return /^unrecognized native record (task_started|world_state|item_completed|thread_settings_applied|mcp_tool_call_end|patch_apply_end)$/.test(diagnostic.message)
    || diagnostic.message === 'tool arguments are not valid JSON'
    || /^tool call \S+ has no recorded result$/.test(diagnostic.message)
}
function sourceKey(ref: SessionRef): string {
  return digest(JSON.stringify([ref.provider, ref.id, ref.source]))
}
export function messagesOf(session: Session): ConversationMessage[] {
  return conversationOf(session).map(event => ({
    timestamp: timestamp(event.timestamp),
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
export async function archiveWorkspace(config: Config, collector: Collector = sessions, summaryModel?: SummaryModel): Promise<ArchiveReport> {
  const directory = join(config.outputDir, `${basename(config.workspace) || 'workspace'}-${workspaceId(config.workspace)}`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const unlock = await acquireLock(join(directory, '.lock'))
  const report: ArchiveReport = { archived: 0, unchanged: 0, skipped: 0, failures: [], warnings: [], files: [] }
  try {
    const model = summaryModel ?? createSummaryModel(config.summary)
    const summarySettings = digest(JSON.stringify(config.summary || 'injected-model'))
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
        const blocking = session.diagnostics.filter(diagnostic => !isNonConversationDiagnostic(session.provider, diagnostic))
        if (blocking.length > 0) {
          const details = redactSecrets(blocking.slice(0, 3).map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('; ')).content
          report.failures.push(`${ref.provider}/${ref.id}: ${details}; existing archive preserved, retrying on the next run`)
          continue
        }
        if (session.diagnostics.length > 0) {
          report.warnings.push(`${ref.provider}/${ref.id}: ${session.diagnostics.length} non-conversation parse diagnostics; summarizing available text messages`)
        }
        const conversations = messagesOf(session)
        if (!conversations.length) { report.skipped++; continue }
        const key = sourceKey(ref)
        const changedFiles = fileChangesOf(session).map(event => event.data.path)
        const fingerprint = digest(JSON.stringify([summarySettings, conversations, changedFiles, session.title, session.workspace, session.createdAt, session.updatedAt]))
        const previous = state.entries[key]
        const file = `${key}.md`
        if (previous?.fingerprint === fingerprint && previous.formatVersion === ARCHIVE_FORMAT_VERSION) {
          try { await stat(join(directory, file)); report.unchanged++; continue }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        }
        const createdAt = timestamp(session.createdAt) ?? previous?.createdAt ?? new Date().toISOString()
        const summary = await summarizeConversation(conversations, model, config.summary?.maxInputChars)
        const markdown = redactSecrets(generateMarkdown({
          title: summary.title,
          goal: summary.goal,
          outcome: summary.outcome,
          investigation: summary.investigation,
          keyDecisions: summary.keyDecisions,
          rejectedApproaches: summary.rejectedApproaches,
          followUps: summary.followUps,
          changedAreas: [...new Set(changedFiles)],
          meta: {
            id: key, workspace: config.workspace, project: basename(config.workspace),
            createdAt, tags: [session.provider], sourceConversationCount: 1,
            repository: session.workspace?.repository, branch: session.workspace?.branch,
          },
        }) + '\n## Requirements\n\n' + summary.requirements + '\n\n## Interaction Summary\n\n' + summary.interaction + '\n').content
        await atomicWrite(join(directory, file), markdown)
        state.entries[key] = { fingerprint, file, createdAt, formatVersion: ARCHIVE_FORMAT_VERSION }
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
