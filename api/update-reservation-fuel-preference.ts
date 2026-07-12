import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

export default function handler(request: ProtectedRpcRequest, response: ProtectedRpcResponse) {
  return handleProtectedRpc(request, response, {
    rpcName: 'update_reservation_fuel_preference',
    fallbackError: 'Update reservation fuel preference request failed.',
    mapBody: (body) => ({
      reservation_id: body.reservationId ?? null,
      fuel_type: body.fuelType ?? null,
      fuel_preference_mode: body.fuelPreferenceMode ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  })
}
