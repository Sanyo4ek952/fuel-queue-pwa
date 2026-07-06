export type RpcResult<TData> = {
  data: TData | null
  error: string | null
}

export * from './check-vehicle-access'
export * from './create-daily-limit'
export * from './create-fueling-record'
export * from './create-manual-override'
export * from './create-personal-vehicle-liter-limit'
export * from './create-reservation'
export * from './get-daily-limit-overview'
export * from './get-vehicle-fueling-history'
export * from './refuel-cooldown'
export * from './sync-offline-mutation'
export * from './vehicle-access-cache'
