import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { useCurrentProfile } from '@/entities/profile'
import { AppHeader } from '@/widgets/app-header'
import { BottomNavigation } from '@/widgets/bottom-navigation'
import { OfflineBanner } from '@/widgets/offline-banner'
import { useSupabaseAuth } from '@/app/providers/supabase-provider/auth-context'
import { ROUTES } from '@/shared/config/routes'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

import { getProtectedRouteState, type ProtectedRouteState } from './access'

const DashboardPage = lazy(() =>
  import('@/pages/dashboard').then((m) => ({ default: m.DashboardPage })),
)
const CheckVehiclePage = lazy(() =>
  import('@/pages/check-vehicle').then((m) => ({ default: m.CheckVehiclePage })),
)
const TodayQueuePage = lazy(() =>
  import('@/pages/today-queue').then((m) => ({ default: m.TodayQueuePage })),
)
const ReservationsPage = lazy(() =>
  import('@/pages/reservations').then((m) => ({ default: m.ReservationsPage })),
)
const DailyLimitsPage = lazy(() =>
  import('@/pages/daily-limits').then((m) => ({ default: m.DailyLimitsPage })),
)
const FuelingPage = lazy(() =>
  import('@/pages/fueling').then((m) => ({ default: m.FuelingPage })),
)
const HistoryPage = lazy(() =>
  import('@/pages/history').then((m) => ({ default: m.HistoryPage })),
)
const ReportsPage = lazy(() =>
  import('@/pages/reports').then((m) => ({ default: m.ReportsPage })),
)
const UsersPage = lazy(() =>
  import('@/pages/users').then((m) => ({ default: m.UsersPage })),
)
const SyncStatusPage = lazy(() =>
  import('@/pages/sync-status').then((m) => ({ default: m.SyncStatusPage })),
)
const SettingsPage = lazy(() =>
  import('@/pages/settings').then((m) => ({ default: m.SettingsPage })),
)
const PromoPage = lazy(() => import('@/pages/promo').then((m) => ({ default: m.PromoPage })))
const LoginPage = lazy(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })))

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-600">
      Загрузка...
    </div>
  )
}

function AccessStateScreen({ state }: { state: ProtectedRouteState | 'profile-error' }) {
  const message =
    state === 'forbidden'
      ? 'Для вашей роли недоступен этот раздел.'
      : state === 'profile-inactive'
        ? 'Профиль отключён. Обратитесь к администратору.'
        : state === 'profile-error'
          ? 'Не удалось загрузить профиль пользователя.'
          : 'Профиль пользователя не найден.'

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <Card className="w-full max-w-md rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle>Доступ закрыт</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert variant="destructive">
            <AlertTitle>Переход невозможен</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
          <Button asChild className="w-full">
            <Link to={ROUTES.dashboard}>На главный экран</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function getRouteForAccess(pathname: string) {
  const normalizedPathname = pathname.replace(/\/$/, '') || ROUTES.dashboard
  const appRoutes = Object.values(ROUTES)

  if (normalizedPathname === '/') {
    return ROUTES.dashboard
  }

  return appRoutes.includes(normalizedPathname as (typeof appRoutes)[number])
    ? normalizedPathname
    : ROUTES.dashboard
}

function AppShell() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <OfflineBanner />
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4">
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
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
        </Suspense>
      </main>
      <BottomNavigation />
    </div>
  )
}

function AuthenticatedAppShell() {
  const location = useLocation()
  const auth = useSupabaseAuth()
  const currentProfileQuery = useCurrentProfile({
    enabled: Boolean(auth.session) && !auth.isLoading,
  })
  const route = getRouteForAccess(location.pathname)

  const state = getProtectedRouteState({
    authLoading: auth.isLoading,
    hasSession: Boolean(auth.session),
    profileLoading: currentProfileQuery.isLoading,
    profile: currentProfileQuery.data,
    route,
  })

  if (state === 'auth-loading' || state === 'profile-loading') {
    return <LoadingScreen />
  }

  if (state === 'redirect-login') {
    return <Navigate to={ROUTES.login} state={{ from: location }} replace />
  }

  if (currentProfileQuery.isError) {
    return <AccessStateScreen state="profile-error" />
  }

  if (state !== 'allowed') {
    return <AccessStateScreen state={state} />
  }

  return <AppShell />
}

function LoginRoute() {
  const auth = useSupabaseAuth()

  if (auth.isLoading) {
    return <LoadingScreen />
  }

  if (auth.session) {
    return <Navigate to={ROUTES.dashboard} replace />
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <LoginPage />
    </Suspense>
  )
}

export function AppRoutes() {
  const location = useLocation()

  if (location.pathname.replace(/\/$/, '') === ROUTES.promo) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <PromoPage />
      </Suspense>
    )
  }

  if (location.pathname.replace(/\/$/, '') === ROUTES.login) {
    return <LoginRoute />
  }

  return <AuthenticatedAppShell />
}
