import { MapPin } from 'lucide-react'
import { useEffect } from 'react'

import { useCurrentProfile } from '@/entities/profile'
import {
  getAvailableStations,
  getNextSelectedStationId,
} from '@/features/select-station/model/available-stations'
import { useSelectedStation } from '@/features/select-station/model/store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

export function StationSelect() {
  const selectedStationId = useSelectedStation((state) => state.selectedStationId)
  const setSelectedStationId = useSelectedStation((state) => state.setSelectedStationId)
  const currentProfileQuery = useCurrentProfile()
  const stations = getAvailableStations(currentProfileQuery.data)

  useEffect(() => {
    if (!currentProfileQuery.data) {
      return
    }

    const nextSelectedStationId = getNextSelectedStationId(selectedStationId, stations)

    if (nextSelectedStationId !== selectedStationId) {
      setSelectedStationId(nextSelectedStationId)
    }
  }, [currentProfileQuery.data, selectedStationId, setSelectedStationId, stations])

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700" htmlFor="station-select-trigger">
        АЗС
      </label>
      <Select value={selectedStationId} onValueChange={setSelectedStationId}>
        <SelectTrigger id="station-select-trigger" className="h-11 w-full bg-white">
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
    </div>
  )
}
