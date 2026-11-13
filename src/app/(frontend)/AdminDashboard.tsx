'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  adminDeleteFoodLogAction,
  adminDeleteUserAction,
  adminGetDashboardDataAction,
  adminInspectTableAction,
  adminResetUserPasswordAction,
  adminToggleAdminStatusAction,
  adminUpdateUserPointsAction,
  type AdminDashboardData,
  type AdminProfileItem,
} from './actions'

type TabType = 'users' | 'scans' | 'inspect'

export default function AdminDashboard({ onBack }: { onBack?: () => void }) {
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('users')
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err'
    text: string
  } | null>(null)
  const [search, setSearch] = useState('')
  const [isPending, startTransition] = useTransition()

  // Inline confirmation states (replaces browser window.confirm)
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null)
  const [confirmDeleteScanId, setConfirmDeleteScanId] = useState<string | null>(null)

  // Inspect database state
  const [inspectTable, setInspectTable] = useState<'profiles' | 'food_logs'>('profiles')
  const [inspectData, setInspectData] = useState<{
    columns: string[]
    rows: Record<string, unknown>[]
  } | null>(null)
  const [inspectLoading, setInspectLoading] = useState(false)

  // Password reset prompt state
  const [resetTargetEmail, setResetTargetEmail] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    const res = await adminGetDashboardDataAction()
    if (res.ok) {
      setData(res.data)
    } else {
      setFeedback({ type: 'err', text: res.error })
    }
    setLoading(false)
  }

  const loadInspectData = async (table: 'profiles' | 'food_logs') => {
    setInspectLoading(true)
    const res = await adminInspectTableAction(table)
    if (res.ok) {
      setInspectData(res.data)
    } else {
      setFeedback({ type: 'err', text: res.error })
    }
    setInspectLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (activeTab === 'inspect') {
      loadInspectData(inspectTable)
    }
  }, [activeTab, inspectTable])

  const handleDeleteScan = (scanId: string, foodName: string) => {
    startTransition(async () => {
      const res = await adminDeleteFoodLogAction(scanId)
      if (res.ok) {
        setConfirmDeleteScanId(null)
        setFeedback({ type: 'ok', text: `🗑️ Scan "${foodName}" deleted.` })
        loadData()
      } else {
        setFeedback({ type: 'err', text: res.error })
      }
    })
  }

  const handleResetPassword = (email: string) => {
    startTransition(async () => {
      const res = await adminResetUserPasswordAction(email)
      if (res.ok) {
        setFeedback({ type: 'ok', text: res.data })
        setResetTargetEmail(null)
      } else {
        setFeedback({ type: 'err', text: res.error })
      }
    })
  }

  const handleUpdatePoints = (user: AdminProfileItem, delta: number) => {
    const newPoints = Math.max(0, user.points + delta)
    startTransition(async () => {
      const res = await adminUpdateUserPointsAction(user.id, newPoints)
      if (res.ok) {
        setFeedback({
          type: 'ok',
          text: `⭐ Updated ${user.display_name}'s points to ${newPoints} pts.`,
        })
        loadData()
      } else {
        setFeedback({ type: 'err', text: res.error })
      }
    })
  }

  const handleToggleAdmin = (targetUser: AdminProfileItem) => {
    const nextStatus = !targetUser.is_admin
    startTransition(async () => {
      const res = await adminToggleAdminStatusAction(targetUser.id, nextStatus)
      if (res.ok) {
        setFeedback({
          type: 'ok',
          text: `👑 ${targetUser.display_name} is now ${nextStatus ? 'an Administrator' : 'an Explorer'}.`,
        })
        loadData()
      } else {
        setFeedback({ type: 'err', text: res.error })
      }
    })
  }

  const handleDeleteUser = (targetUser: AdminProfileItem) => {
    startTransition(async () => {
      const res = await adminDeleteUserAction(targetUser.id)
      if (res.ok) {
        setConfirmDeleteUserId(null)
        setFeedback({
          type: 'ok',
          text: `🗑️ Explorer "${targetUser.display_name}" and their food logs were removed.`,
        })
        loadData()
      } else {
        setFeedback({ type: 'err', text: res.error })
      }
    })
  }

  // CSV Exporters
  const exportUsersCSV = () => {
    if (!data?.users.length) return
    const headers = [
      'ID',
      'Name',
      'Email',
      'Age Group',
      'Points',
      'Streak',
      'Role',
      'Created At',
    ]
    const rows = data.users.map((u) => [
      `"${u.id}"`,
      `"${u.display_name.replace(/"/g, '""')}"`,
      `"${u.email}"`,
      `"${u.age_group}"`,
      u.points,
      u.streak,
      u.is_admin ? 'Admin' : 'Explorer',
      `"${u.created_at}"`,
    ])
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `foodfriends_explorers_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
  }

  const exportScansCSV = () => {
    if (!data?.scans.length) return
    const headers = ['ID', 'Food Name', 'Food Group', 'Score', 'Summary', 'Created At']
    const rows = data.scans.map((s) => [
      `"${s.id}"`,
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
    link.download = `foodfriends_scans_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
  }

  const filteredUsers =
    data?.users.filter(
      (u) =>
        u.display_name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
    ) || []

  const filteredScans =
    data?.scans.filter(
      (s) =>
        s.food_name.toLowerCase().includes(search.toLowerCase()) ||
        s.food_group.toLowerCase().includes(search.toLowerCase()) ||
        s.summary.toLowerCase().includes(search.toLowerCase())
    ) || []

  const avgScanScore =
    data && data.scans.length > 0
      ? Math.round(data.scans.reduce((acc, s) => acc + s.score, 0) / data.scans.length)
      : 0

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header Banner */}
      <div className="overflow-hidden rounded-[32px] bg-[#173C4A] p-7 text-white shadow-xl sm:p-9">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFD84D] px-3.5 py-1 text-xs font-black uppercase tracking-wider text-[#3D2A1E]">
              🛡️ System Administrator Dashboard
            </span>
            <h1 className="mt-3 text-3xl font-black tracking-[-.04em] sm:text-4xl">
              System Management
            </h1>
            <p className="mt-1 font-semibold text-white/75">
              Oversee explorer accounts, moderate scans, reset passwords, and inspect data.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                loadData()
                if (activeTab === 'inspect') loadInspectData(inspectTable)
              }}
              disabled={loading || isPending}
              className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2.5 text-sm font-extrabold text-white transition hover:bg-white/20 disabled:opacity-50"
            >
              🔄 {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="rounded-2xl bg-[#FFD84D] px-4 py-2.5 text-sm font-extrabold text-[#3D2A1E] transition hover:bg-[#FFE073]"
              >
                Back to App
              </button>
            )}
          </div>
        </div>

        {/* Live System KPI Strip */}
        <div className="mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-5">
          <div className="rounded-2xl bg-white/10 px-4 py-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">
              Registered Explorers
            </span>
            <p className="mt-0.5 text-2xl font-black text-[#FFD84D]">
              {loading ? '...' : (data?.users.length ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">
              Saved Food Scans
            </span>
            <p className="mt-0.5 text-2xl font-black text-[#9DE8F5]">
              {loading ? '...' : (data?.scans.length ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">
              Avg Health Score
            </span>
            <p className="mt-0.5 text-2xl font-black text-[#B8F29D]">
              {loading ? '...' : avgScanScore ? `${avgScanScore}/100` : '—'}
            </p>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`flex items-center justify-between rounded-2xl p-4 text-sm font-bold shadow-xs ${
            feedback.type === 'ok'
              ? 'bg-[#D9F5D2] text-[#245D1C]'
              : 'bg-[#F9DDD8] text-[#8C2C20]'
          }`}
        >
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="text-xs font-black underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Area with 3 Action Tabs */}
      <div className="rounded-[32px] border border-[#D5E3DB] bg-white p-6 shadow-xs sm:p-8">
        {/* Navigation Tabs */}
        <div className="flex flex-col gap-4 border-b border-[#E8EEE5] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab('users')}
              className={`rounded-2xl px-5 py-2.5 text-sm font-black transition ${
                activeTab === 'users'
                  ? 'bg-[#173C4A] text-white shadow-xs'
                  : 'bg-[#F2F6F3] text-[#55675C] hover:bg-[#E5ECE7]'
              }`}
            >
              👥 Explorers &amp; Password Reset ({data?.users.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('scans')}
              className={`rounded-2xl px-5 py-2.5 text-sm font-black transition ${
                activeTab === 'scans'
                  ? 'bg-[#173C4A] text-white shadow-xs'
                  : 'bg-[#F2F6F3] text-[#55675C] hover:bg-[#E5ECE7]'
              }`}
            >
              🥗 Moderate Scans ({data?.scans.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('inspect')}
              className={`rounded-2xl px-5 py-2.5 text-sm font-black transition ${
                activeTab === 'inspect'
                  ? 'bg-[#173C4A] text-white shadow-xs'
                  : 'bg-[#F2F6F3] text-[#55675C] hover:bg-[#E5ECE7]'
              }`}
            >
              🔍 Inspect Database
            </button>
          </div>

          {(activeTab === 'users' || activeTab === 'scans') && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${activeTab === 'users' ? 'users' : 'scans'}...`}
              className="h-10 w-full rounded-xl border border-[#D5E3DB] bg-[#F9FBFA] px-4 text-sm font-semibold outline-none focus:border-[#173C4A] sm:w-56"
            />
          )}
        </div>

        {/* ======================================================== */}
        {/* TAB 1: VIEW SIGNED UP USERS & RESET PASSWORDS */}
        {/* ======================================================== */}
        {activeTab === 'users' && (
          <div className="mt-6 space-y-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-lg font-black text-[#173C4A]">
                  Registered Explorer Accounts
                </h3>
                <p className="text-xs font-semibold text-[#7D8C81]">
                  View signups, reset passwords on request, and adjust reward points.
                </p>
              </div>
              <button
                onClick={exportUsersCSV}
                disabled={!data?.users.length}
                className="self-start rounded-xl border border-[#D5E3DB] bg-white px-3.5 py-2 text-xs font-black text-[#173C4A] hover:bg-[#F2F6F3] disabled:opacity-40 sm:self-auto"
              >
                📥 Export Users (CSV)
              </button>
            </div>

            {loading ? (
              <p className="py-10 text-center font-bold text-[#7D8C81]">Loading accounts...</p>
            ) : filteredUsers.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-lg font-black text-[#173C4A]">No explorers found</p>
                <p className="mt-1 text-sm font-semibold text-[#7D8C81]">
                  Accounts created by users will appear here immediately.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E8EEE5] text-xs font-black uppercase tracking-wider text-[#6B7A70]">
                      <th className="pb-3">User &amp; Email</th>
                      <th className="pb-3">Age Group</th>
                      <th className="pb-3">Points &amp; Streak</th>
                      <th className="pb-3">Role</th>
                      <th className="pb-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F6F3]">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[#FAFDF9]">
                        <td className="py-4 pr-4">
                          <p className="font-black text-[#173C4A]">{u.display_name}</p>
                          <p className="text-xs font-semibold text-[#8B988F]">{u.email}</p>
                        </td>
                        <td className="py-4 pr-4 font-bold text-[#4B5E53]">
                          <span className="rounded-lg bg-[#EBF6EE] px-2.5 py-1 text-xs">
                            Age {u.age_group}
                          </span>
                        </td>
                        <td className="py-4 pr-4">
                          <span className="font-extrabold text-[#173C4A]">⭐ {u.points} pts</span>
                          <span className="ml-2 text-xs font-bold text-[#E26938]">
                            🔥 {u.streak}d
                          </span>
                        </td>
                        <td className="py-4 pr-4">
                          <button
                            type="button"
                            onClick={() => handleToggleAdmin(u)}
                            disabled={isPending}
                            title="Click to toggle Admin / Explorer role"
                            className={`rounded-full px-2.5 py-1 text-xs font-black transition ${
                              u.is_admin
                                ? 'bg-[#E5F3FF] text-[#0066CC] hover:bg-[#CCE6FF]'
                                : 'bg-[#F2F6F3] text-[#6D7D72] hover:bg-[#E2EBE5]'
                            }`}
                          >
                            {u.is_admin ? '👑 Admin' : 'Explorer'}
                          </button>
                        </td>
                        <td className="py-4 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setResetTargetEmail(u.email)}
                              className="rounded-lg border border-[#3B82F6]/30 bg-[#EFF6FF] px-2.5 py-1 text-xs font-black text-[#1D4ED8] hover:bg-[#DBEAFE]"
                              title="Reset user password"
                            >
                              🔑 Reset Pass
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleUpdatePoints(u, 15)}
                              title="Add 15 points"
                              className="rounded-lg border border-[#D5E3DB] bg-white px-2 py-1 text-xs font-black text-[#287A52] hover:bg-[#F2F9F5]"
                            >
                              +15
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleUpdatePoints(u, -15)}
                              title="Subtract 15 points"
                              className="rounded-lg border border-[#D5E3DB] bg-white px-2 py-1 text-xs font-black text-[#96473D] hover:bg-[#FAF2F1]"
                            >
                              -15
                            </button>
                            {confirmDeleteUserId === u.id ? (
                              <div className="inline-flex items-center gap-1 rounded-lg bg-[#FDF1EF] px-2 py-1">
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => handleDeleteUser(u)}
                                  className="rounded bg-[#C93B2B] px-2 py-0.5 text-[11px] font-black text-white hover:bg-[#a62e20]"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteUserId(null)}
                                  className="px-1.5 text-[11px] font-bold text-[#6E7C73]"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUserId(u.id)}
                                title="Delete user"
                                className="rounded-lg bg-[#FBEAE7] px-2.5 py-1 text-xs font-black text-[#B03E31] hover:bg-[#F6D3CD]"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: DELETE INAPPROPRIATE FOOD SCANS OR TEST DATA */}
        {/* ======================================================== */}
        {activeTab === 'scans' && (
          <div className="mt-6 space-y-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-lg font-black text-[#173C4A]">Food Scan Moderation</h3>
                <p className="text-xs font-semibold text-[#7D8C81]">
                  Review all food scans and photos. Delete inappropriate photos, test scans, or
                  spam entries.
                </p>
              </div>
              <button
                onClick={exportScansCSV}
                disabled={!data?.scans.length}
                className="self-start rounded-xl border border-[#D5E3DB] bg-white px-3.5 py-2 text-xs font-black text-[#173C4A] hover:bg-[#F2F6F3] disabled:opacity-40 sm:self-auto"
              >
                📥 Export Scans (CSV)
              </button>
            </div>

            {loading ? (
              <p className="py-10 text-center font-bold text-[#7D8C81]">Loading food scans...</p>
            ) : filteredScans.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-lg font-black text-[#173C4A]">No food scans yet</p>
                <p className="mt-1 text-sm font-semibold text-[#7D8C81]">
                  Scans saved by users will show up here.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredScans.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-col justify-between rounded-2xl border border-[#E3ECE6] bg-[#FAFDF9] p-4 transition hover:border-[#173C4A]/30"
                  >
                    <div className="flex gap-3.5">
                      {s.image_url ? (
                        <img
                          src={s.image_url}
                          alt={s.food_name}
                          className="h-20 w-20 shrink-0 rounded-2xl border border-[#D5E3DB] object-cover shadow-2xs"
                        />
                      ) : (
                        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-[#EAF4EC] text-2xl">
                          🍽️
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate text-base font-black text-[#173C4A]">
                            {s.food_name}
                          </span>
                          <span className="shrink-0 rounded-full bg-[#EAF7DE] px-2.5 py-0.5 text-xs font-black text-[#386D24]">
                            {s.score}/100
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="rounded-md bg-white px-2 py-0.5 text-xs font-extrabold uppercase text-[#546A5E] shadow-xs">
                            {s.food_group}
                          </span>
                          <span className="text-xs font-semibold text-[#8B988F]">
                            {new Date(s.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs font-semibold leading-relaxed text-[#5F7065]">
                          {s.summary}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-end border-t border-[#EDF3EE] pt-2.5">
                      {confirmDeleteScanId === s.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#B03E31]">
                            Delete this scan?
                          </span>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleDeleteScan(s.id, s.food_name)}
                            className="rounded-lg bg-[#C93B2B] px-3 py-1 text-xs font-black text-white hover:bg-[#a62e20]"
                          >
                            Yes, Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteScanId(null)}
                            className="rounded-lg border border-[#D5E3DB] bg-white px-2.5 py-1 text-xs font-bold text-[#5A6B60]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteScanId(s.id)}
                          className="rounded-lg bg-[#FBEAE7] px-3 py-1 text-xs font-black text-[#B03E31] transition hover:bg-[#F6D3CD]"
                        >
                          🗑️ Delete Inappropriate Scan
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: INSPECT DATABASE WITHOUT WRITING CODE */}
        {/* ======================================================== */}
        {activeTab === 'inspect' && (
          <div className="mt-6 space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-black text-[#173C4A]">Database Inspector</h3>
                <p className="text-xs font-semibold text-[#7D8C81]">
                  Inspect raw tables, columns, and rows directly without writing any SQL code.
                </p>
              </div>

              {/* Table selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#6B7A70]">Table:</span>
                <select
                  value={inspectTable}
                  onChange={(e) => setInspectTable(e.target.value as 'profiles' | 'food_logs')}
                  className="h-10 rounded-xl border border-[#D5E3DB] bg-[#F9FBFA] px-3 text-xs font-extrabold text-[#173C4A] outline-none"
                >
                  <option value="profiles">profiles (User Accounts)</option>
                  <option value="food_logs">food_logs (Scans)</option>
                </select>
                <button
                  onClick={() => loadInspectData(inspectTable)}
                  disabled={inspectLoading}
                  className="rounded-xl border border-[#D5E3DB] bg-white px-3 py-2 text-xs font-bold text-[#173C4A] hover:bg-[#F2F6F3]"
                >
                  🔄
                </button>
              </div>
            </div>

            {inspectLoading ? (
              <p className="py-12 text-center font-bold text-[#7D8C81]">
                Querying database table...
              </p>
            ) : !inspectData || inspectData.rows.length === 0 ? (
              <div className="rounded-2xl border border-[#E8EEE5] bg-[#F9FBFA] py-12 text-center">
                <p className="text-sm font-bold text-[#7D8C81]">
                  Table &quot;{inspectTable}&quot; is currently empty.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[#E0E7E2] bg-[#FAFBF9]">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="border-b border-[#D5E0D7] bg-[#EEF3EF] text-[#425449]">
                    <tr>
                      {inspectData.columns.map((col) => (
                        <th key={col} className="whitespace-nowrap px-3.5 py-2.5 font-bold">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EFE8]">
                    {inspectData.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-white">
                        {inspectData.columns.map((col) => (
                          <td
                            key={col}
                            className="max-w-[240px] truncate whitespace-nowrap px-3.5 py-2.5 text-[#28382E]"
                            title={String(row[col] ?? '')}
                          >
                            {row[col] === null ? (
                              <span className="italic text-gray-400">null</span>
                            ) : (
                              String(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reset Password Modal Confirmation */}
      {resetTargetEmail && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[28px] border border-[#D5E3DB] bg-white p-6 shadow-2xl">
            <h3 className="text-xl font-black text-[#173C4A]">Reset User Password</h3>
            <p className="mt-2 text-sm font-semibold text-[#5A6D61]">
              A password reset link will be sent to <strong>{resetTargetEmail}</strong>. They will
              receive an email to set a new password.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setResetTargetEmail(null)}
                className="rounded-xl px-4 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handleResetPassword(resetTargetEmail)}
                disabled={isPending}
                className="rounded-xl bg-[#1D4ED8] px-5 py-2 text-xs font-black text-white hover:bg-[#1E40AF]"
              >
                {isPending ? 'Sending...' : 'Confirm Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
