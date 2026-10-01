// 登录/注册页面
// 左侧: Logo + 主文案，右侧: 表单
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useAuthStore } from '@/lib/store'
import { login, register } from '@/lib/api'

type Mode = 'login' | 'register'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result =
        mode === 'login'
          ? await login(username, password)
          : await register(username, email, password, displayName)
      setAuth(result.token, result.user)
      navigate('/workspaces')
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[#0f1117]">
      {/* ── 左侧 Panel ── */}
      <div className="hidden flex-col justify-between p-12 lg:flex lg:w-1/2 border-r border-[#30363d]">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold tracking-tight text-white">Loom</span>
          <span className="rounded-full border border-[#30363d] px-2 py-0.5 text-xs text-slate-500">
            beta
          </span>
        </div>

        <div className="max-w-md">
          <blockquote className="mb-6">
            <p className="text-4xl font-semibold leading-tight tracking-tight text-white">
              Keep the work,
              <br />
              <span className="text-[#58a6ff]">not the chat.</span>
            </p>
          </blockquote>
          <p className="text-base text-slate-400 leading-relaxed">
            Loom 是构建在 DeepSeek Harness 之上的轻量团队协作与项目记忆层。
            自动生成 Work Records，让知识留存在项目而不是聊天记录里。
          </p>

          {/* 特性列表 */}
          <ul className="mt-8 space-y-3">
            {[
              { icon: '📝', text: 'Work Records — AI 自动提炼工作记忆' },
              { icon: '👁', text: 'Live Observe — 实时观看团队工作流' },
              { icon: '🔍', text: 'Project Memory — 全文搜索项目知识库' },
              { icon: '🔒', text: 'Privacy First — E2EE 加密，本地优先' },
            ].map(({ icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-slate-400">
                <span className="text-base">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-600">
          © {new Date().getFullYear()} Loom. Built on DeepSeek Harness.
        </p>
      </div>

      {/* ── 右侧 Panel — 表单 ── */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* 移动端 Logo */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="text-xl font-bold text-white">Loom</span>
          </div>

          <h2 className="mb-1 text-2xl font-semibold text-white">
            {mode === 'login' ? '欢迎回来' : '创建账号'}
          </h2>
          <p className="mb-6 text-sm text-slate-500">
            {mode === 'login'
              ? '登录你的 Loom 账号继续工作'
              : '加入 Loom，开始记录你的工作'}
          </p>

          {/* 错误提示 */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                用户名
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-[#58a6ff] focus:outline-none focus:ring-1 focus:ring-[#58a6ff]/40 transition-colors"
                placeholder="your_username"
              />
            </div>

            {mode === 'register' && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    显示名称
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-[#58a6ff] focus:outline-none focus:ring-1 focus:ring-[#58a6ff]/40 transition-colors"
                    placeholder="Your Name"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-[#58a6ff] focus:outline-none focus:ring-1 focus:ring-[#58a6ff]/40 transition-colors"
                    placeholder="you@example.com"
                  />
                </div>
              </>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                密码
              </label>
              <input
                type="password"
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-[#58a6ff] focus:outline-none focus:ring-1 focus:ring-[#58a6ff]/40 transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#238636] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2ea043] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? '请稍候...'
                : mode === 'login'
                  ? '登录'
                  : '创建账号'}
            </button>
          </form>

          {/* 切换模式 */}
          <p className="mt-6 text-center text-sm text-slate-500">
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError('')
              }}
              className="ml-1 text-[#58a6ff] hover:underline"
            >
              {mode === 'login' ? '注册' : '登录'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
