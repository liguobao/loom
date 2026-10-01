import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router'
import { getRecord } from '@/lib/api'

export default function RecordDetailPage() {
  const { workspaceId, projectId, recordId } = useParams<{
    workspaceId: string
    projectId: string
    recordId: string
  }>()

  const { data, isLoading, error } = useQuery({
    queryKey: ['record', recordId],
    queryFn: () => getRecord(recordId!),
    enabled: !!recordId,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500 text-sm">Loading record...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-red-400 text-sm">Failed to load record.</p>
        <Link
          to={`/w/${workspaceId}/p/${projectId}`}
          className="text-blue-400 text-sm hover:underline mt-2 inline-block"
        >
          ← Back to project
        </Link>
      </div>
    )
  }

  const meta = (data as any).meta ?? data
  const content: string = (data as any).content ?? ''

  // 解析 Markdown sections
  const sections = parseMarkdownSections(content)

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link to={`/w/${workspaceId}/p/${projectId}`} className="hover:text-slate-300">
          ← Back
        </Link>
      </div>

      <div className="flex gap-8">
        {/* 主内容区 */}
        <main className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-slate-100 mb-6">
            {meta.title}
          </h1>

          {sections.map(({ heading, content: body }) => (
            body.trim() ? (
              <section key={heading} className="mb-6">
                <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  {heading}
                </h2>
                <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                  {body.trim()}
                </div>
              </section>
            ) : null
          ))}

          {/* 原始 Markdown */}
          {sections.length === 0 && content && (
            <pre className="text-slate-300 text-sm whitespace-pre-wrap bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              {content}
            </pre>
          )}
        </main>

        {/* 元数据 sidebar */}
        <aside className="w-56 shrink-0">
          <div className="sticky top-6 space-y-4 text-sm">
            <MetaItem label="Owner" value={meta.ownerId ?? meta.owner} />
            <MetaItem
              label="Created"
              value={meta.createdAt ? new Date(meta.createdAt).toLocaleDateString() : undefined}
            />
            {meta.repository && (
              <MetaItem label="Repository" value={meta.repository} />
            )}
            {meta.branch && (
              <MetaItem label="Branch" value={meta.branch} />
            )}
            {meta.finalCommit && (
              <MetaItem
                label="Commit"
                value={
                  <a
                    href={`https://github.com/${meta.repository}/commit/${meta.finalCommit}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline font-mono"
                  >
                    {String(meta.finalCommit).slice(0, 7)}
                  </a>
                }
              />
            )}
            {meta.tags && (
              <div>
                <div className="text-slate-500 text-xs uppercase tracking-wider mb-1">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {String(meta.tags).split(',').filter(Boolean).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-blue-900/40 text-blue-300 rounded text-xs"
                    >
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value) return null
  return (
    <div>
      <div className="text-slate-500 text-xs uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-slate-300">{value}</div>
    </div>
  )
}

// 解析 Markdown 中的 ## 级标题和内容
function parseMarkdownSections(markdown: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = []
  // 去掉 front matter
  const body = markdown.replace(/^---[\s\S]*?---\n?/, '')
  // 去掉 # 标题行
  const withoutTitle = body.replace(/^# .+\n?/m, '')

  const parts = withoutTitle.split(/^## (.+)$/m)
  for (let i = 1; i < parts.length; i += 2) {
    sections.push({
      heading: parts[i]!.trim(),
      content: (parts[i + 1] ?? '').trim(),
    })
  }
  return sections
}
