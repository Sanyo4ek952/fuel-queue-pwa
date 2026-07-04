import type { ComponentProps } from 'react'
import { FormProvider } from 'react-hook-form'

import { cn } from '@/shared/lib/utils'

const Form = FormProvider

function FormItem({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('space-y-2', className)} {...props} />
}

function FormLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-slate-800', className)} {...props} />
}

function FormMessage({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-red-600', className)} {...props} />
}

export { Form, FormItem, FormLabel, FormMessage }
