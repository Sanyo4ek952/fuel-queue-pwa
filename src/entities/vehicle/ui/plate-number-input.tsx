import type { ChangeEvent, ComponentProps, FocusEvent } from 'react'

import { formatPlateNumber } from '@/shared/lib/plate-number'
import { Input } from '@/shared/ui/input'

type PlateNumberInputProps = Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange' | 'onBlur'
> & {
  value?: string
  onChange?: (value: string) => void
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
}

export function PlateNumberInput({
  value = '',
  onChange,
  onBlur,
  ...props
}: PlateNumberInputProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange?.(formatPlateNumber(event.target.value))
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    onChange?.(formatPlateNumber(event.target.value))
    onBlur?.(event)
  }

  return (
    <Input
      autoComplete="off"
      inputMode="text"
      maxLength={12}
      placeholder="А 123 ВС 777"
      value={formatPlateNumber(value)}
      onChange={handleChange}
      onBlur={handleBlur}
      {...props}
    />
  )
}
