import { subDays, format } from 'date-fns'
import { z } from 'zod'

export const FUELING_REPORT_PERIOD_PRESETS = ['today', 'week', 'month', 'custom'] as const
const uuidLikePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FuelingReportPeriodPreset = (typeof FUELING_REPORT_PERIOD_PRESETS)[number]

export type FuelingReportDateRange = {
  dateFrom: string
  dateTo: string
}

export function getFuelingReportPresetDateRange(
  preset: Exclude<FuelingReportPeriodPreset, 'custom'>,
  date = new Date(),
): FuelingReportDateRange {
  const dateTo = format(date, 'yyyy-MM-dd')

  if (preset === 'week') {
    return {
      dateFrom: format(subDays(date, 6), 'yyyy-MM-dd'),
      dateTo,
    }
  }

  if (preset === 'month') {
    return {
      dateFrom: format(subDays(date, 29), 'yyyy-MM-dd'),
      dateTo,
    }
  }

  return {
    dateFrom: dateTo,
    dateTo,
  }
}

export const fuelingReportFilterSchema = z
  .object({
    periodPreset: z.enum(FUELING_REPORT_PERIOD_PRESETS),
    dateFrom: z.string().min(1, 'Выберите дату начала'),
    dateTo: z.string().min(1, 'Выберите дату окончания'),
    stationId: z.union([
      z.literal('all'),
      z.string().regex(uuidLikePattern, 'Выберите АЗС'),
    ]),
  })
  .superRefine((value, context) => {
    if (value.dateFrom > value.dateTo) {
      context.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'Дата окончания не может быть раньше даты начала',
      })
    }
  })

export type FuelingReportFilterInput = z.input<typeof fuelingReportFilterSchema>
export type FuelingReportFilterValues = z.infer<typeof fuelingReportFilterSchema>
