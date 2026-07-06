import { MapPin } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { FormItem, FormLabel } from '@/shared/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

type StationOption = {
  id: string
  name: string
}

type StationSelectFieldProps = {
  id: string
  value: string
  stations: StationOption[]
  onValueChange: (stationId: string) => void
  label?: string
  emptyMessage?: string
  className?: string
}

export function StationSelectField({
  id,
  value,
  stations,
  onValueChange,
  label = 'АЗС',
  emptyMessage = 'АЗС не назначена.',
  className,
}: StationSelectFieldProps) {
  if (stations.length === 0) {
    return <p className={cn('text-sm text-slate-500', className)}>{emptyMessage}</p>
  }

  if (stations.length === 1) {
    return null
  }

  return (
    <FormItem className={className}>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className="h-10 w-full bg-white">
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
            <SelectValue placeholder="Выберите АЗС" />
          </span>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {stations.map((station) => (
            <SelectItem key={station.id} value={station.id}>
              {station.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormItem>
  )
}
