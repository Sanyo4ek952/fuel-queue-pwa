import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

export default function handler(request: ProtectedRpcRequest, response: ProtectedRpcResponse) {
  return handleProtectedRpc(request, response, {
    rpcName: 'create_fueling_record_for_preferential_entry',
    fallbackError: 'Create preferential fueling record request failed.',
    mapBody: (body) => ({
      preferential_queue_entry_id: body.preferentialQueueEntryId ?? null,
      station_id: body.stationId ?? null,
      liters: body.liters ?? null,
      fueled_at: body.fueledAt ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  })
}
