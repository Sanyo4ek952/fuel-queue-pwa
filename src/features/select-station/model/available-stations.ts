import type { ProfileWithStations } from '@/entities/profile'

import { STATIONS, type Station } from './stations'

export function getAvailableStations(profile?: ProfileWithStations | null): Station[] {
  if (!profile) {
    return STATIONS
  }

  return profile.stations.map((station) => ({
    id: station.id,
    name: station.name,
    address: station.address ?? '',
  }))
}

export function getNextSelectedStationId(selectedStationId: string, stations: Station[]) {
  if (stations.some((station) => station.id === selectedStationId)) {
    return selectedStationId
  }

  return stations[0]?.id ?? ''
}
