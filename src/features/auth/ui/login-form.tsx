import { zodResolver } from '@hookform/resolvers/zod'
import { LogIn } from 'lucide-react'
import { useForm } from 'react-hook-form'

import {
  type LoginFormInput,
  type LoginFormValues,
  loginSchema,
  useLogin,
  useYandexLogin,
} from '@/features/auth'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

type LoginFormProps = {
  onSuccess?: () => void
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const loginMutation = useLogin()
  const yandexLoginMutation = useYandexLogin()
  const form = useForm<LoginFormInput, unknown, LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function handleSubmit(values: LoginFormValues) {
    await loginMutation.mutateAsync(values)
    onSuccess?.()
  }

  async function handleYandexLogin() {
    await yandexLoginMutation.mutateAsync()
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LogIn className="size-5 text-slate-500" aria-hidden="true" />
          Вход
        </CardTitle>
        <CardDescription>Используйте рабочую учётную запись АЗС.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormItem>
              <FormLabel htmlFor="email">Email</FormLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                className="h-11"
                {...form.register('email')}
              />
              {form.formState.errors.email ? (
                <FormMessage>{form.formState.errors.email.message}</FormMessage>
              ) : null}
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="password">Пароль</FormLabel>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="h-11"
                {...form.register('password')}
              />
              {form.formState.errors.password ? (
                <FormMessage>{form.formState.errors.password.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button type="submit" className="h-11 w-full gap-2" disabled={loginMutation.isPending}>
              <LogIn className="size-4" aria-hidden="true" />
              {loginMutation.isPending ? 'Входим...' : 'Войти'}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-11 w-full gap-2"
              disabled={yandexLoginMutation.isPending}
              onClick={handleYandexLogin}
            >
              <span className="flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold leading-none text-white" aria-hidden="true">
                Я
              </span>
              {yandexLoginMutation.isPending ? 'Открываем Яндекс ID...' : 'Войти через Яндекс ID'}
            </Button>

            {loginMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Вход не выполнен</AlertTitle>
                <AlertDescription>{loginMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {yandexLoginMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Вход через Яндекс ID не выполнен</AlertTitle>
                <AlertDescription>{yandexLoginMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
