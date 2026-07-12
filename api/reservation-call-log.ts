import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

export default function handler(request: ProtectedRpcRequest, response: ProtectedRpcResponse) {
  return handleProtectedRpc(request, response, {
    rpcName: 'create_reservation_call_log',
    fallbackError: 'Create reservation call log request failed.',
    mapBody: (body) => ({
      reservation_id: body.allocationId ?? body.reservationId ?? null,
      status: body.status ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  })
}
