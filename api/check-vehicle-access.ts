import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

export default function handler(request: ProtectedRpcRequest, response: ProtectedRpcResponse) {
  return handleProtectedRpc(request, response, {
    rpcName: 'check_vehicle_access',
    fallbackError: 'Check vehicle access request failed.',
    mapBody: (body) => ({
      plate_number: body.plateNumber ?? null,
      station_id: body.stationId ?? null,
      check_date: body.checkDate ?? null,
    }),
  })
}
