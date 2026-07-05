import { MapPin } from 'lucide-react'
import { useEffect, useId } from 'react'

import { useCurrentProfile } from '@/entities/profile'
import {
  getAvailableStations,
  getNextSelectedStationId,
} from '@/features/select-station/model/available-stations'
import { useSelectedStation } from '@/features/select-station/model/store'
import { cn } from '@/shared/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

type StationSelectProps = {
  showLabel?: boolean
  className?: string
  triggerClassName?: string
}

export function StationSelect({
  showLabel = true,
  className,
  triggerClassName,
}: StationSelectProps = {}) {
  const triggerId = useId()
  const selectedStationId = useSelectedStation(
    (state) => state.selectedStationId,
  )
  const setSelectedStationId = useSelectedStation(
    (state) => state.setSelectedStationId,
  )
  const currentProfileQuery = useCurrentProfile()
  const stations = getAvailableStations(currentProfileQuery.data)

  useEffect(() => {
    if (!currentProfileQuery.data) {
      return
    }

    const nextSelectedStationId = getNextSelectedStationId(
      selectedStationId,
      stations,
    )

    if (nextSelectedStationId !== selectedStationId) {
      setSelectedStationId(nextSelectedStationId)
    }
  }, [
    currentProfileQuery.data,
    selectedStationId,
    setSelectedStationId,
    stations,
  ])

  return (
    <div className={cn('space-y-2', className)}>
      <label
        className={cn(
          'text-sm font-medium text-slate-700',
          !showLabel && 'sr-only',
        )}
        htmlFor={triggerId}
      >
        АЗС
      </label>
      <Select value={selectedStationId} onValueChange={setSelectedStationId}>
        <SelectTrigger
          id={triggerId}
          className={cn('h-11 w-full bg-white', triggerClassName)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <MapPin
              className="size-4 shrink-0 text-slate-500"
              aria-hidden="true"
            />
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
    </div>
  )
}
