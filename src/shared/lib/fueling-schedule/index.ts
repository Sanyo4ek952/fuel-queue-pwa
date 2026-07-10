import type { FuelQueueCategory } from '@/shared/constants'

export type FuelingScheduleConfig = {
  fuelCategory: FuelQueueCategory
  date: string
  startTime: string
  intervalMinutes: number
  vehiclesPerInterval: number
}

export type FuelingScheduleQueueRow = {
  id: string
  ticketNumber: number
  fuelCategory: FuelQueueCategory | null
}

export type FuelingScheduleEtaRow = {
  id: string
  categoryPosition: number
  arrivalTime: string | null
}

export type FuelingScheduleSummary = {
  fuelCategory: FuelQueueCategory
  queueCount: number
  startTime: string | null
  endTime: string | null
  intervalMinutes: number | null
  vehiclesPerInterval: number | null
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
})

const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)

  if (!match) {
    return null
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }

  return hours * 60 + minutes
}

function parseScheduleStartDate(schedule: FuelingScheduleConfig) {
  const timeMinutes = parseTimeToMinutes(schedule.startTime)
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(schedule.date)

  if (timeMinutes === null || !dateMatch) {
    return null
  }

  const year = Number(dateMatch[1])
  const monthIndex = Number(dateMatch[2]) - 1
  const day = Number(dateMatch[3])
  const hours = Math.floor(timeMinutes / 60)
  const minutes = timeMinutes % 60
  const date = new Date(year, monthIndex, day, hours, minutes)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes
  ) {
    return null
  }

  return date
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function formatScheduleDateTime(date: Date) {
  return `${timeFormatter.format(date)} ${dateFormatter.format(date)}`
}

function isUsableSchedule(
  schedule: FuelingScheduleConfig | undefined,
): schedule is FuelingScheduleConfig {
  return Boolean(
    schedule &&
      parseScheduleStartDate(schedule) !== null &&
      schedule.intervalMinutes > 0 &&
      schedule.vehiclesPerInterval > 0,
  )
}

export function addMinutesToTime(time: string, minutes: number) {
  const startMinutes = parseTimeToMinutes(time)

  if (startMinutes === null) {
    return null
  }

  const dayMinutes = startMinutes + minutes
  const hours = Math.floor(dayMinutes / 60) % 24
  const normalizedHours = hours < 0 ? hours + 24 : hours
  const normalizedMinutes = ((dayMinutes % 60) + 60) % 60

  return `${String(normalizedHours).padStart(2, '0')}:${String(normalizedMinutes).padStart(2, '0')}`
}

export function calculateArrivalTime(
  schedule: FuelingScheduleConfig | undefined,
  categoryPosition: number,
) {
  if (!isUsableSchedule(schedule) || categoryPosition < 1) {
    return null
  }

  const startDate = parseScheduleStartDate(schedule)

  if (!startDate) {
    return null
  }

  const intervalIndex = Math.floor((categoryPosition - 1) / schedule.vehiclesPerInterval)

  return formatScheduleDateTime(addMinutes(startDate, intervalIndex * schedule.intervalMinutes))
}

export function calculateFuelingEndTime(
  schedule: FuelingScheduleConfig | undefined,
  queueCount: number,
) {
  if (!isUsableSchedule(schedule)) {
    return null
  }

  const startDate = parseScheduleStartDate(schedule)

  if (!startDate) {
    return null
  }

  if (queueCount <= 0) {
    return formatScheduleDateTime(startDate)
  }

  const intervalCount = Math.ceil(queueCount / schedule.vehiclesPerInterval)

  return formatScheduleDateTime(addMinutes(startDate, intervalCount * schedule.intervalMinutes))
}

export function buildFuelingScheduleEta(
  rows: FuelingScheduleQueueRow[],
  schedules: FuelingScheduleConfig[],
) {
  const schedulesByCategory = new Map(schedules.map((schedule) => [schedule.fuelCategory, schedule]))
  const sortedRows = [...rows].sort(
    (left, right) => left.ticketNumber - right.ticketNumber || left.id.localeCompare(right.id),
  )
  const positionByCategory = new Map<FuelQueueCategory, number>()
  const result = new Map<string, FuelingScheduleEtaRow>()

  sortedRows.forEach((row) => {
    if (!row.fuelCategory) {
      result.set(row.id, {
        id: row.id,
        categoryPosition: 0,
        arrivalTime: null,
      })
      return
    }

    const categoryPosition = (positionByCategory.get(row.fuelCategory) ?? 0) + 1
    positionByCategory.set(row.fuelCategory, categoryPosition)

    result.set(row.id, {
      id: row.id,
      categoryPosition,
      arrivalTime: calculateArrivalTime(schedulesByCategory.get(row.fuelCategory), categoryPosition),
    })
  })

  return result
}

export function buildFuelingScheduleSummary(
  rows: FuelingScheduleQueueRow[],
  schedules: FuelingScheduleConfig[],
  fuelCategories: FuelQueueCategory[],
  queueCountsByCategory?: Partial<Record<FuelQueueCategory, number>>,
): FuelingScheduleSummary[] {
  const schedulesByCategory = new Map(schedules.map((schedule) => [schedule.fuelCategory, schedule]))

  return fuelCategories.map((fuelCategory) => {
    const schedule = schedulesByCategory.get(fuelCategory)
    const queueCount =
      queueCountsByCategory?.[fuelCategory] ??
      rows.filter((row) => row.fuelCategory === fuelCategory).length

    return {
      fuelCategory,
      queueCount,
      startTime: schedule ? calculateFuelingEndTime(schedule, 0) : null,
      endTime: calculateFuelingEndTime(schedule, queueCount),
      intervalMinutes: schedule?.intervalMinutes ?? null,
      vehiclesPerInterval: schedule?.vehiclesPerInterval ?? null,
    }
  })
}
