import { zodResolver } from '@hookform/resolvers/zod'
import { Send } from 'lucide-react'
import { useForm } from 'react-hook-form'

import {
  type RegisterFormInput,
  type RegisterFormValues,
  registerSchema,
  useRegister,
} from '@/features/auth'
import { STATIONS } from '@/features/select-station'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

type RegistrationFormProps = {
  onSuccess?: () => void
}

export function RegistrationForm({ onSuccess }: RegistrationFormProps) {
  const registerMutation = useRegister()
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
      requestedStationId: STATIONS[0]?.id ?? '',
    },
  })

  async function handleSubmit(values: RegisterFormValues) {
    await registerMutation.mutateAsync({
      email: values.email,
      password: values.password,
      firstName: values.firstName,
      lastName: values.lastName,
      middleName: values.middleName,
      position: values.position,
      signatureName: values.signatureName,
      requestedStationId: values.requestedStationId,
    })

    onSuccess?.()
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-5 text-slate-500" aria-hidden="true" />
          Заявка на регистрацию
        </CardTitle>
        <CardDescription>
          Доступ появится только после подтверждения руководителем.
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

            <Button type="submit" className="h-11 w-full gap-2" disabled={registerMutation.isPending}>
              <Send className="size-4" aria-hidden="true" />
              {registerMutation.isPending ? 'Отправляем...' : 'Отправить заявку'}
            </Button>

            {registerMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Заявка не отправлена</AlertTitle>
                <AlertDescription>{registerMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {registerMutation.isSuccess ? (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                <AlertTitle>Заявка отправлена</AlertTitle>
                <AlertDescription>Руководитель проверит данные и назначит доступ.</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
