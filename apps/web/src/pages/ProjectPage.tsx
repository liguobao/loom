import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router'
import { listProjectRecords, listProjectActiveWork, searchRecords } from '@/lib/api'
import SearchBar from '@/components/SearchBar'
import ActiveWorkCard from '@/components/ActiveWorkCard'
import RecordCard from '@/components/RecordCard'
import type { RecordIndex } from '@loom/protocol'

export default function ProjectPage() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')

  // Active Work (轮询，15s 刷新)
  const { data: activeWorks = [] } = useQuery({
    queryKey: ['active-work', projectId],
    queryFn: () => listProjectActiveWork(projectId!),
    enabled: !!projectId,
    refetchInterval: 15_000,
  })

  // Work Records
  const { data: recordsData, isLoading: recordsLoading } = useQuery({
    queryKey: ['records', projectId],
    queryFn: () => listProjectRecords(projectId!, { limit: 20 }),
    enabled: !!projectId && !searchQuery,
  })

  // Search
  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['search', projectId, searchQuery],
    queryFn: () => searchRecords(searchQuery, projectId),
    enabled: !!searchQuery && searchQuery.length >= 2,
  })

  const records: RecordIndex[] = searchQuery
    ? (searchData as RecordIndex[] | undefined) ?? []
    : (recordsData as RecordIndex[] | undefined) ?? []

  const isLoading = searchQuery ? searchLoading : recordsLoading

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q)
  }, [])

  const handleRecordClick = (record: RecordIndex) => {
    navigate(`/w/${workspaceId}/p/${projectId}/records/${record.id}`)
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Active Work */}
      {activeWorks.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Active Work
          </h2>
          <div className="space-y-2">
            {activeWorks.map((work) => (
              <ActiveWorkCard
                key={work.id}
                work={work}
                onWatch={(w) => {
                  // MVP: Watch 功能占位，后续接入 E2EE Observer
                  alert(`Watch feature coming soon.\nHost: ${w.hostInstanceId}`)
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Search + Work Records */}
      <section>
        <div className="mb-4">
          <SearchBar
            placeholder="Search project memory..."
            onSearch={handleSearch}
          />
        </div>

        {searchQuery && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-slate-500 text-sm">
              {searchLoading ? 'Searching...' : `${records.length} result${records.length !== 1 ? 's' : ''} for`}
            </span>
            {!searchLoading && (
              <span className="text-slate-300 text-sm font-medium">"{searchQuery}"</span>
            )}
            <button
              onClick={() => setSearchQuery('')}
              className="ml-auto text-slate-500 hover:text-slate-300 text-xs"
            >
              ✕ Clear
            </button>
          </div>
        )}

        {!searchQuery && (
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Work Records
          </h2>
        )}

        {isLoading ? (
          <div className="text-slate-600 text-sm py-8 text-center">Loading...</div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-700 rounded-lg">
            <p className="text-slate-500 text-sm">
              {searchQuery ? 'No records match your search.' : 'No work records yet.'}
            </p>
            {!searchQuery && (
              <p className="text-slate-600 text-xs mt-2">
                Records appear here after you run <code className="text-slate-400">loom record upload</code>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                onClick={handleRecordClick}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
