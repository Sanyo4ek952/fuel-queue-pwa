import { useLocation, useNavigate } from 'react-router-dom'

import { LoginForm } from '@/features/auth'
import { ROUTES } from '@/shared/config/routes'

type LocationState = {
  from?: {
    pathname?: string
  }
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as LocationState | null)?.from?.pathname ?? ROUTES.dashboard

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <div>
          <p className="text-sm text-slate-500">Fuel Queue PWA</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Вход в приложение</h1>
        </div>
        <LoginForm onSuccess={() => navigate(from, { replace: true })} />
      </div>
    </main>
  )
}
