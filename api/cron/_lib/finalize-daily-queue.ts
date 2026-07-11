export type FinalizeDailyQueueEnv = {
  supabaseUrl: string
  supabaseServiceRoleKey: string
}

export function getPreviousMoscowDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export async function finalizeDailyQueue({
  env,
  targetDate,
}: {
  env: FinalizeDailyQueueEnv
  targetDate: string
}) {
  const response = await fetch(`${env.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/finalize_daily_queue`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseServiceRoleKey,
      authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ target_date: targetDate }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      payload && typeof payload === 'object' && 'message' in payload
        ? String(payload.message)
        : `Daily queue finalization failed with ${response.status}.`,
    )
  }

  return payload
}
