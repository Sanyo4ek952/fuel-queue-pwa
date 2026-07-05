import { useLocation, useNavigate } from 'react-router-dom'

import { LoginForm, RegistrationForm } from '@/features/auth'
import { ROUTES } from '@/shared/config/routes'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

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
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid h-10 w-full grid-cols-2">
            <TabsTrigger value="login">Вход</TabsTrigger>
            <TabsTrigger value="register">Регистрация</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <LoginForm onSuccess={() => navigate(from, { replace: true })} />
          </TabsContent>
          <TabsContent value="register">
            <RegistrationForm onSuccess={() => navigate(ROUTES.dashboard, { replace: true })} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}
