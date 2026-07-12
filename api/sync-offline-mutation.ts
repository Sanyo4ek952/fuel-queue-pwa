import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

export default function handler(request: ProtectedRpcRequest, response: ProtectedRpcResponse) {
  return handleProtectedRpc(request, response, {
    rpcName: 'sync_offline_mutation',
    fallbackError: 'Sync offline mutation request failed.',
    mapBody: (body) => ({
      client_mutation_id: body.clientMutationId ?? null,
      operation_type: body.operationType ?? null,
      payload: body.payload ?? null,
    }),
  })
}
