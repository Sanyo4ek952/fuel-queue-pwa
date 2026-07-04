import { addDays, format } from 'date-fns'

export function getTomorrowDateInputValue(date = new Date()) {
  return format(addDays(date, 1), 'yyyy-MM-dd')
}
