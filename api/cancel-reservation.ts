import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

export default function handler(request: ProtectedRpcRequest, response: ProtectedRpcResponse) {
  return handleProtectedRpc(request, response, {
    rpcName: 'cancel_reservation',
    fallbackError: 'Cancel reservation request failed.',
    mapBody: (body) => ({
      reservation_id: body.reservationId ?? null,
      reason: body.reason ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  })
}
