export type RpcResult<TData> = {
  data: TData | null
  error: string | null
}

export * from './check-vehicle-access'
export * from './create-daily-limit'
export * from './create-reservation'
export * from './vehicle-access-cache'
