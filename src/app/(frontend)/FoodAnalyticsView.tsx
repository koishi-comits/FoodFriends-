'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  adminDeleteFoodLogAction,
  adminGetDashboardDataAction,
  deleteUserFoodLogAction,
  generateAnalyticsInsightAction,
  getFoodLogsAction,
  type AdminDashboardData,
  type UserSession as PublicUser,
} from './actions'

type TimeRange = 'all' | 'today' | '7d' | '30d'

export default function FoodAnalyticsView({
  user,
  onSignIn,
  onBack,
}: {
  user?: PublicUser | null
  onSignIn?: () => void
  onBack?: () => void
}) {
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  // Interactive Filters
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [selectedGroup, setSelectedGroup] = useState<string>('all')
  const [selectedUserId, setSelectedUserId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // AI Insight State
  const [aiInsight, setAiInsight] = useState<string>('')
  const [generatingInsight, setGeneratingInsight] = useState(false)

  // Delete State
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string>('')

  const isAdmin = Boolean(user?.isAdmin)

  const loadData = async () => {
    if (!user) {
      setLoading(false)
      return
    }
    setLoading(true)
    if (isAdmin) {
      const res = await adminGetDashboardDataAction()
      if (res.ok) {
        setData(res.data)
      }
    } else {
      const res = await getFoodLogsAction()
      if (res.ok) {
        setData({
          totalUsers: 1,
          totalScans: res.data.length,
          users: [],
          scans: res.data,
        })
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [user?.id, isAdmin])

  const foodGroups = [
    { key: 'fruit', label: 'Fruit', icon: '🍎', color: '#FF5C4D', bg: '#FFEFEB' },
    { key: 'vegetable', label: 'Vegetable', icon: '🥦', color: '#38A155', bg: '#E9F7EC' },
    { key: 'protein', label: 'Protein', icon: '🥩', color: '#C86432', bg: '#FDF1E8' },
    { key: 'grain', label: 'Grain', icon: '🌾', color: '#D49A00', bg: '#FFF9E5' },
    { key: 'dairy', label: 'Dairy', icon: '🥛', color: '#2B88D9', bg: '#EBF5FD' },
    { key: 'treat', label: 'Treat', icon: '🧁', color: '#A84CB2', bg: '#FAECFC' },
  ] as const

  // Map user_id -> display_name
  const userMap = useMemo(() => {
    const map: Record<string, string> = {}
    data?.users.forEach((u) => {
      map[u.id] = u.display_name || u.email || 'Explorer'
    })
    return map
  }, [data?.users])

  // Apply Time Range + User Filters first (for top-level charts)
  const timeAndUserFilteredScans = useMemo(() => {
    if (!data?.scans) return []
    const now = new Date()
    return data.scans.filter((scan) => {
      if (selectedUserId !== 'all') {
        if (selectedUserId === 'admin_guest') {
          if (scan.user_id) return false
        } else if (scan.user_id !== selectedUserId) {
          return false
        }
      }
      if (timeRange !== 'all') {
        const d = new Date(scan.created_at)
        const diffMs = now.getTime() - d.getTime()
        if (timeRange === 'today') {
          const isSameDay =
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate()
          if (!isSameDay) return false
        } else if (timeRange === '7d' && diffMs > 7 * 24 * 60 * 60 * 1000) {
          return false
        } else if (timeRange === '30d' && diffMs > 30 * 24 * 60 * 60 * 1000) {
          return false
        }
      }
      return true
    })
  }, [data?.scans, selectedUserId, timeRange])

  // Apply Category & Search filter for the detailed table & KPIs
  const filteredScans = useMemo(() => {
    return timeAndUserFilteredScans.filter((scan) => {
      if (selectedGroup !== 'all' && scan.food_group !== selectedGroup) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchName = scan.food_name.toLowerCase().includes(q)
        const matchSummary = scan.summary.toLowerCase().includes(q)
        const matchGroup = scan.food_group.toLowerCase().includes(q)
        if (!matchName && !matchSummary && !matchGroup) return false
      }
      return true
    })
  }, [timeAndUserFilteredScans, selectedGroup, searchQuery])

  const totalScans = filteredScans.length
  const avgScore =
    totalScans > 0
      ? Math.round(filteredScans.reduce((acc, s) => acc + s.score, 0) / totalScans)
      : 0

  const groupAnalytics = useMemo(() => {
    const baseTotal = timeAndUserFilteredScans.length
    return foodGroups.map((g) => {
      const matching = timeAndUserFilteredScans.filter((s) => s.food_group === g.key)
      const count = matching.length
      const pct = baseTotal > 0 ? Math.round((count / baseTotal) * 100) : 0
      const avg =
        count > 0 ? Math.round(matching.reduce((acc, s) => acc + s.score, 0) / count) : 0
      return { ...g, count, pct, avg }
    })
  }, [timeAndUserFilteredScans])

  const topCategory = useMemo(() => {
    const sorted = [...groupAnalytics].sort((a, b) => b.count - a.count)
    return sorted[0]?.count > 0 ? sorted[0] : null
  }, [groupAnalytics])

  const distinctGroupsCovered = useMemo(() => {
    return new Set(filteredScans.map((s) => s.food_group)).size
  }, [filteredScans])

  // 7-Day Daily Scan Trend
  const last7DaysTrend = useMemo(() => {
    const days: { label: string; dateStr: string; count: number; avgScore: number }[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const label = d.toLocaleDateString('en-US', { weekday: 'short' })
      const dayScans = filteredScans.filter((s) => s.created_at?.slice(0, 10) === dateStr)
      const count = dayScans.length
      const avg =
        count > 0 ? Math.round(dayScans.reduce((acc, s) => acc + s.score, 0) / count) : 0
      days.push({ label, dateStr, count, avgScore: avg })
    }
    return days
  }, [filteredScans])

  const maxDailyCount = Math.max(...last7DaysTrend.map((d) => d.count), 1)

  // Most scanned items
  const topScannedFoods = useMemo(() => {
    const frequencyMap: Record<
      string,
      { count: number; totalScore: number; group: string; image?: string }
    > = {}
    filteredScans.forEach((s) => {
      const key = s.food_name.trim().toLowerCase()
      if (!frequencyMap[key]) {
        frequencyMap[key] = {
          count: 0,
          totalScore: 0,
          group: s.food_group,
          image: s.image_url,
        }
      }
      frequencyMap[key].count += 1
      frequencyMap[key].totalScore += s.score
      if (!frequencyMap[key].image && s.image_url) {
        frequencyMap[key].image = s.image_url
      }
    })

    return Object.entries(frequencyMap)
      .map(([name, stat]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        count: stat.count,
        avgScore: Math.round(stat.totalScore / stat.count),
        group: stat.group,
        image: stat.image,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [filteredScans])

  // Nutrition Score Tiers
  const highTier = filteredScans.filter((s) => s.score >= 80).length
  const midTier = filteredScans.filter((s) => s.score >= 50 && s.score < 80).length
  const treatTier = filteredScans.filter((s) => s.score < 50).length

  const handleGenerateAiInsight = async () => {
    setGeneratingInsight(true)
    try {
      const res = await generateAnalyticsInsightAction({
        totalScans,
        avgScore,
        groupBreakdown: groupAnalytics.map((g) => ({
          label: g.label,
          count: g.count,
          pct: g.pct,
        })),
        topFoods: topScannedFoods.map((f) => `${f.name} (${f.count}x)`),
      })
      if (res.ok) {
        setAiInsight(res.data)
      } else {
        setAiInsight(`⚠️ ${res.error}`)
      }
    } finally {
      setGeneratingInsight(false)
    }
  }

  const handleDeleteScan = (scanId: string, foodName: string) => {
    setDeletingId(scanId)
    startTransition(async () => {
      const res = isAdmin
        ? await adminDeleteFoodLogAction(scanId)
        : await deleteUserFoodLogAction(scanId)
      if (res.ok) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                totalScans: Math.max(0, prev.totalScans - 1),
                scans: prev.scans.filter((s) => s.id !== scanId),
              }
            : prev
        )
        setConfirmDeleteId(null)
        setFeedback(`🗑️ Deleted "${foodName}" from scan records.`)
      } else {
        setFeedback(`⚠️ ${res.error}`)
      }
      setDeletingId(null)
    })
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-xl rounded-[32px] border border-[#E0E5DB] bg-white p-8 text-center shadow-sm sm:p-12">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#DCEBF1] text-3xl">
          📊
        </span>
        <h1 className="mt-6 text-3xl font-black text-[#173C4A]">Food Analytics</h1>
        <p className="mt-3 font-semibold text-[#6B7970]">
          Sign in to view your personal nutrition score trends, 6-color rainbow food group balance,
          and AI-powered nutrition insights!
        </p>
        {onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#287A52] px-6 py-3 text-sm font-black text-white shadow-[0_5px_0_#195F3D] transition hover:bg-[#216c47]"
          >
            Sign In to View Food Analytics
          </button>
        )}
      </div>
    )
  }

  const exportScansCSV = () => {
    if (!filteredScans.length) return
    const headers = ['ID', 'Explorer', 'Food Name', 'Food Group', 'Score', 'Summary', 'Created At']
    const rows = filteredScans.map((s) => [
      `"${s.id}"`,
      `"${(s.user_id ? userMap[s.user_id] || s.user_id : 'System Admin').replace(/"/g, '""')}"`,
      `"${s.food_name.replace(/"/g, '""')}"`,
      `"${s.food_group}"`,
      s.score,
      `"${s.summary.replace(/"/g, '""')}"`,
      `"${s.created_at}"`,
    ])
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `foodfriends_analytics_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header Banner */}
      <div className="overflow-hidden rounded-[32px] bg-[#173C4A] p-7 text-white shadow-xl sm:p-9">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#38A155] px-3.5 py-1 text-xs font-black uppercase tracking-wider text-white">
              📊 Live Nutrition Intelligence
            </span>
            <h1 className="mt-3 text-3xl font-black tracking-[-.04em] sm:text-4xl">
              Food Analytics &amp; Nutrition Insights
            </h1>
            <p className="mt-1 font-semibold text-white/75">
              Real-time food group balance, 7-day scan trends, AI nutrition analysis, and explorer
              records.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleGenerateAiInsight}
              disabled={generatingInsight || loading}
              className="rounded-2xl bg-[#38A155] px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-[#2E8B47] disabled:opacity-50"
            >
              {generatingInsight ? '🍌 Analyzing...' : '🤖 AI Nutrition Report'}
            </button>
            <button
              onClick={exportScansCSV}
              disabled={!filteredScans.length}
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-black text-white transition hover:bg-white/20 disabled:opacity-40"
            >
              📥 Export CSV ({filteredScans.length})
            </button>
            <button
              onClick={loadData}
              disabled={loading || isPending}
              className="flex items-center gap-1.5 rounded-2xl bg-white/10 px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-white/20 disabled:opacity-50"
            >
              🔄 {loading ? 'Loading...' : 'Refresh'}
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="rounded-2xl bg-[#FFD84D] px-4 py-2.5 text-xs font-extrabold text-[#3D2A1E] transition hover:bg-[#FFE073]"
              >
                Back to App
              </button>
            )}
          </div>
        </div>

        {/* AI Nutrition Report Banner */}
        {aiInsight && (
          <div className="mt-6 flex items-start justify-between gap-4 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#FFD84D] text-lg">
                🍌
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-[#FFD84D]">
                  Bananini AI Nutritionist Report
                </p>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-white/95">
                  {aiInsight}
                </p>
              </div>
            </div>
            <button
              onClick={() => setAiInsight('')}
              className="text-xs font-bold text-white/70 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Interactive Filter Controls */}
      <div className="flex flex-col gap-3 rounded-[26px] border border-[#D5E3DB] bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        {/* Time Range Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-black uppercase tracking-wider text-[#6B7A70]">
            Period:
          </span>
          {(
            [
              { id: 'all', label: 'All Time' },
              { id: 'today', label: 'Today' },
              { id: '7d', label: 'Last 7 Days' },
              { id: '30d', label: 'Last 30 Days' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTimeRange(t.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
                timeRange === t.id
                  ? 'bg-[#173C4A] text-white'
                  : 'bg-[#F2F6F3] text-[#4F6257] hover:bg-[#E4ECE6]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* User Filter + Category Reset */}
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              aria-label="Filter by Explorer"
              className="h-9 rounded-xl border border-[#D5E3DB] bg-[#FAFBF9] px-3 text-xs font-bold text-[#173C4A] outline-none"
            >
              <option value="all">👥 All Explorers ({data?.users.length || 0})</option>
              <option value="admin_guest">🛡️ System Admin / Guest</option>
              {data?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  👤 {u.display_name} ({u.email})
                </option>
              ))}
            </select>
          )}

          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            aria-label="Filter by Food Group"
            className="h-9 rounded-xl border border-[#D5E3DB] bg-[#FAFBF9] px-3 text-xs font-bold text-[#173C4A] outline-none"
          >
            <option value="all">🌈 All 6 Food Groups</option>
            {foodGroups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.icon} {g.label}
              </option>
            ))}
          </select>

          {(timeRange !== 'all' ||
            selectedGroup !== 'all' ||
            selectedUserId !== 'all' ||
            searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setTimeRange('all')
                setSelectedGroup('all')
                setSelectedUserId('all')
                setSearchQuery('')
              }}
              className="rounded-xl bg-[#FDF1EF] px-3 py-1.5 text-xs font-black text-[#B03E31] hover:bg-[#F9DDD8]"
            >
              Reset Filters ✕
            </button>
          )}
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[26px] border-2 border-[#BEE7F0] bg-white p-5 shadow-xs">
          <p className="text-[11px] font-black uppercase tracking-wider text-[#6B7A70]">
            Matching Food Scans
          </p>
          <p className="mt-2 text-3xl font-black text-[#173C4A]">{totalScans}</p>
          <p className="mt-1 text-xs font-semibold text-[#8B988F]">
            Out of {data?.scans.length || 0} total logged scans
          </p>
        </div>

        <div className="rounded-[26px] border-2 border-[#BEE7F0] bg-white p-5 shadow-xs">
          <p className="text-[11px] font-black uppercase tracking-wider text-[#6B7A70]">
            Average Health Score
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-3xl font-black text-[#173C4A]">
              {avgScore ? `${avgScore}/100` : '—'}
            </p>
            {avgScore > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                  avgScore >= 80
                    ? 'bg-[#DFF5E3] text-[#1E6939]'
                    : avgScore >= 50
                      ? 'bg-[#FFF3C4] text-[#805B10]'
                      : 'bg-[#FBE2DF] text-[#9E2E22]'
                }`}
              >
                {avgScore >= 80 ? 'Super Healthy' : avgScore >= 50 ? 'Balanced' : 'Treat Heavy'}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-semibold text-[#8B988F]">Nutritional quality rating</p>
        </div>

        <div className="rounded-[26px] border-2 border-[#BEE7F0] bg-white p-5 shadow-xs">
          <p className="text-[11px] font-black uppercase tracking-wider text-[#6B7A70]">
            Rainbow Coverage
          </p>
          <p className="mt-2 text-3xl font-black text-[#287A52]">{distinctGroupsCovered} / 6</p>
          <p className="mt-1 text-xs font-semibold text-[#8B988F]">
            {Math.round((distinctGroupsCovered / 6) * 100)}% of food groups explored
          </p>
        </div>

        <div className="rounded-[26px] border-2 border-[#BEE7F0] bg-white p-5 shadow-xs">
          <p className="text-[11px] font-black uppercase tracking-wider text-[#6B7A70]">
            Most Scanned Category
          </p>
          <p className="mt-2 text-2xl font-black text-[#173C4A]">
            {topCategory ? `${topCategory.icon} ${topCategory.label}` : '—'}
          </p>
          <p className="mt-1 text-xs font-semibold text-[#8B988F]">
            {topCategory ? `${topCategory.count} scans (${topCategory.pct}%)` : 'No scans yet'}
          </p>
        </div>
      </div>

      {/* Main Analytics Content */}
      <div className="space-y-7 rounded-[32px] border border-[#D5E3DB] bg-white p-6 shadow-xs sm:p-8">
        {loading ? (
          <div className="py-14 text-center text-sm font-black text-[#6B7A70]">
            Loading live food analytics...
          </div>
        ) : totalScans === 0 ? (
          <div className="rounded-3xl border border-[#DCE4DE] bg-[#FAFBF9] py-14 text-center">
            <span className="text-4xl">🥗</span>
            <p className="mt-3 text-lg font-black text-[#173C4A]">
              No scan data matches the current filters
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs font-semibold text-[#7D8C81]">
              When explorers scan and save meals to their Explorer Log, real-time charts, category
              breakdowns, and nutritional ratings appear here automatically.
            </p>
          </div>
        ) : (
          <>
            {/* Interactive Food Group Distribution */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-black text-[#173C4A]">
                    Food Group Distribution (Click a group to filter)
                  </h3>
                  <p className="text-xs font-semibold text-[#78887D]">
                    Percentage share, scan count, and average health score per food group
                  </p>
                </div>
                {selectedGroup !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setSelectedGroup('all')}
                    className="rounded-full bg-[#EEF4E7] px-3 py-1 text-xs font-black text-[#287A52]"
                  >
                    Showing: {selectedGroup.toUpperCase()} (Click to show all)
                  </button>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupAnalytics.map((group) => {
                  const isActive = selectedGroup === group.key
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() =>
                        setSelectedGroup((prev) => (prev === group.key ? 'all' : group.key))
                      }
                      className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-xs ${
                        isActive
                          ? 'border-[#173C4A] ring-2 ring-[#173C4A]'
                          : 'border-[#E1ECE3]'
                      }`}
                      style={{ backgroundColor: group.bg }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{group.icon}</span>
                          <span className="font-black text-[#173C4A]">{group.label}</span>
                        </div>
                        <span
                          className="rounded-full px-2.5 py-0.5 text-xs font-black"
                          style={{ backgroundColor: group.color, color: '#FFFFFF' }}
                        >
                          {group.pct}%
                        </span>
                      </div>
                      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/70">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${group.pct}%`,
                            backgroundColor: group.color,
                          }}
                        />
                      </div>
                      <div className="mt-2.5 flex items-center justify-between text-xs font-bold text-[#55695C]">
                        <span>{group.count} scans logged</span>
                        <span>Avg score: {group.avg ? `${group.avg}/100` : '—'}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 7-Day Activity Bar Chart */}
            <div className="rounded-3xl border border-[#E3EDE6] bg-[#FAFCFA] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-black text-[#173C4A]">
                    📅 Last 7 Days Scan Activity &amp; Health Score
                  </h4>
                  <p className="text-xs font-semibold text-[#7F8F83]">
                    Daily scan volume and average nutritional score over the past week
                  </p>
                </div>
                <span className="text-xs font-black text-[#287A52]">
                  {last7DaysTrend.reduce((sum, d) => sum + d.count, 0)} scans in last 7 days
                </span>
              </div>

              <div className="mt-5 grid grid-cols-7 gap-2 sm:gap-4 items-end h-40 pt-4 px-2">
                {last7DaysTrend.map((day) => {
                  const heightPct = day.count > 0 ? Math.max(18, Math.round((day.count / maxDailyCount) * 100)) : 6
                  return (
                    <div
                      key={day.dateStr}
                      className="flex flex-col items-center justify-end h-full gap-1.5"
                    >
                      <span className="text-[10px] font-black text-[#173C4A]">
                        {day.count > 0 ? `${day.count}` : '0'}
                      </span>
                      <div className="w-full max-w-[44px] flex-1 flex items-end justify-center">
                        <div
                          title={`${day.dateStr}: ${day.count} scans (Avg score: ${day.avgScore})`}
                          className={`w-full rounded-t-xl transition-all duration-500 ${
                            day.count > 0 ? 'bg-[#287A52]' : 'bg-[#E2EBE4]'
                          }`}
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-black text-[#4F6257]">{day.label}</span>
                      <span className="text-[9px] font-bold text-[#7D8C81]">
                        {day.avgScore ? `⭐${day.avgScore}` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Two Columns: Top Scanned Foods & Nutrition Health Tiers */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Top Scanned Foods */}
              <div className="rounded-3xl border border-[#E3EDE6] bg-[#FAFCFA] p-5">
                <h4 className="text-sm font-black text-[#173C4A]">🏆 Top 5 Most Scanned Foods</h4>
                <p className="text-xs font-semibold text-[#7F8F83]">
                  Most popular food items logged in the selected filter
                </p>
                {topScannedFoods.length === 0 ? (
                  <p className="py-8 text-center text-xs font-bold text-[#7F8F83]">
                    No foods scanned yet.
                  </p>
                ) : (
                  <div className="mt-4 divide-y divide-[#EBF2EC]">
                    {topScannedFoods.map((item, idx) => (
                      <div key={item.name} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-3">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#173C4A] text-xs font-black text-white">
                            {idx + 1}
                          </span>
                          {item.image && (
                            <img
                              src={item.image}
                              alt={item.name}
                              className="h-9 w-9 shrink-0 rounded-lg object-cover border border-[#D5E3DB]"
                            />
                          )}
                          <div>
                            <p className="font-black text-[#173C4A]">{item.name}</p>
                            <span className="text-[11px] font-bold uppercase text-[#738478]">
                              {item.group}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-[#173C4A]">
                            {item.count} {item.count === 1 ? 'scan' : 'scans'}
                          </p>
                          <p className="text-[11px] font-bold text-[#3B7A42]">
                            ⭐ {item.avgScore} score
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Nutrition Health Tiers */}
              <div className="rounded-3xl border border-[#E3EDE6] bg-[#FAFCFA] p-5">
                <h4 className="text-sm font-black text-[#173C4A]">
                  🥗 Nutrition Health Score Tiers
                </h4>
                <p className="text-xs font-semibold text-[#7F8F83]">
                  Nutritional quality distribution of scanned meals
                </p>
                <div className="mt-4 space-y-3.5">
                  {/* Superfoods */}
                  <div className="rounded-2xl border border-[#CDEED5] bg-[#EAF8EE] p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-[#266838]">
                        🟢 High Nutritional Superfoods (80-100 pts)
                      </span>
                      <span className="text-xs font-black text-[#266838]">
                        {highTier} ({totalScans > 0 ? Math.round((highTier / totalScans) * 100) : 0}
                        %)
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] font-semibold text-[#487E56]">
                      Fresh fruits, vegetables, lean proteins, and whole nutrient powerhouses.
                    </p>
                  </div>

                  {/* Everyday Balanced */}
                  <div className="rounded-2xl border border-[#FBEAC9] bg-[#FFF8E6] p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-[#8D650E]">
                        🟡 Everyday Balanced (50-79 pts)
                      </span>
                      <span className="text-xs font-black text-[#8D650E]">
                        {midTier} ({totalScans > 0 ? Math.round((midTier / totalScans) * 100) : 0}%)
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] font-semibold text-[#907335]">
                      Whole grain bread, pancakes, dairy, balanced snacks, and everyday fuel.
                    </p>
                  </div>

                  {/* Occasional Treats */}
                  <div className="rounded-2xl border border-[#F8D2D2] bg-[#FDF0F0] p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-[#963737]">
                        🔴 Occasional Treats (&lt;50 pts)
                      </span>
                      <span className="text-xs font-black text-[#963737]">
                        {treatTier} (
                        {totalScans > 0 ? Math.round((treatTier / totalScans) * 100) : 0}%)
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] font-semibold text-[#8C4B4B]">
                      Candies, sodas, chips, and sweet treats enjoyed occasionally.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Detailed Scanned Food Log Explorer Table */}
            <div className="rounded-3xl border border-[#E3EDE6] bg-[#FAFCFA] p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h4 className="text-base font-black text-[#173C4A]">
                    📋 Detailed Food Scan Log ({filteredScans.length})
                  </h4>
                  <p className="text-xs font-semibold text-[#7F8F83]">
                    Inspect individual food scans, photos, health scores, and manage records
                  </p>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search food name or summary..."
                  className="h-9 rounded-xl border border-[#D5E3DB] bg-white px-3.5 text-xs font-bold text-[#173C4A] outline-none focus:border-[#287A52] sm:w-64"
                />
              </div>

              {feedback && (
                <div className="mt-3 flex items-center justify-between rounded-xl bg-[#EAF8EE] px-3.5 py-2 text-xs font-black text-[#1E6939]">
                  <span>{feedback}</span>
                  <button onClick={() => setFeedback('')} className="underline">
                    Dismiss
                  </button>
                </div>
              )}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#DFE8E2] text-[11px] font-black uppercase tracking-wider text-[#6B7A70]">
                      <th className="pb-2.5 pr-3">Food</th>
                      <th className="pb-2.5 px-3">Category</th>
                      <th className="pb-2.5 px-3">Explorer</th>
                      <th className="pb-2.5 px-3">Health Score</th>
                      <th className="pb-2.5 px-3">Date</th>
                      <th className="pb-2.5 pl-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EBF2EC]">
                    {filteredScans.slice(0, 25).map((scan) => {
                      const isConfirming = confirmDeleteId === scan.id
                      const isDeleting = deletingId === scan.id
                      return (
                        <tr key={scan.id} className="hover:bg-white/80">
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-2.5">
                              {scan.image_url ? (
                                <img
                                  src={scan.image_url}
                                  alt={scan.food_name}
                                  className="h-10 w-10 shrink-0 rounded-xl object-cover border border-[#D5E3DB]"
                                />
                              ) : (
                                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#EAF4EC] text-base">
                                  🍽️
                                </span>
                              )}
                              <div>
                                <p className="font-black capitalize text-[#173C4A]">
                                  {scan.food_name}
                                </p>
                                <p className="line-clamp-1 max-w-[220px] text-[11px] font-semibold text-[#738478]">
                                  {scan.summary}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <span className="rounded-full bg-[#EEF4E7] px-2.5 py-1 text-[10px] font-black uppercase text-[#285A35]">
                              {scan.food_group}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-bold text-[#4F6257]">
                            {scan.user_id ? userMap[scan.user_id] || 'Explorer' : 'System Admin'}
                          </td>
                          <td className="py-3 px-3">
                            <span className="rounded-lg bg-[#EAF7DE] px-2 py-1 font-black text-[#2E6822]">
                              {scan.score}/100
                            </span>
                          </td>
                          <td className="py-3 px-3 font-semibold text-[#738478]">
                            {scan.created_at
                              ? new Date(scan.created_at).toLocaleDateString()
                              : '—'}
                          </td>
                          <td className="py-3 pl-3 text-right">
                            {isConfirming ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() => handleDeleteScan(scan.id, scan.food_name)}
                                  className="rounded-lg bg-[#D64535] px-2 py-1 text-[10px] font-black text-white hover:bg-[#b83627]"
                                >
                                  {isDeleting ? '...' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="rounded-lg bg-gray-200 px-2 py-1 text-[10px] font-black text-gray-700"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(scan.id)}
                                className="rounded-lg bg-[#FDF1EF] px-2.5 py-1 text-[11px] font-black text-[#C04436] hover:bg-[#F9DDD8]"
                              >
                                🗑️ Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
