// Workspaces 列表页 — 列出所有可访问的 workspace
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { listOrganizations, listWorkspaces } from '@/lib/api'
import type { Workspace, Organization } from '@loom/protocol'
import { format } from 'date-fns'

export default function WorkspacesPage() {
  const navigate = useNavigate()

  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: listOrganizations,
  })

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Workspaces</h1>
        <p className="mt-1 text-sm text-slate-500">
          选择一个 Workspace 开始工作
        </p>
      </header>

      {orgsLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-[#58a6ff]" />
          加载中...
        </div>
      )}

      <div className="space-y-6">
        {orgs?.map((org) => (
          <OrgSection key={org.id} org={org} onSelect={(ws) => navigate(`/w/${ws.id}`)} />
        ))}
        {!orgsLoading && (!orgs || orgs.length === 0) && (
          <EmptyState />
        )}
      </div>
    </div>
  )
}

function OrgSection({
  org,
  onSelect,
}: {
  org: Organization
  onSelect: (ws: Workspace) => void
}) {
  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['workspaces', org.id],
    queryFn: () => listWorkspaces(org.id),
  })

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium text-slate-400">{org.name}</h2>
        <span className="text-xs text-slate-600">· {org.slug}</span>
      </div>

      {isLoading && (
        <p className="text-xs text-slate-600">加载中...</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces?.map((ws) => (
          <button
            key={ws.id}
            onClick={() => onSelect(ws)}
            className="group rounded-lg border border-[#30363d] bg-[#1c2128] p-5 text-left transition-all hover:border-[#58a6ff]/60 hover:bg-[#212830]"
          >
            <div className="mb-2 flex items-start justify-between">
              <h3 className="font-semibold text-slate-100 group-hover:text-white">
                {ws.name}
              </h3>
              {/* 进入箭头 */}
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-600 transition-colors group-hover:text-[#58a6ff]"
                fill="none"
                viewBox="0 0 16 16"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m5.75 5.75 4.5 2.25-4.5 2.25" />
              </svg>
            </div>
            {ws.description && (
              <p className="mb-3 text-xs leading-relaxed text-slate-500 line-clamp-2">
                {ws.description}
              </p>
            )}
            <p className="text-[11px] text-slate-600">
              创建于 {format(new Date(ws.createdAt), 'yyyy-MM-dd')}
            </p>
          </button>
        ))}
      </div>
    </section>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-[#30363d] p-12 text-center">
      <p className="text-sm text-slate-500">暂无可访问的 Workspace</p>
      <p className="mt-1 text-xs text-slate-600">
        请联系管理员将你添加到一个 Workspace
      </p>
    </div>
  )
}
