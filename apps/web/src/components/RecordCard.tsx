// Work Record 列表项
import type { RecordIndex } from '@loom/protocol'
import { format } from 'date-fns'
import clsx from 'clsx'

interface Props {
  record: RecordIndex
  onClick: (record: RecordIndex) => void
}

export default function RecordCard({ record, onClick }: Props) {
  // tags 和 changedAreas 在 RecordIndex 中是 JSON 字符串
  let tags: string[] = []
  let changedAreas: string[] = []
  try {
    tags = JSON.parse(record.tags)
  } catch {
    tags = []
  }
  try {
    changedAreas = JSON.parse(record.changedAreas)
  } catch {
    changedAreas = []
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(record)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(record)}
      className="cursor-pointer rounded-lg border border-[#30363d] bg-[#1c2128] p-4 transition-colors hover:border-slate-600 hover:bg-[#212830]"
    >
      {/* 标题行 */}
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <h3 className="flex-1 text-sm font-semibold text-slate-100 leading-snug">
          {record.title}
        </h3>
        <time className="flex-shrink-0 text-xs text-slate-500">
          {format(new Date(record.createdAt), 'yyyy-MM-dd')}
        </time>
      </div>

      {/* 元信息行 */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {record.repository && (
          <span className="truncate max-w-[160px]">{record.repository}</span>
        )}
        {record.branch && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-slate-400">
            {record.branch}
          </span>
        )}
        {record.finalCommit && (
          <span className="font-mono text-slate-600">
            {record.finalCommit.slice(0, 7)}
          </span>
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className={clsx(
                'rounded-full border border-[#30363d] px-2 py-0.5 text-[11px] font-medium',
                'text-[#58a6ff] bg-[#58a6ff]/10',
              )}
            >
              {tag}
            </span>
          ))}
          {changedAreas.slice(0, 3).map((area) => (
            <span
              key={area}
              className="rounded-full border border-[#30363d] px-2 py-0.5 text-[11px] text-slate-500"
            >
              {area}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
