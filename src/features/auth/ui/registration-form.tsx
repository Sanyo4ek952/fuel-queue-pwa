import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'

import {
  AUTH_RATE_LIMIT_MESSAGE,
  REGISTERABLE_ROLES,
  type RegisterFormInput,
  type RegisterFormValues,
  isAuthRateLimitError,
  registerSchema,
  useRegister,
  useResendSignupConfirmation,
} from '@/features/auth'
import { ROLE_LABELS } from '@/shared/config/roles'
import { STATIONS } from '@/shared/config/stations'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { useHcaptchaToken } from '@/shared/ui/hcaptcha'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

const EMAIL_RESEND_COOLDOWN_SECONDS = 60

export function RegistrationForm() {
  const registerMutation = useRegister()
  const resendMutation = useResendSignupConfirmation()
  const hcaptcha = useHcaptchaToken()
  const [resendCooldown, setResendCooldown] = useState(0)
  const form = useForm<RegisterFormInput, unknown, RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      passwordConfirmation: '',
      firstName: '',
      lastName: '',
      middleName: '',
      position: '',
      signatureName: '',
      requestedRole: 'cashier',
      requestedStationId: STATIONS[0]?.id ?? '',
      captchaToken: '',
    },
  })
  const requestedRole = form.watch('requestedRole')
  const isResendDisabled =
    resendMutation.isPending || hcaptcha.isLoading || resendCooldown > 0

  useEffect(() => {
    if (hcaptcha.token) {
      form.clearErrors('captchaToken')
    }
  }, [form, hcaptcha.token])

  useEffect(() => {
    if (!registerMutation.isSuccess) {
      return
    }

    hcaptcha.reset()
    form.setValue('captchaToken', '')
    setResendCooldown(EMAIL_RESEND_COOLDOWN_SECONDS)
  }, [form, hcaptcha.reset, registerMutation.isSuccess])

  useEffect(() => {
    if (resendCooldown <= 0) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearTimeout(timeoutId)
  }, [resendCooldown])

  async function handleSubmit(values: RegisterFormValues) {
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
        position: values.position,
        signatureName: values.signatureName,
        requestedRole: values.requestedRole,
        requestedStationId: values.requestedRole === 'cashier' ? values.requestedStationId : undefined,
        captchaToken: hcaptcha.token,
      })
    } catch (error) {
      if (isAuthRateLimitError(error)) {
        setResendCooldown(EMAIL_RESEND_COOLDOWN_SECONDS)
      }

      hcaptcha.reset()
      form.setValue('captchaToken', '')

      if (error instanceof Error && error.message.includes('hCaptcha')) {
        form.setError('captchaToken', { message: error.message })
      }
    }
  }

  async function handleResendConfirmationEmail() {
    resendMutation.reset()

    if (!hcaptcha.token) {
      form.setError('captchaToken', { message: hcaptcha.error ?? 'Подтвердите hCaptcha.' })
      return
    }

    try {
      await resendMutation.mutateAsync({
        email: form.getValues('email'),
        captchaToken: hcaptcha.token,
      })
      hcaptcha.reset()
      form.setValue('captchaToken', '')
      setResendCooldown(EMAIL_RESEND_COOLDOWN_SECONDS)
    } catch (error) {
      if (isAuthRateLimitError(error)) {
        setResendCooldown(EMAIL_RESEND_COOLDOWN_SECONDS)
      }

      hcaptcha.reset()
      form.setValue('captchaToken', '')
    }
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-5 text-slate-500" aria-hidden="true" />
          Заявка на регистрацию
        </CardTitle>
        <CardDescription>
          Доступ появится только после подтверждения email и проверки заявки руководителем.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="lastName">Фамилия</FormLabel>
                <Input id="lastName" autoComplete="family-name" {...form.register('lastName')} />
                {form.formState.errors.lastName ? (
                  <FormMessage>{form.formState.errors.lastName.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="firstName">Имя</FormLabel>
                <Input id="firstName" autoComplete="given-name" {...form.register('firstName')} />
                {form.formState.errors.firstName ? (
                  <FormMessage>{form.formState.errors.firstName.message}</FormMessage>
                ) : null}
              </FormItem>
            </div>

            <FormItem>
              <FormLabel htmlFor="middleName">Отчество</FormLabel>
              <Input
                id="middleName"
                autoComplete="additional-name"
                {...form.register('middleName')}
              />
              {form.formState.errors.middleName ? (
                <FormMessage>{form.formState.errors.middleName.message}</FormMessage>
              ) : null}
            </FormItem>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="position">Должность</FormLabel>
                <Input id="position" autoComplete="organization-title" {...form.register('position')} />
                {form.formState.errors.position ? (
                  <FormMessage>{form.formState.errors.position.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="signatureName">Подпись</FormLabel>
                <Input
                  id="signatureName"
                  placeholder="Иванов И.И."
                  {...form.register('signatureName')}
                />
                {form.formState.errors.signatureName ? (
                  <FormMessage>{form.formState.errors.signatureName.message}</FormMessage>
                ) : null}
              </FormItem>
            </div>

            <FormItem>
              <FormLabel htmlFor="requestedRole">Роль</FormLabel>
              <Select
                value={requestedRole}
                onValueChange={(value) => {
                  const role = value as RegisterFormValues['requestedRole']
                  form.setValue('requestedRole', role, { shouldValidate: true })
                  form.setValue(
                    'requestedStationId',
                    role === 'cashier' ? (form.getValues('requestedStationId') || STATIONS[0]?.id || '') : '',
                    { shouldValidate: true },
                  )
                }}
              >
                <SelectTrigger id="requestedRole" className="h-10 w-full bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {REGISTERABLE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.requestedRole ? (
                <FormMessage>{form.formState.errors.requestedRole.message}</FormMessage>
              ) : null}
            </FormItem>

            {requestedRole === 'cashier' ? (
              <FormItem>
                <FormLabel htmlFor="requestedStationId">АЗС</FormLabel>
                <Select
                  value={form.watch('requestedStationId')}
                  onValueChange={(value) =>
                    form.setValue('requestedStationId', value, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="requestedStationId" className="h-10 w-full bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    {STATIONS.map((station) => (
                      <SelectItem key={station.id} value={station.id}>
                        {station.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.requestedStationId ? (
                  <FormMessage>{form.formState.errors.requestedStationId.message}</FormMessage>
                ) : null}
              </FormItem>
            ) : null}

            <FormItem>
              <FormLabel htmlFor="registerEmail">Email</FormLabel>
              <Input
                id="registerEmail"
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
                <FormLabel htmlFor="registerPassword">Пароль</FormLabel>
                <Input
                  id="registerPassword"
                  type="password"
                  autoComplete="new-password"
                  {...form.register('password')}
                />
                {form.formState.errors.password ? (
                  <FormMessage>{form.formState.errors.password.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="passwordConfirmation">Повтор пароля</FormLabel>
                <Input
                  id="passwordConfirmation"
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
                <AlertTitle>Заявка отправлена</AlertTitle>
                <AlertDescription>
                  Проверьте почту и подтвердите email. Если письма нет во входящих, проверьте
                  папку «Спам». После подтверждения руководитель сможет проверить данные и
                  назначить доступ.
                  <div className="mt-3 space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-full border-emerald-300 bg-white text-emerald-950 hover:bg-emerald-100"
                      disabled={isResendDisabled}
                      onClick={handleResendConfirmationEmail}
                    >
                      {resendMutation.isPending ? (
                        <>
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          Отправляем...
                        </>
                      ) : resendCooldown > 0 ? (
                        `Повторно через ${resendCooldown} сек.`
                      ) : (
                        'Отправить письмо повторно'
                      )}
                    </Button>
                    {resendMutation.isSuccess ? (
                      <p className="text-sm font-medium">Письмо отправлено повторно.</p>
                    ) : null}
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={registerMutation.isPending || hcaptcha.isLoading || registerMutation.isSuccess}
            >
              <Send className="size-4" aria-hidden="true" />
              {registerMutation.isPending || hcaptcha.isLoading ? 'Отправляем...' : 'Отправить заявку'}
            </Button>

            {registerMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Заявка не отправлена</AlertTitle>
                <AlertDescription>
                  {isAuthRateLimitError(registerMutation.error)
                    ? AUTH_RATE_LIMIT_MESSAGE
                    : registerMutation.error.message}
                </AlertDescription>
              </Alert>
            ) : null}

            {resendMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Письмо не отправлено</AlertTitle>
                <AlertDescription>
                  {isAuthRateLimitError(resendMutation.error)
                    ? AUTH_RATE_LIMIT_MESSAGE
                    : resendMutation.error.message}
                </AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
