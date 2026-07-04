import { Navigate, Route, Routes } from 'react-router-dom'

import { AppHeader } from '@/widgets/app-header'
import { BottomNavigation } from '@/widgets/bottom-navigation'
import { OfflineBanner } from '@/widgets/offline-banner'
import { CheckVehiclePage } from '@/pages/check-vehicle'
import { DailyLimitsPage } from '@/pages/daily-limits'
import { DashboardPage } from '@/pages/dashboard'
import { FuelingPage } from '@/pages/fueling'
import { HistoryPage } from '@/pages/history'
import { LoginPage } from '@/pages/login'
import { ReportsPage } from '@/pages/reports'
import { ReservationsPage } from '@/pages/reservations'
import { SettingsPage } from '@/pages/settings'
import { SyncStatusPage } from '@/pages/sync-status'
import { TodayQueuePage } from '@/pages/today-queue'
import { UsersPage } from '@/pages/users'

function AppShell() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <OfflineBanner />
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/check" element={<CheckVehiclePage />} />
          <Route path="/queue" element={<TodayQueuePage />} />
          <Route path="/reservations" element={<ReservationsPage />} />
          <Route path="/limits" element={<DailyLimitsPage />} />
          <Route path="/fueling" element={<FuelingPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/sync" element={<SyncStatusPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <BottomNavigation />
    </div>
  )
}

export function AppRoutes() {
  return <AppShell />
}
