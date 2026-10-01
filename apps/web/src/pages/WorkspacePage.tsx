import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router'
import { listProjects } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

export default function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const org = useAuthStore((s) => s.currentOrg)

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(workspaceId!),
    enabled: !!workspaceId,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500 text-sm">Loading projects...</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-100">Projects</h1>
        <p className="text-slate-500 text-sm mt-1">Select a project to view its work records and active sessions.</p>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-700 rounded-lg">
          <p className="text-slate-500">No projects yet.</p>
          <p className="text-slate-600 text-sm mt-1">Create a project via the CLI: <code className="text-slate-400">loom init</code></p>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/w/${workspaceId}/p/${project.id}`}
              className="block p-4 bg-slate-800 border border-slate-700 rounded-lg hover:border-slate-500 hover:bg-slate-750 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-slate-100 font-medium">{project.name}</h3>
                  {project.description && (
                    <p className="text-slate-500 text-sm mt-0.5">{project.description}</p>
                  )}
                </div>
                <span className="text-slate-600 text-xs mt-0.5">/{project.slug}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
