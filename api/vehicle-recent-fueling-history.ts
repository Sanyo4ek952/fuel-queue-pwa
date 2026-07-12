import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

export default function handler(request: ProtectedRpcRequest, response: ProtectedRpcResponse) {
  return handleProtectedRpc(request, response, {
    rpcName: 'get_vehicle_recent_fueling_history',
    fallbackError: 'Vehicle recent fueling history request failed.',
    mapBody: (body) => ({
      plate_number: body.plateNumber ?? null,
    }),
  })
}
