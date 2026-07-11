import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useCurrentProfile } from '@/entities/profile'
import { isConsumerProfileComplete } from '@/shared/api/profile'
import { getAuthSession, signOut } from '@/shared/api/auth'
import { ROUTES } from '@/shared/config/routes'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-600">
      Завершаем вход...
    </div>
  )
}

function readOAuthError(search: string, hash: string) {
  const searchParams = new URLSearchParams(search)
  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const error = searchParams.get('error') ?? hashParams.get('error')
  const description =
    searchParams.get('error_description') ??
    searchParams.get('error_code') ??
    hashParams.get('error_description') ??
    hashParams.get('error_code')

  if (!error && !description) {
    return null
  }

  const normalized = `${error ?? ''} ${description ?? ''}`.toLowerCase()

  if (
    normalized.includes('access_denied') ||
    normalized.includes('cancel') ||
    normalized.includes('denied')
  ) {
    return 'Вход через Яндекс ID отменён.'
  }

  return description
    ? `Не удалось завершить вход через Яндекс ID: ${description}`
    : 'Не удалось завершить вход через Яндекс ID. Попробуйте ещё раз.'
}

export function AuthCallbackPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [isSessionLoading, setIsSessionLoading] = useState(true)
  const [isOAuthErrorRedirecting, setIsOAuthErrorRedirecting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const currentProfileQuery = useCurrentProfile({
    enabled: Boolean(session) && !isSessionLoading,
  })

  useEffect(() => {
    let isMounted = true
    const oauthError = readOAuthError(location.search, location.hash)

    if (oauthError) {
      setIsOAuthErrorRedirecting(true)
      navigate(ROUTES.login, {
        replace: true,
        state: { authError: oauthError },
      })
      setIsSessionLoading(false)

      return () => {
        isMounted = false
      }
    }

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
  }, [location.hash, location.search, navigate])

  useEffect(() => {
    if (isSessionLoading || isOAuthErrorRedirecting) {
      return
    }

    if (!session) {
      navigate(ROUTES.login, {
        replace: true,
        state: { authError: 'Не удалось завершить вход через Яндекс ID. Попробуйте ещё раз.' },
      })
      return
    }

    if (currentProfileQuery.isLoading) {
      return
    }

    const profile = currentProfileQuery.data

    if (!profile) {
      navigate(ROUTES.login, {
        replace: true,
        state: { authError: 'Профиль пользователя не найден после входа через Яндекс ID.' },
      })
      return
    }

    if (profile.role !== 'consumer') {
      void signOut().finally(() => {
        navigate(ROUTES.login, {
          replace: true,
          state: {
            authError:
              'Яндекс ID доступен только жителям. Сотрудникам нужно входить через рабочий email.',
          },
        })
      })
      return
    }

    navigate(isConsumerProfileComplete(profile) ? ROUTES.dashboard : ROUTES.profileSetup, {
      replace: true,
    })
  }, [
    currentProfileQuery.data,
    currentProfileQuery.isLoading,
    isOAuthErrorRedirecting,
    isSessionLoading,
    navigate,
    session,
  ])

  if (isOAuthErrorRedirecting) {
    return <LoadingScreen />
  }

  if (isSessionLoading || currentProfileQuery.isLoading) {
    return <LoadingScreen />
  }

  if (!session) {
    return <Navigate to={ROUTES.login} replace />
  }

  if (currentProfileQuery.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <Card className="w-full max-w-md rounded-lg border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>Вход не завершён</CardTitle>
            <CardDescription>Не удалось проверить профиль после входа через Яндекс ID.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert variant="destructive">
              <AlertTitle>Ошибка профиля</AlertTitle>
              <AlertDescription>{currentProfileQuery.error.message}</AlertDescription>
            </Alert>
            <Button className="w-full" onClick={() => void currentProfileQuery.refetch()}>
              Повторить
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <LoadingScreen />
}
