// ActiveWork 实时工作卡片
import type { ActiveWork } from '@loom/protocol'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

interface Props {
  work: ActiveWork
  ownerName?: string
  hostName?: string
  onWatch: (work: ActiveWork) => void
}

export default function ActiveWorkCard({ work, ownerName, hostName, onWatch }: Props) {
  const elapsed = formatDistanceToNow(new Date(work.startedAt), {
    addSuffix: false,
    locale: zhCN,
  })

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#1c2128] p-4 transition-colors hover:border-slate-600">
      {/* 顶部：用户名 + 在线指示灯 */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* 在线绿点 */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3fb950] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#3fb950]" />
          </span>
          <span className="font-medium text-slate-200">
            {ownerName ?? work.ownerId}
          </span>
        </div>
        <button
          onClick={() => onWatch(work)}
          className="rounded border border-[#30363d] px-3 py-1 text-xs font-medium text-[#58a6ff] transition-colors hover:border-[#58a6ff] hover:bg-[#58a6ff]/10"
        >
          Watch
        </button>
      </div>

      {/* 工作标题 */}
      <p className="mb-2 font-mono text-sm text-slate-100">
        「 {work.title} 」
      </p>

      {/* 元信息行 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {work.repository && (
          <span className="truncate">{work.repository}</span>
        )}
        {hostName && <span>{hostName}</span>}
        <span>{elapsed}</span>
        {work.branch && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-slate-400">
            {work.branch}
          </span>
        )}
      </div>
    </div>
  )
}
