import type { ChangeEvent, ComponentProps, FocusEvent } from 'react'

import {
  formatRuPhoneNumber,
  isValidRuPhoneNumber,
  normalizeRuPhoneNumber,
} from '@/shared/lib/phone-number'

import { Input } from './input'

type PhoneNumberInputProps = Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange' | 'onBlur' | 'autoComplete' | 'inputMode'
> & {
  value?: string
  onChange?: (value: string) => void
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
}

export function PhoneNumberInput({
  value = '',
  onChange,
  onBlur,
  ...props
}: PhoneNumberInputProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const formattedValue = formatRuPhoneNumber(event.target.value)

    onChange?.(formattedValue === '+7' ? '' : formattedValue)
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    const formattedValue = formatRuPhoneNumber(event.target.value)

    onChange?.(
      isValidRuPhoneNumber(event.target.value)
        ? normalizeRuPhoneNumber(event.target.value)
        : formattedValue === '+7'
          ? ''
          : formattedValue,
    )
    onBlur?.(event)
  }

  return (
    <Input
      autoComplete="tel"
      inputMode="tel"
      maxLength={17}
      placeholder="+7 999 123-45-67"
      value={formatRuPhoneNumber(value)}
      onChange={handleChange}
      onBlur={handleBlur}
      {...props}
    />
  )
}
