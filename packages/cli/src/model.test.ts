import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSummaryModel, validateSummaryConfig } from './model.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function executable(code: string) {
  const directory = await mkdtemp(join(tmpdir(), 'loom-local-agent-'))
  directories.push(directory)
  const path = join(directory, 'fake-agent')
  const trace = join(directory, 'trace.jsonl')
  await writeFile(path, `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst trace = ${JSON.stringify(trace)};\n${code}`, { mode: 0o700 })
  return { path, trace }
}
describe('local summary backends', () => {
  it('rejects cloud providers and requires a startup selection', () => {
    expect(() => validateSummaryConfig({ provider: 'deepseek' })).toThrow('codex-server or dsh')
    expect(() => createSummaryModel(undefined)).toThrow('--summarizer codex-server')
  })
  it.skipIf(process.platform === 'win32')('drives Codex app-server initialize, ephemeral thread and summary turn over stdio', async () => {
    const { path, trace } = await executable(`
const rl = require('node:readline').createInterface({input:process.stdin});
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
rl.on('line', line => {
  fs.appendFileSync(trace, line+'\\n');
  const request = JSON.parse(line);
  if (request.method === 'initialize') send({id:request.id,result:{}});
  if (request.method === 'thread/start') send({id:request.id,result:{thread:{id:'summary-thread'}}});
  if (request.method === 'turn/start') {
    send({id:request.id,result:{turn:{id:'turn-1'}}});
    send({method:'item/completed',params:{threadId:'summary-thread',item:{type:'agentMessage',text:'semantic summary'}}});
    send({method:'turn/completed',params:{threadId:'summary-thread',turn:{status:'completed'}}});
  }
});`)
    const model = createSummaryModel({ provider: 'codex-server', command: path })
    expect(await model('Summarize requirements', 'All conversation turns')).toBe('semantic summary')
    const requests = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(requests.map(request => request.method)).toEqual(['initialize', 'initialized', 'thread/start', 'turn/start'])
    expect(requests[2].params).toMatchObject({ ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' })
    expect(requests[3].params.input[0].text).toBe('All conversation turns')
  })
  it.skipIf(process.platform === 'win32')('passes DSH headless prompts by stdin and only uses the successful final event', async () => {
    const { path, trace } = await executable(`
let input='';process.stdin.on('data', chunk => {input+=chunk});
process.stdin.on('end', () => {
  fs.writeFileSync(trace,JSON.stringify({args:process.argv.slice(2),input}));
  process.stdout.write(JSON.stringify({type:'text',text:'intermediate output'})+'\\n');
  process.stdout.write(JSON.stringify({type:'final',text:'semantic DSH summary'})+'\\n');
});`)
    const model = createSummaryModel({ provider: 'dsh', command: path, profile: 'loom-summary' })
    expect(await model('Summarize', 'User corrections')).toBe('semantic DSH summary')
    const captured = JSON.parse(await readFile(trace, 'utf8'))
    expect(captured.args).toEqual(['--profile', 'loom-summary', '--json'])
    expect(captured.input).toContain('User corrections')
  })
  it.skipIf(process.platform === 'win32')('fails missing executables, nonzero exits and timeouts', async () => {
    await expect(createSummaryModel({ provider: 'dsh', command: '/nonexistent/loom-agent' })('S', 'I')).rejects.toThrow('Cannot start')
    const failed = await executable("process.stdout.write(JSON.stringify({type:'final',text:'unverified'})+'\\n');process.exit(1)")
    await expect(createSummaryModel({ provider: 'dsh', command: failed.path })('S', 'I')).rejects.toThrow('failed')
    const stalled = await executable('setInterval(()=>{},1000)')
    await expect(createSummaryModel({ provider: 'dsh', command: stalled.path, timeoutSeconds: 1 })('S', 'I')).rejects.toThrow('timed out')
  })
})
