import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type SelectedStationState = {
  selectedStationId: string
  setSelectedStationId: (stationId: string) => void
}

export const useSelectedStation = create<SelectedStationState>()(
  persist(
    (set) => ({
      selectedStationId: '',
      setSelectedStationId: (stationId) => set({ selectedStationId: stationId }),
    }),
    {
      name: 'fuel-queue-selected-station',
    },
  ),
)
