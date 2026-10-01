// 搜索框，支持 debounce
import { useEffect, useRef, useState } from 'react'

interface Props {
  placeholder?: string
  onSearch: (q: string) => void
  delay?: number // 默认 300ms
}

export default function SearchBar({
  placeholder = 'Search...',
  onSearch,
  delay = 300,
}: Props) {
  const [value, setValue] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onSearch(value.trim())
    }, delay)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, delay, onSearch])

  return (
    <div className="relative">
      {/* 搜索图标 */}
      <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#30363d] bg-[#161b22] py-2 pl-9 pr-4 text-sm text-slate-200 placeholder:text-slate-600 focus:border-[#58a6ff] focus:outline-none focus:ring-1 focus:ring-[#58a6ff]/50 transition-colors"
      />
    </div>
  )
}
