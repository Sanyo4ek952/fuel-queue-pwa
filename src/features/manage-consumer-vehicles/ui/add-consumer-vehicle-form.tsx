import { zodResolver } from '@hookform/resolvers/zod'
import { Car, Plus } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'

import { PlateNumberInput } from '@/entities/vehicle'
import {
  addConsumerVehicleSchema,
  type AddConsumerVehicleFormInput,
  type AddConsumerVehicleFormValues,
  useCreateConsumerVehicle,
} from '@/features/manage-consumer-vehicles'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'

type AddConsumerVehicleFormProps = {
  disabled?: boolean
}

export function AddConsumerVehicleForm({ disabled }: AddConsumerVehicleFormProps) {
  const createVehicleMutation = useCreateConsumerVehicle()
  const form = useForm<AddConsumerVehicleFormInput, unknown, AddConsumerVehicleFormValues>({
    resolver: zodResolver(addConsumerVehicleSchema),
    defaultValues: {
      plateNumber: '',
    },
  })

  async function handleSubmit(values: AddConsumerVehicleFormValues) {
    await createVehicleMutation.mutateAsync({
      plateNumber: values.plateNumber,
      clientMutationId: crypto.randomUUID(),
    })

    form.reset({ plateNumber: '' })
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Car className="size-5 text-slate-500" aria-hidden="true" />
          Мои автомобили
        </CardTitle>
        <CardDescription>Можно добавить до 3 действующих госномеров.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-3" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormItem>
              <FormLabel htmlFor="consumerPlateNumber">Госномер</FormLabel>
              <Controller
                control={form.control}
                name="plateNumber"
                render={({ field }) => (
                  <PlateNumberInput
                    id="consumerPlateNumber"
                    className="uppercase"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                    disabled={disabled || createVehicleMutation.isPending}
                  />
                )}
              />
              {form.formState.errors.plateNumber ? (
                <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button
              type="submit"
              className="h-10 w-full gap-2"
              disabled={disabled || createVehicleMutation.isPending}
            >
              <Plus className="size-4" aria-hidden="true" />
              {createVehicleMutation.isPending ? 'Добавляем...' : 'Добавить автомобиль'}
            </Button>

            {createVehicleMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Автомобиль не добавлен</AlertTitle>
                <AlertDescription>{createVehicleMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
