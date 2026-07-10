import { Link, useLocation, useNavigate } from 'react-router-dom'

import { ConsumerRegistrationForm, LoginForm, RegistrationForm } from '@/features/auth'
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
          <p className="text-sm text-slate-500">АЗС Онлайн</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Вход в приложение</h1>
        </div>
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid h-10 w-full grid-cols-3">
            <TabsTrigger value="login">Вход</TabsTrigger>
            <TabsTrigger value="consumer">Житель</TabsTrigger>
            <TabsTrigger value="register">Сотрудник</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <LoginForm onSuccess={() => navigate(from, { replace: true })} />
          </TabsContent>
          <TabsContent value="register">
            <RegistrationForm />
          </TabsContent>
          <TabsContent value="consumer">
            <ConsumerRegistrationForm />
          </TabsContent>
        </Tabs>
        <Link
          to={ROUTES.queueCheck}
          className="block rounded-lg border border-slate-200 bg-white p-3 text-center text-sm font-medium text-slate-700 underline-offset-4 shadow-sm transition-colors hover:bg-slate-50 hover:underline"
        >
          Проверить номер без входа
        </Link>
      </div>
    </main>
  )
}
