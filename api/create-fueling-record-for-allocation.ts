import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

export default function handler(request: ProtectedRpcRequest, response: ProtectedRpcResponse) {
  return handleProtectedRpc(request, response, {
    rpcName: 'create_fueling_record_for_allocation',
    fallbackError: 'Create fueling record request failed.',
    mapBody: (body) => ({
      allocation_id: body.allocationId ?? null,
      liters: body.liters ?? null,
      fueled_at: body.fueledAt ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  })
}
