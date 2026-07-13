import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { useCurrentProfile } from '@/entities/profile'
import { CompleteConsumerProfileForm } from '@/features/complete-consumer-profile'
import { isConsumerProfileComplete } from '@/shared/api/profile'
import { getAuthSession, type AuthSession } from '@/shared/api/auth'
import { ROUTES } from '@/shared/config/routes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-600">
      Загружаем профиль...
    </div>
  )
}

export function ProfileSetupPage() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isSessionLoading, setIsSessionLoading] = useState(true)
  const navigate = useNavigate()
  const currentProfileQuery = useCurrentProfile({
    enabled: Boolean(session) && !isSessionLoading,
  })
  const profile = currentProfileQuery.data

  useEffect(() => {
    let isMounted = true

    getAuthSession()
      .then((result) => {
        if (isMounted) {
          setSession(result.data)
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsSessionLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  if (isSessionLoading || currentProfileQuery.isLoading) {
    return <LoadingScreen />
  }

  if (!session) {
    return <Navigate to={ROUTES.login} replace />
  }

  if (profile && profile.role !== 'consumer') {
    return <Navigate to={ROUTES.dashboard} replace />
  }

  if (profile && isConsumerProfileComplete(profile)) {
    return <Navigate to={ROUTES.dashboard} replace />
  }

  if (currentProfileQuery.isError || !profile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
        <Card className="w-full max-w-md rounded-lg border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>Профиль не найден</CardTitle>
            <CardDescription>
              Повторите вход через Яндекс ID. Если ошибка сохранится, обратитесь к администратору.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-md">
        <CompleteConsumerProfileForm
          defaultValues={{
            firstName: profile.first_name ?? '',
            lastName: profile.last_name ?? '',
            middleName: profile.middle_name ?? '',
            phone: profile.phone ?? '',
          }}
          onSuccess={() => navigate(ROUTES.dashboard, { replace: true })}
        />
      </div>
    </main>
  )
}
