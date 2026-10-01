// 应用整体布局 — 左侧导航栏 + 主内容区
import { Outlet, NavLink, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/store'
import { listOrganizations, listWorkspaces } from '@/lib/api'
import clsx from 'clsx'

export default function Layout() {
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate = useNavigate()

  // 获取 org 列表，取第一个 org 的 workspace
  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: listOrganizations,
  })

  const firstOrgId = orgs?.[0]?.id

  const { data: workspaces } = useQuery({
    queryKey: ['workspaces', firstOrgId],
    queryFn: () => listWorkspaces(firstOrgId!),
    enabled: !!firstOrgId,
  })

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-200">
      {/* ── 左侧导航栏 220px ── */}
      <aside className="flex w-[220px] flex-shrink-0 flex-col border-r border-[#30363d] bg-[#161b22]">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b border-[#30363d] px-4">
          <span className="text-lg font-bold tracking-tight text-white">Loom</span>
          <span className="text-xs text-slate-500">β</span>
        </div>

        {/* Workspaces 列表 */}
        <nav className="flex-1 overflow-y-auto py-3">
          <p className="mb-1 px-4 text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Workspaces
          </p>
          {workspaces?.map((ws) => (
            <NavLink
              key={ws.id}
              to={`/w/${ws.id}`}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2 px-4 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200',
                )
              }
            >
              <span className="truncate">{ws.name}</span>
            </NavLink>
          ))}

          {/* 所有 workspaces 入口 */}
          <NavLink
            to="/workspaces"
            className={({ isActive }) =>
              clsx(
                'mt-1 flex items-center gap-2 px-4 py-1.5 text-sm transition-colors',
                isActive
                  ? 'text-[#58a6ff]'
                  : 'text-slate-500 hover:text-slate-300',
              )
            }
          >
            ＋ All Workspaces
          </NavLink>
        </nav>

        {/* 底部用户信息 */}
        <div className="border-t border-[#30363d] p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#58a6ff] text-xs font-bold text-white">
              {user?.displayName?.charAt(0).toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-200">
                {user?.displayName}
              </p>
              <p className="truncate text-xs text-slate-500">{user?.username}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          >
            登出
          </button>
        </div>
      </aside>

      {/* ── 主内容区 ── */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
