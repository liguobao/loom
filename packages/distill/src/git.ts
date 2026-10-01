import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitContext } from './distill.js'

const execAsync = promisify(exec)

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

/**
 * 在指定目录执行 git 命令，返回标准输出字符串。
 * 出错时返回 undefined（git 不可用、不在仓库内等情况）。
 */
async function runGit(cwd: string, args: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`git ${args}`, {
      cwd,
      timeout: 5000, // 防止挂起
      env: {
        ...process.env,
        // 避免 git pager 输出 ANSI 控制字符
        GIT_PAGER: 'cat',
        TERM: 'dumb',
      },
    })
    return stdout.trim()
  } catch {
    return undefined
  }
}

// ──────────────────────────────────────────────
// 公开 API
// ──────────────────────────────────────────────

/**
 * 读取当前目录的 git 综合信息，组装为 GitContext。
 *
 * 若 cwd 不在 git 仓库内，各字段返回 undefined / 空数组。
 */
export async function getGitContext(cwd: string): Promise<GitContext> {
  const [repository, branch, finalCommit, commits] = await Promise.all([
    getRemoteUrl(cwd),
    getCurrentBranch(cwd),
    getHeadCommit(cwd),
    getRecentCommits(cwd, 10),
  ])

  return {
    repository,
    branch,
    finalCommit,
    commitMessages: commits,
    // baseCommit 和 changedFiles 需要调用方提供基准 ref，此处留空
    changedFiles: [],
  }
}

/**
 * 获取最近 N 个 commit 的单行描述（`git log --oneline -N`）。
 *
 * @param n 默认 10
 */
export async function getRecentCommits(cwd: string, n = 10): Promise<string[]> {
  const out = await runGit(cwd, `log --oneline -${n}`)
  if (!out) return []
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * 获取两个 ref 之间修改的文件列表（`git diff --name-only baseRef headRef`）。
 *
 * @param baseRef 基准 commit/tag/branch
 * @param headRef 目标 commit，默认 HEAD
 */
export async function getChangedFiles(
  cwd: string,
  baseRef: string,
  headRef: string,
): Promise<string[]> {
  const out = await runGit(cwd, `diff --name-only ${baseRef} ${headRef}`)
  if (!out) return []
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * 获取当前 remote origin 的 URL。
 *
 * 自动将 SSH 格式（`git@github.com:org/repo.git`）转换为 `org/repo` 风格。
 */
export async function getRemoteUrl(cwd: string): Promise<string | undefined> {
  const out = await runGit(cwd, 'remote get-url origin')
  if (!out) return undefined

  // SSH 格式转换: git@github.com:org/repo.git → org/repo
  const sshMatch = out.match(/git@[^:]+:(.+?)(?:\.git)?$/)
  if (sshMatch) return sshMatch[1]

  // HTTPS 格式转换: https://github.com/org/repo.git → org/repo
  const httpsMatch = out.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/)
  if (httpsMatch) return httpsMatch[1]

  return out
}

/**
 * 获取当前分支名（`git rev-parse --abbrev-ref HEAD`）。
 *
 * 处于 detached HEAD 状态时返回 undefined。
 */
export async function getCurrentBranch(cwd: string): Promise<string | undefined> {
  const out = await runGit(cwd, 'rev-parse --abbrev-ref HEAD')
  if (!out || out === 'HEAD') return undefined
  return out
}

/**
 * 获取当前 HEAD 的完整 commit hash（40 位）。
 */
export async function getHeadCommit(cwd: string): Promise<string | undefined> {
  return runGit(cwd, 'rev-parse HEAD')
}
