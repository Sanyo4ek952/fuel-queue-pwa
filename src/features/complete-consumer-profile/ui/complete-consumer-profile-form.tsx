import { zodResolver } from '@hookform/resolvers/zod'
import { UserRoundCheck } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'

import {
  completeConsumerProfileSchema,
  type CompleteConsumerProfileInput,
  type CompleteConsumerProfileValues,
  useCompleteConsumerProfile,
} from '@/features/complete-consumer-profile'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { PhoneNumberInput } from '@/shared/ui/phone-number-input'

type CompleteConsumerProfileFormProps = {
  defaultValues?: Partial<CompleteConsumerProfileInput>
  onSuccess?: () => void
}

export function CompleteConsumerProfileForm({
  defaultValues,
  onSuccess,
}: CompleteConsumerProfileFormProps) {
  const completeProfileMutation = useCompleteConsumerProfile()
  const form = useForm<CompleteConsumerProfileInput, unknown, CompleteConsumerProfileValues>({
    resolver: zodResolver(completeConsumerProfileSchema),
    defaultValues: {
      firstName: defaultValues?.firstName ?? '',
      lastName: defaultValues?.lastName ?? '',
      middleName: defaultValues?.middleName ?? '',
      phone: defaultValues?.phone ?? '',
    },
  })

  async function handleSubmit(values: CompleteConsumerProfileValues) {
    await completeProfileMutation.mutateAsync(values)
    onSuccess?.()
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRoundCheck className="size-5 text-slate-500" aria-hidden="true" />
          Заполните профиль
        </CardTitle>
        <CardDescription>
          Проверьте данные из Яндекс ID и укажите телефон для заявок на топливо.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormItem>
              <FormLabel htmlFor="lastName">Фамилия</FormLabel>
              <Input id="lastName" className="h-11" {...form.register('lastName')} />
              {form.formState.errors.lastName ? (
                <FormMessage>{form.formState.errors.lastName.message}</FormMessage>
              ) : null}
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="firstName">Имя</FormLabel>
              <Input id="firstName" className="h-11" {...form.register('firstName')} />
              {form.formState.errors.firstName ? (
                <FormMessage>{form.formState.errors.firstName.message}</FormMessage>
              ) : null}
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="middleName">Отчество</FormLabel>
              <Input id="middleName" className="h-11" {...form.register('middleName')} />
              {form.formState.errors.middleName ? (
                <FormMessage>{form.formState.errors.middleName.message}</FormMessage>
              ) : null}
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="phone">Телефон</FormLabel>
              <Controller
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <PhoneNumberInput
                    id="phone"
                    className="h-11"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
              {form.formState.errors.phone ? (
                <FormMessage>{form.formState.errors.phone.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button type="submit" className="h-11 w-full gap-2" disabled={completeProfileMutation.isPending}>
              <UserRoundCheck className="size-4" aria-hidden="true" />
              {completeProfileMutation.isPending ? 'Сохраняем...' : 'Сохранить профиль'}
            </Button>

            {completeProfileMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Профиль не сохранён</AlertTitle>
                <AlertDescription>{completeProfileMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
