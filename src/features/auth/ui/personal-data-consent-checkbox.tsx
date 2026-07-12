import { Link } from 'react-router-dom'

import { ROUTES } from '@/shared/config/routes'
import { FormItem, FormMessage } from '@/shared/ui/form'

type PersonalDataConsentCheckboxProps = {
  id: string
  checked: boolean
  error?: string
  onChange: (checked: boolean) => void
}

export function PersonalDataConsentCheckbox({
  checked,
  error,
  id,
  onChange,
}: PersonalDataConsentCheckboxProps) {
  return (
    <FormItem>
      <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-5 text-slate-700">
        <input
          id={id}
          type="checkbox"
          className="mt-1 size-4 rounded border-slate-300 text-slate-950"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          Я согласен на обработку персональных данных для регистрации, ведения очереди на
          топливо, проверки допуска к заправке и связи по заявке.{' '}
          <Link
            to={ROUTES.personalData}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-950 underline underline-offset-4"
          >
            Открыть текст согласия
          </Link>
          .
        </span>
      </label>
      {error ? <FormMessage>{error}</FormMessage> : null}
    </FormItem>
  )
}

