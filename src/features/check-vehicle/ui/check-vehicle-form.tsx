import { zodResolver } from '@hookform/resolvers/zod'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import {
  type CheckVehicleFormValues,
  checkVehicleSchema,
} from '@/features/check-vehicle/model/schema'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import { Button } from '@/shared/ui/button'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

export function CheckVehicleForm() {
  const [normalizedPlateNumber, setNormalizedPlateNumber] = useState('')
  const form = useForm<CheckVehicleFormValues>({
    resolver: zodResolver(checkVehicleSchema),
    defaultValues: {
      plateNumber: '',
    },
  })

  function handleSubmit(values: CheckVehicleFormValues) {
    setNormalizedPlateNumber(normalizePlateNumber(values.plateNumber))
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
        <FormItem>
          <FormLabel htmlFor="plateNumber">Госномер</FormLabel>
          <Input
            id="plateNumber"
            autoComplete="off"
            inputMode="text"
            placeholder="А123ВС"
            className="h-12 text-lg uppercase"
            {...form.register('plateNumber')}
          />
          {form.formState.errors.plateNumber ? (
            <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
          ) : null}
        </FormItem>
        <Button type="submit" className="h-11 w-full gap-2">
          <Search className="size-4" aria-hidden="true" />
          Проверить
        </Button>
        {normalizedPlateNumber ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Нормализованный номер</p>
            <p className="mt-1 text-2xl font-semibold tracking-wide">{normalizedPlateNumber}</p>
          </div>
        ) : null}
      </form>
    </Form>
  )
}
