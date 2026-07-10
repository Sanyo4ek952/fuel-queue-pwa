import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, UserPlus } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import {
  consumerRegisterSchema,
  type ConsumerRegisterFormInput,
  type ConsumerRegisterFormValues,
  useRegisterConsumer,
} from '@/features/auth'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { useHcaptchaToken } from '@/shared/ui/hcaptcha'
import { Input } from '@/shared/ui/input'

export function ConsumerRegistrationForm() {
  const registerMutation = useRegisterConsumer()
  const hcaptcha = useHcaptchaToken()
  const form = useForm<ConsumerRegisterFormInput, unknown, ConsumerRegisterFormValues>({
    resolver: zodResolver(consumerRegisterSchema),
    defaultValues: {
      email: '',
      password: '',
      passwordConfirmation: '',
      firstName: '',
      lastName: '',
      middleName: '',
      phone: '',
      captchaToken: '',
    },
  })

  useEffect(() => {
    if (hcaptcha.token) {
      form.clearErrors('captchaToken')
    }
  }, [form, hcaptcha.token])

  async function handleSubmit(values: ConsumerRegisterFormValues) {
    try {
      if (!hcaptcha.token) {
        form.setError('captchaToken', { message: hcaptcha.error ?? 'Подтвердите hCaptcha.' })
        return
      }

      form.setValue('captchaToken', hcaptcha.token, { shouldValidate: true })

      await registerMutation.mutateAsync({
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
        middleName: values.middleName,
        phone: values.phone,
        captchaToken: hcaptcha.token,
      })
    } catch (error) {
      hcaptcha.reset()
      form.setValue('captchaToken', '')

      if (error instanceof Error && error.message.includes('hCaptcha')) {
        form.setError('captchaToken', { message: error.message })
      }
    }
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-5 text-slate-500" aria-hidden="true" />
          Регистрация жителя
        </CardTitle>
        <CardDescription>
          После регистрации подтвердите email, затем можно будет войти и добавить до 3 автомобилей.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="consumerLastName">Фамилия</FormLabel>
                <Input
                  id="consumerLastName"
                  autoComplete="family-name"
                  {...form.register('lastName')}
                />
                {form.formState.errors.lastName ? (
                  <FormMessage>{form.formState.errors.lastName.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="consumerFirstName">Имя</FormLabel>
                <Input
                  id="consumerFirstName"
                  autoComplete="given-name"
                  {...form.register('firstName')}
                />
                {form.formState.errors.firstName ? (
                  <FormMessage>{form.formState.errors.firstName.message}</FormMessage>
                ) : null}
              </FormItem>
            </div>

            <FormItem>
              <FormLabel htmlFor="consumerMiddleName">Отчество</FormLabel>
              <Input
                id="consumerMiddleName"
                autoComplete="additional-name"
                {...form.register('middleName')}
              />
              {form.formState.errors.middleName ? (
                <FormMessage>{form.formState.errors.middleName.message}</FormMessage>
              ) : null}
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="consumerPhone">Телефон</FormLabel>
              <Input id="consumerPhone" autoComplete="tel" {...form.register('phone')} />
              {form.formState.errors.phone ? (
                <FormMessage>{form.formState.errors.phone.message}</FormMessage>
              ) : null}
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="consumerEmail">Email</FormLabel>
              <Input
                id="consumerEmail"
                type="email"
                autoComplete="email"
                inputMode="email"
                {...form.register('email')}
              />
              {form.formState.errors.email ? (
                <FormMessage>{form.formState.errors.email.message}</FormMessage>
              ) : null}
            </FormItem>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="consumerPassword">Пароль</FormLabel>
                <Input
                  id="consumerPassword"
                  type="password"
                  autoComplete="new-password"
                  {...form.register('password')}
                />
                {form.formState.errors.password ? (
                  <FormMessage>{form.formState.errors.password.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="consumerPasswordConfirmation">Повтор пароля</FormLabel>
                <Input
                  id="consumerPasswordConfirmation"
                  type="password"
                  autoComplete="new-password"
                  {...form.register('passwordConfirmation')}
                />
                {form.formState.errors.passwordConfirmation ? (
                  <FormMessage>{form.formState.errors.passwordConfirmation.message}</FormMessage>
                ) : null}
              </FormItem>
            </div>

            <FormItem>
              <div className="min-h-[78px]">
                {hcaptcha.isLoading ? (
                  <div className="flex min-h-[78px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Загружаем hCaptcha...</span>
                  </div>
                ) : null}
                <div ref={hcaptcha.containerRef} />
              </div>
              {form.formState.errors.captchaToken || hcaptcha.error ? (
                <FormMessage>{form.formState.errors.captchaToken?.message ?? hcaptcha.error}</FormMessage>
              ) : null}
            </FormItem>

            {registerMutation.isSuccess ? (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                <AlertTitle>Регистрация отправлена</AlertTitle>
                <AlertDescription>
                  Проверьте почту и подтвердите email. После этого можно будет войти и добавить
                  автомобиль.
                </AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={registerMutation.isPending || hcaptcha.isLoading || registerMutation.isSuccess}
            >
              <UserPlus className="size-4" aria-hidden="true" />
              {registerMutation.isPending || hcaptcha.isLoading ? 'Регистрируем...' : 'Зарегистрироваться'}
            </Button>

            {registerMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Регистрация не выполнена</AlertTitle>
                <AlertDescription>{registerMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
