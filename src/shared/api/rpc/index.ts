export type RpcResult<TData> = {
  data: TData | null
  error: string | null
}

export * from './check-vehicle-access'
export * from './check-public-queue'
export * from './cancel-preferential-queue-entry'
export * from './create-daily-limit'
export * from './create-fueling-record'
export * from './create-manual-override'
export * from './create-personal-vehicle-liter-limit'
export * from './create-preferential-queue'
export * from './create-preferential-queue-entry'
export * from './create-reservation'
export * from './create-reservation-call-log'
export * from './get-daily-limit-overview'
export * from './get-fueling-report'
export * from './get-vehicle-fueling-history'
export * from './refuel-cooldown'
export * from './sync-offline-mutation'
export * from './update-reservation-fuel-preference'
export * from './vehicle-access-cache'
