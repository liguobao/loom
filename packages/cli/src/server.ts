import { createServer, type Server } from 'node:http'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { archiveDirectory, digest, findConfigPath, loomHome, resolveWorkspace } from './config.js'

interface Workspace { id: string; name: string; path?: string; directory: string; files: Document[] }
interface Document { name: string; title: string; updated: string }
export interface ServeOptions { port?: number; workspace?: string; outputDir?: string; configPath?: string; home?: string }
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
async function entries(path: string) {
  try { return await readdir(path, { withFileTypes: true }) } catch (error) { if (missing(error)) return []; throw error }
}
function metadata(markdown: string, field: string): string | undefined {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1]
  const value = front?.split('\n').find(line => line.startsWith(`${field}:`))?.slice(field.length + 1).trim()
  if (!value) return undefined
  if (value.startsWith('"')) { try { const parsed = JSON.parse(value); return typeof parsed === 'string' ? parsed : undefined } catch { return undefined } }
  return value.replace(/^'|'$/g, '').replace(/''/g, "'")
}
function titleOf(markdown: string, name: string) {
  return metadata(markdown, 'title') || /^#\s+(.+)$/m.exec(markdown)?.[1] || name
}
async function catalog(options: ServeOptions): Promise<Workspace[]> {
  const home = options.home || loomHome()
  const roots = new Set<string>(options.configPath && !options.outputDir ? [] : [resolve(options.outputDir || process.env.LOOM_STORAGE_DIR || join(home, 'records'))])
  const known = new Map<string, { name: string; path: string }>()
  const configs = options.configPath ? [options.configPath] : (await entries(join(home, 'workspaces')))
    .filter(entry => entry.isDirectory()).map(entry => join(home, 'workspaces', entry.name, 'config.json'))
  for (const file of configs) {
    try {
      const config = JSON.parse(await readFile(file, 'utf8'))
      if (typeof config.workspace !== 'string' || typeof config.outputDir !== 'string') continue
      const workspace = resolve(dirname(file), config.workspace)
      const output = resolve(options.outputDir || resolve(dirname(file), config.outputDir))
      if (!options.outputDir) roots.add(output)
      const name = basename(workspace) || 'workspace'
      known.set(archiveDirectory({ workspace, outputDir: output, archiveLayout: config.archiveLayout }), { name, path: workspace })
    } catch (error) {
      if (options.configPath) throw error
      // One stale or malformed workspace config must not hide the other archives.
    }
  }
  const directories = new Set<string>(known.keys())
  for (const root of roots) {
    const children = await entries(root)
    if (children.some(entry => entry.isFile() && !entry.name.startsWith('.') && entry.name.toLowerCase().endsWith('.md'))) directories.add(root)
    for (const entry of children) if (entry.isDirectory() && !entry.name.startsWith('.')) directories.add(join(root, entry.name))
  }
  const workspaces: Workspace[] = []
  for (const directory of directories) {
    const files: Document[] = []
    let path = known.get(directory)?.path
    for (const entry of await entries(directory)) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md') || entry.name.startsWith('.')) continue
      try {
        const file = join(directory, entry.name)
        const markdown = await readFile(file, 'utf8')
        path ||= metadata(markdown, 'workspace')
        files.push({ name: entry.name, title: titleOf(markdown, entry.name), updated: (await stat(file)).mtime.toISOString() })
      } catch (error) { if (!missing(error)) throw error }
    }
    files.sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name))
    workspaces.push({ id: digest(directory).slice(0, 24), name: known.get(directory)?.name || (path ? basename(path) : basename(directory)), path, directory, files })
  }
  return workspaces.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
// Escape first: archive HTML is displayed as text, never executed. Links are limited to HTTP(S).
function inline(text: string): string {
  return escape(text).replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
}
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n/)
  const html: string[] = []
  let code: string[] | undefined
  let fence = ''
  let paragraph: string[] = []
  let list: 'ul' | 'ol' | undefined
  const flush = () => { if (paragraph.length) { html.push(`<p>${inline(paragraph.join('\n'))}</p>`); paragraph = [] } }
  const closeList = () => { if (list) { html.push(`</${list}>`); list = undefined } }
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (code) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) { html.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); code = undefined }
      else code.push(line)
      continue
    }
    if (marker) { flush(); closeList(); code = []; fence = marker; continue }
    if (!line.trim()) { flush(); closeList(); continue }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    const item = /^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line)
    if (heading) { flush(); closeList(); html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`) }
    else if (item) { flush(); const kind = item[1] ? 'ul' : 'ol'; if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind }; html.push(`<li>${inline(item[2])}</li>`) }
    else if (/^>\s?/.test(line)) { flush(); closeList(); html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`) }
    else { closeList(); paragraph.push(line) }
  }
  flush(); closeList()
  if (code) html.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`)
  return html.join('\n')
}
function page(title: string, content: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Loom</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:1000px;margin:0 auto;padding:28px 24px;line-height:1.7}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #8885;padding-bottom:16px;margin-bottom:28px}a{color:#4385d0;text-decoration:none}a:hover{text-decoration:underline}.muted{color:#888;font-size:.9rem;overflow-wrap:anywhere}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.card{border:1px solid #8885;border-radius:12px;padding:20px}.card h2{margin:0 0 8px;font-size:1.2rem}.documents{list-style:none;padding:0}.documents li{padding:16px 0;border-bottom:1px solid #8884}.documents a{font-size:1.1rem}article{overflow-wrap:anywhere}pre{padding:16px;background:#8881;border:1px solid #8883;border-radius:8px;overflow:auto;white-space:pre-wrap}code{font-family:ui-monospace,monospace;font-size:.9em}p{white-space:pre-wrap}blockquote{border-left:3px solid #8886;margin-left:0;padding-left:16px}summary{cursor:pointer}h1{line-height:1.3}nav{margin-bottom:24px}
</style></head><body><header><a href="/">Loom · 工作记录</a><a href="">刷新</a></header>${content}<footer class="muted">本地只读浏览 · ${escape(title)}</footer></body></html>`
}
export async function startArchiveServer(options: ServeOptions = {}): Promise<Server> {
  const port = options.port ?? 8787
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer between 0 and 65535')
  if (!options.configPath && !options.outputDir && (!options.home || options.workspace)) {
    const workspace = await resolveWorkspace(options.workspace || process.cwd())
    const configPath = await findConfigPath(workspace, options.home)
    if (configPath) options = { ...options, configPath }
  }
  await catalog(options)
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    const send = (status: number, title: string, content: string) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page(title, content)) }
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) { send(403, '请求无效', '<h1>请通过本机地址访问</h1>'); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); send(405, '不支持的请求', '<h1>只支持读取文档</h1>'); return }
    try {
      const parts = new URL(req.url || '/', 'http://localhost').pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (parts.length && (parts[0] !== 'workspaces' || parts.length < 2 || parts.length > 3)) { send(404, '未找到', '<h1>页面不存在</h1>'); return }
      const workspaces = await catalog(options)
      if (!parts.length) {
        send(200, '工作区', `<h1>工作区</h1><p class="muted">${workspaces.length} 个工作区 · ${workspaces.reduce((n, w) => n + w.files.length, 0)} 篇文档</p><div class="cards">${workspaces.map(w => `<section class="card"><h2><a href="/workspaces/${w.id}">${escape(w.name)}</a></h2><div class="muted">${escape(w.path || w.directory)}</div><p>${w.files.length} 篇 Markdown 文档</p></section>`).join('')}</div>${workspaces.length ? '' : '<p>暂无归档。运行 loom init 和 loom archive，或使用 loom serve --output 指定已有归档目录。</p>'}`)
        return
      }
      const workspace = workspaces.find(w => w.id === parts[1])
      if (!workspace) { send(404, '未找到', '<h1>工作区不存在</h1>'); return }
      const nav = `<nav><a href="/">工作区</a> / <a href="/workspaces/${workspace.id}">${escape(workspace.name)}</a></nav>`
      if (parts.length === 2) {
        send(200, workspace.name, `${nav}<h1>${escape(workspace.name)}</h1><p class="muted">${escape(workspace.path || workspace.directory)}</p><ul class="documents">${workspace.files.map(f => `<li><a href="/workspaces/${workspace.id}/${encodeURIComponent(f.name)}">${escape(f.title)}</a><div class="muted">${escape(f.name)} · ${escape(f.updated)}</div></li>`).join('')}</ul>${workspace.files.length ? '' : '<p>这个工作区还没有 Markdown 文档。</p>'}`)
        return
      }
      const file = workspace.files.find(f => f.name === parts[2])
      if (!file) { send(404, '未找到', '<h1>文档不存在</h1>'); return }
      // Recheck real paths before reading to reject symlinks swapped in after listing.
      const directory = await realpath(workspace.directory)
      const path = join(directory, file.name)
      if (await realpath(path) !== path) { send(404, '未找到', '<h1>文档不存在</h1>'); return }
      const markdown = await readFile(path, 'utf8')
      send(200, file.title, `${nav}<p class="muted">${escape(file.name)} · ${escape(file.updated)}</p><article>${renderMarkdown(markdown)}</article><details><summary>查看 Markdown 原文</summary><pre>${escape(markdown)}</pre></details>`)
    } catch (error) {
      if (error instanceof URIError) send(400, '请求无效', '<h1>请求地址无效</h1>')
      else if (missing(error)) send(404, '未找到', '<h1>文档不存在，请刷新列表</h1>')
      else { console.error('loom server:', error); send(500, '读取失败', '<h1>无法读取归档目录</h1>') }
    }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
  return server
}
