import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

export default function handler(request: ProtectedRpcRequest, response: ProtectedRpcResponse) {
  return handleProtectedRpc(request, response, {
    rpcName: 'get_vehicle_fueling_history',
    fallbackError: 'Vehicle fueling history request failed.',
    mapBody: (body) => ({
      plate_number: body.plateNumber ?? null,
      page_limit: body.pageLimit ?? null,
      page_offset: body.pageOffset ?? null,
    }),
  })
}
