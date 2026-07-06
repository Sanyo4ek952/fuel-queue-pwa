import { useEffect, useState } from 'react'

type StationOption = {
  id: string
}

export function useProfileStationSelection(stations: StationOption[]) {
  const [stationId, setStationId] = useState('')

  useEffect(() => {
    if (stations.some((station) => station.id === stationId)) {
      return
    }

    setStationId(stations[0]?.id ?? '')
  }, [stationId, stations])

  return [stationId, setStationId] as const
}
