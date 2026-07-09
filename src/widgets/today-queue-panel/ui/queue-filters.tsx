import type { QueueAuthorOption } from '@/entities/reservation'
import type { QueueFuelType } from '@/shared/constants'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

import { fuelTypeLabels, getCallFilterLabel } from '../model/labels'
import {
  ALL_AUTHORS_FILTER,
  ALL_GASOLINE_FILTER,
  CALL_FILTERS,
  GASOLINE_FUEL_FILTERS,
  type CallFilter,
  type GasolineFuelFilter,
} from '../model/types'
import type { callFiltersWithCounters } from '../model/queue-model'

type QueueFiltersProps = {
  callFilter: CallFilter
  plateSearch: string
  gasolineFuelFilter: GasolineFuelFilter
  authorFilter: string
  authorOptions: QueueAuthorOption[]
  callFilterCounts: Record<(typeof callFiltersWithCounters)[number], number>
  onCallFilterChange: (value: CallFilter) => void
  onPlateSearchChange: (value: string) => void
  onGasolineFuelFilterChange: (value: GasolineFuelFilter) => void
  onAuthorFilterChange: (value: string) => void
}

export function QueueFilters({
  callFilter,
  plateSearch,
  gasolineFuelFilter,
  authorFilter,
  authorOptions,
  callFilterCounts,
  onCallFilterChange,
  onPlateSearchChange,
  onGasolineFuelFilterChange,
  onAuthorFilterChange,
}: QueueFiltersProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label htmlFor="queueCallFilter" className="text-sm font-medium text-slate-700">
          Обзвон
        </label>
        <Select value={callFilter} onValueChange={(value) => onCallFilterChange(value as CallFilter)}>
          <SelectTrigger
            id="queueCallFilter"
            className="h-8 w-full [&_[data-call-filter-count]]:hidden"
          >
            <SelectValue placeholder="Все" />
          </SelectTrigger>
          <SelectContent>
            {CALL_FILTERS.map((filter) => (
              <SelectItem key={filter} value={filter} textValue={getCallFilterLabel(filter)}>
                {filter === 'all' ? (
                  getCallFilterLabel(filter)
                ) : (
                  <span className="flex w-full items-center justify-between gap-3">
                    <span>{getCallFilterLabel(filter)}</span>
                    <span
                      data-call-filter-count
                      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700"
                    >
                      {callFilterCounts[filter]}
                    </span>
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="queuePlateSearch" className="text-sm font-medium text-slate-700">
          Поиск по госномеру
        </label>
        <Input
          id="queuePlateSearch"
          value={plateSearch}
          onChange={(event) => onPlateSearchChange(event.target.value)}
          placeholder="А123ВС777"
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="queueGasolineFuelFilter" className="text-sm font-medium text-slate-700">
          Марка бензина
        </label>
        <Select
          value={gasolineFuelFilter}
          onValueChange={(value) => onGasolineFuelFilterChange(value as GasolineFuelFilter)}
        >
          <SelectTrigger id="queueGasolineFuelFilter" className="h-8 w-full">
            <SelectValue placeholder="Все марки" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_GASOLINE_FILTER}>Все марки</SelectItem>
            {GASOLINE_FUEL_FILTERS.map((fuelType) => (
              <SelectItem key={fuelType} value={fuelType}>
                {fuelTypeLabels[fuelType as QueueFuelType]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="queueAuthorFilter" className="text-sm font-medium text-slate-700">
          Кто добавил
        </label>
        <Select value={authorFilter} onValueChange={onAuthorFilterChange}>
          <SelectTrigger id="queueAuthorFilter" className="h-8 w-full">
            <SelectValue placeholder="Все авторы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_AUTHORS_FILTER}>Все авторы</SelectItem>
            {authorOptions.map((author) => (
              <SelectItem key={author.userId} value={author.userId}>
                {author.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
