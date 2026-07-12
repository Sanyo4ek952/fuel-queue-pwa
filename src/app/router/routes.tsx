import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { useCurrentProfile } from '@/entities/profile'
import { useLogout } from '@/features/auth'
import { AppHeader } from '@/widgets/app-header'
import { BottomNavigation, getVisibleBottomNavItems } from '@/widgets/bottom-navigation'
import { OfflineBanner } from '@/widgets/offline-banner'
import { useSupabaseAuth } from '@/app/providers/supabase-provider/auth-context'
import { PUBLIC_ROUTES, ROUTES } from '@/shared/config/routes'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

import { getProtectedRouteState, type ProtectedRouteState } from './access'

const DashboardPage = lazy(() =>
  import('@/pages/dashboard').then((m) => ({ default: m.DashboardPage })),
)
const TodayQueuePage = lazy(() =>
  import('@/pages/today-queue').then((m) => ({ default: m.TodayQueuePage })),
)
const ReservationsPage = lazy(() =>
  import('@/pages/reservations').then((m) => ({ default: m.ReservationsPage })),
)
const PreferentialQueuesPage = lazy(() =>
  import('@/pages/preferential-queues').then((m) => ({ default: m.PreferentialQueuesPage })),
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
const DeletedReservationsPage = lazy(() =>
  import('@/pages/deleted-reservations').then((m) => ({ default: m.DeletedReservationsPage })),
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
const QueueCheckQrPage = lazy(() =>
  import('@/pages/queue-check-qr').then((m) => ({ default: m.QueueCheckQrPage })),
)
const PromoPage = lazy(() => import('@/pages/promo').then((m) => ({ default: m.PromoPage })))
const PublicQueueCheckPage = lazy(() =>
  import('@/pages/public-queue-check').then((m) => ({ default: m.PublicQueueCheckPage })),
)
const LoginPage = lazy(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })))
const AuthCallbackPage = lazy(() =>
  import('@/pages/auth-callback').then((m) => ({ default: m.AuthCallbackPage })),
)
const ProfileSetupPage = lazy(() =>
  import('@/pages/profile-setup').then((m) => ({ default: m.ProfileSetupPage })),
)

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-600">
      Загрузка...
    </div>
  )
}

function useLoadingTimeout(isLoading: boolean, timeoutMs: number) {
  const [hasTimedOut, setHasTimedOut] = useState(false)

  useEffect(() => {
    if (!isLoading) {
      setHasTimedOut(false)
      return
    }

    const timeoutId = window.setTimeout(() => setHasTimedOut(true), timeoutMs)

    return () => window.clearTimeout(timeoutId)
  }, [isLoading, timeoutMs])

  return hasTimedOut
}

function ProfileLoadErrorScreen({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean
  onRetry: () => void
}) {
  const logoutMutation = useLogout()

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <Card className="w-full max-w-md rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle>Не удалось загрузить профиль</CardTitle>
          <CardDescription>Проверьте интернет, VPN или повторите попытку.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert variant="destructive">
            <AlertTitle>Загрузка остановлена</AlertTitle>
            <AlertDescription>
              Приложение не получило профиль пользователя достаточно быстро.
            </AlertDescription>
          </Alert>
          <Button className="w-full" disabled={isRetrying} onClick={onRetry}>
            {isRetrying ? 'Повторяем...' : 'Повторить'}
          </Button>
          <Button
            className="w-full"
            variant="outline"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {logoutMutation.isPending ? 'Выходим...' : 'Выйти'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function AccessStateScreen({ state }: { state: ProtectedRouteState | 'profile-error' }) {
  const logoutMutation = useLogout()
  const message =
    state === 'forbidden'
      ? 'Для вашей роли недоступен этот раздел.'
      : state === 'profile-pending'
        ? 'Заявка на регистрацию ожидает подтверждения руководителем.'
        : state === 'profile-rejected'
          ? 'Заявка на регистрацию отклонена. Обратитесь к руководителю.'
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
          <Button
            className="w-full"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {logoutMutation.isPending ? 'Выходим...' : 'Выйти'}
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
  const currentProfileQuery = useCurrentProfile()
  const visibleBottomNavItems = getVisibleBottomNavItems(currentProfileQuery.data?.role)
  const hasBottomNavigation = visibleBottomNavItems.length > 1
  const isProfileFromCache = Boolean(currentProfileQuery.data?.is_from_cache)

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <OfflineBanner />
      <AppHeader />
      <main
        className={[
          'mx-auto w-full max-w-3xl px-4 pt-4',
          hasBottomNavigation ? 'pb-24' : 'pb-6',
        ].join(' ')}
      >
        {isProfileFromCache ? (
          <Alert className="mb-4 border-amber-200 bg-amber-50 text-amber-950">
            <AlertTitle>Профиль загружен из локального кэша</AlertTitle>
            <AlertDescription>
              Права и данные обновятся после восстановления связи с сервером.
            </AlertDescription>
          </Alert>
        ) : null}
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/check" element={<Navigate to={ROUTES.reservations} replace />} />
            <Route path="/queue" element={<TodayQueuePage />} />
            <Route path="/reservations" element={<ReservationsPage />} />
            <Route path="/preferential-queues" element={<PreferentialQueuesPage />} />
            <Route path="/limits" element={<DailyLimitsPage />} />
            <Route path="/fueling" element={<FuelingPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/deleted-reservations" element={<DeletedReservationsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/sync" element={<SyncStatusPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/queue-check-qr" element={<QueueCheckQrPage />} />
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
  const profileLoadingTimedOut = useLoadingTimeout(currentProfileQuery.isLoading, 8_000)
  const route = getRouteForAccess(location.pathname)

  const state = getProtectedRouteState({
    authLoading: auth.isLoading,
    hasSession: Boolean(auth.session),
    profileLoading: currentProfileQuery.isLoading,
    profile: currentProfileQuery.data,
    route,
  })

  if (state === 'auth-loading') {
    return <LoadingScreen />
  }

  if (state === 'profile-loading') {
    if (profileLoadingTimedOut) {
      return (
        <ProfileLoadErrorScreen
          isRetrying={currentProfileQuery.isFetching}
          onRetry={() => void currentProfileQuery.refetch()}
        />
      )
    }

    return <LoadingScreen />
  }

  if (state === 'redirect-login') {
    return <Navigate to={ROUTES.login} state={{ from: location }} replace />
  }

  if (currentProfileQuery.isError) {
    return (
      <ProfileLoadErrorScreen
        isRetrying={currentProfileQuery.isFetching}
        onRetry={() => void currentProfileQuery.refetch()}
      />
    )
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
  const normalizedPathname = location.pathname.replace(/\/$/, '')

  if (PUBLIC_ROUTES.includes(normalizedPathname as (typeof PUBLIC_ROUTES)[number])) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        {normalizedPathname === ROUTES.queueCheck ? <PublicQueueCheckPage /> : <PromoPage />}
      </Suspense>
    )
  }

  if (normalizedPathname === ROUTES.authCallback) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <AuthCallbackPage />
      </Suspense>
    )
  }

  if (normalizedPathname === ROUTES.profileSetup) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <ProfileSetupPage />
      </Suspense>
    )
  }

  if (normalizedPathname === ROUTES.login) {
    return <LoginRoute />
  }

  return <AuthenticatedAppShell />
}
