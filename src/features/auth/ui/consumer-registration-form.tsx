import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus } from 'lucide-react'
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
import { Input } from '@/shared/ui/input'

type ConsumerRegistrationFormProps = {
  onSuccess?: () => void
}

export function ConsumerRegistrationForm({ onSuccess }: ConsumerRegistrationFormProps) {
  const registerMutation = useRegisterConsumer()
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
    },
  })

  async function handleSubmit(values: ConsumerRegisterFormValues) {
    await registerMutation.mutateAsync({
      email: values.email,
      password: values.password,
      firstName: values.firstName,
      lastName: values.lastName,
      middleName: values.middleName,
      phone: values.phone,
    })

    onSuccess?.()
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-5 text-slate-500" aria-hidden="true" />
          Регистрация жителя
        </CardTitle>
        <CardDescription>
          После регистрации можно добавить до 3 автомобилей и встать в общую очередь.
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

            <Button type="submit" className="h-11 w-full gap-2" disabled={registerMutation.isPending}>
              <UserPlus className="size-4" aria-hidden="true" />
              {registerMutation.isPending ? 'Регистрируем...' : 'Зарегистрироваться'}
            </Button>

            {registerMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Регистрация не выполнена</AlertTitle>
                <AlertDescription>{registerMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {registerMutation.isSuccess ? (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                <AlertTitle>Регистрация выполнена</AlertTitle>
                <AlertDescription>Теперь можно войти и добавить автомобиль.</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
