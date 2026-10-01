import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { useAuthStore } from '@/lib/store'
import LoginPage from '@/pages/LoginPage'
import WorkspacesPage from '@/pages/WorkspacesPage'
import WorkspacePage from '@/pages/WorkspacePage'
import ProjectPage from '@/pages/ProjectPage'
import RecordDetailPage from '@/pages/RecordDetailPage'
import Layout from '@/components/Layout'

// 受保护路由：未登录则跳转到 /login
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn())
  if (!isLoggedIn) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />

        {/* 受保护路由 — 包裹在 Layout 内 */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* / 重定向到 /workspaces */}
          <Route index element={<Navigate to="/workspaces" replace />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/w/:workspaceId" element={<WorkspacePage />} />
          <Route path="/w/:workspaceId/p/:projectId" element={<ProjectPage />} />
          <Route
            path="/w/:workspaceId/p/:projectId/records/:recordId"
            element={<RecordDetailPage />}
          />
        </Route>

        {/* 兜底 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
