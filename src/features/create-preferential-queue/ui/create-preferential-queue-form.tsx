import { zodResolver } from '@hookform/resolvers/zod'
import { ListPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'

import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import {
  type CreatePreferentialQueueFormInput,
  type CreatePreferentialQueueFormValues,
  createPreferentialQueueSchema,
} from '../model/schema'
import { useCreatePreferentialQueue } from '../model/use-create-preferential-queue'

export function CreatePreferentialQueueForm() {
  const createQueueMutation = useCreatePreferentialQueue()
  const form = useForm<
    CreatePreferentialQueueFormInput,
    unknown,
    CreatePreferentialQueueFormValues
  >({
    resolver: zodResolver(createPreferentialQueueSchema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
    },
  })

  async function handleSubmit(values: CreatePreferentialQueueFormValues) {
    await createQueueMutation.mutateAsync({
      name: values.name,
      clientMutationId: crypto.randomUUID(),
    })
    form.reset()
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListPlus className="size-5 text-slate-500" aria-hidden="true" />
          Новая льготная очередь
        </CardTitle>
        <CardDescription>Создайте отдельный список, например «Врачи».</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormItem>
              <FormLabel htmlFor="preferentialQueueName">Название</FormLabel>
              <Input id="preferentialQueueName" {...form.register('name')} />
              {form.formState.errors.name ? (
                <FormMessage>{form.formState.errors.name.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button type="submit" className="h-11 w-full gap-2" disabled={createQueueMutation.isPending}>
              <ListPlus className="size-4" aria-hidden="true" />
              {createQueueMutation.isPending ? 'Создаем...' : 'Создать очередь'}
            </Button>

            {createQueueMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Очередь не создана</AlertTitle>
                <AlertDescription>{createQueueMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
