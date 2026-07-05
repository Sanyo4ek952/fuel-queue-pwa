import { AlertTriangle, CheckCircle2, Cloud, CloudOff, RefreshCw } from 'lucide-react'

import { useRunOutboxSync, useSyncOutbox } from '@/features/sync-offline'
import type { SyncStatus } from '@/shared/constants'
import { useOnlineStatus } from '@/shared/lib/sync'
import type { SyncConflict, SyncOutboxOperation } from '@/shared/lib/offline-db'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'

const syncStatusLabels: Record<SyncStatus, string> = {
  SYNCED: 'Синхронизировано',
  PENDING: 'Ожидает',
  SYNCING: 'Отправляется',
  FAILED: 'Ошибка',
  CONFLICT: 'Конфликт',
}

const syncStatusVariants: Record<SyncStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  SYNCED: 'secondary',
  PENDING: 'outline',
  SYNCING: 'default',
  FAILED: 'destructive',
  CONFLICT: 'destructive',
}

function formatDateTime(value?: string) {
  if (!value) {
    return '—'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getPayloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null
}

function getPayloadValue(payload: unknown, key: string) {
  const record = getPayloadRecord(payload)
  const value = record?.[key]

  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function getPayloadSummary(operation: SyncOutboxOperation) {
  const plateNumber = getPayloadValue(operation.payload, 'plate_number')
  const targetDate = getPayloadValue(operation.payload, 'target_date')
  const stationId = getPayloadValue(operation.payload, 'station_id')
  const parts = [plateNumber, targetDate, stationId ? `АЗС ${stationId.slice(0, 8)}` : null].filter(
    Boolean,
  )

  return parts.length > 0 ? parts.join(' · ') : 'Данные операции'
}

function StatusBadge({ status }: { status: SyncStatus }) {
  return (
    <Badge variant={syncStatusVariants[status]} className="rounded-md">
      {syncStatusLabels[status]}
    </Badge>
  )
}

function SummaryTile({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'warning'
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className={tone === 'warning' ? 'text-xs text-red-600' : 'text-xs text-slate-500'}>
        {label}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
      Очередь синхронизации пуста.
    </div>
  )
}

function OperationsTable({ operations }: { operations: SyncOutboxOperation[] }) {
  if (operations.length === 0) {
    return <EmptyState />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Операция</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Создана</TableHead>
          <TableHead>Ошибка</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {operations.map((operation) => (
          <TableRow key={operation.id}>
            <TableCell className="min-w-52 whitespace-normal">
              <div className="font-medium text-slate-950">{operation.type}</div>
              <div className="mt-1 text-xs text-slate-500">{getPayloadSummary(operation)}</div>
            </TableCell>
            <TableCell>
              <StatusBadge status={operation.status} />
            </TableCell>
            <TableCell>{formatDateTime(operation.created_at)}</TableCell>
            <TableCell className="max-w-56 whitespace-normal text-xs text-slate-500">
              {operation.error ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ConflictItem({ conflict }: { conflict: SyncConflict }) {
  const plateNumber = getPayloadValue(conflict.payload, 'plate_number')
  const targetDate = getPayloadValue(conflict.payload, 'target_date')

  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" aria-hidden="true" />
      <AlertTitle>{conflict.reason}</AlertTitle>
      <AlertDescription>
        {plateNumber ? `Госномер: ${plateNumber}. ` : ''}
        {targetDate ? `Дата: ${targetDate}. ` : ''}
        Операция: {conflict.client_mutation_id}. Создано: {formatDateTime(conflict.created_at)}.
      </AlertDescription>
    </Alert>
  )
}

export function SyncOutboxPanel() {
  const isOnline = useOnlineStatus()
  const syncOutbox = useSyncOutbox()
  const runSyncMutation = useRunOutboxSync()
  const canRunSync = isOnline && (syncOutbox.summary.pending > 0 || syncOutbox.summary.failed > 0)
  const ConnectionIcon = isOnline ? Cloud : CloudOff

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Состояние синхронизации</CardTitle>
          <CardDescription>Offline-операции проверяются сервером после восстановления связи.</CardDescription>
          <CardAction>
            <Button
              type="button"
              disabled={!canRunSync || runSyncMutation.isPending}
              onClick={() => runSyncMutation.mutate()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              {runSyncMutation.isPending ? 'Синхронизация...' : 'Повторить'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1.5 rounded-md border-slate-200 bg-white">
              <ConnectionIcon className="size-3.5" aria-hidden="true" />
              {isOnline ? 'Онлайн' : 'Офлайн'}
            </Badge>
            {syncOutbox.summary.problemCount > 0 ? (
              <Badge variant="destructive" className="gap-1.5 rounded-md">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Требует внимания: {syncOutbox.summary.problemCount}
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1.5 rounded-md">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Ошибок нет
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <SummaryTile label="Ожидают" value={syncOutbox.summary.pending} />
            <SummaryTile label="Отправляются" value={syncOutbox.summary.syncing} />
            <SummaryTile label="Ошибки" value={syncOutbox.summary.failed} tone="warning" />
            <SummaryTile label="Конфликты" value={syncOutbox.summary.conflict} tone="warning" />
            <SummaryTile label="Всего" value={syncOutbox.summary.total} />
          </div>

          {syncOutbox.error ? (
            <Alert variant="destructive">
              <AlertTitle>Не удалось загрузить очередь</AlertTitle>
              <AlertDescription>{syncOutbox.error.message}</AlertDescription>
            </Alert>
          ) : null}

          {runSyncMutation.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Синхронизация не запущена</AlertTitle>
              <AlertDescription>
                {runSyncMutation.error instanceof Error
                  ? runSyncMutation.error.message
                  : 'Повторите попытку позже.'}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-lg border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Очередь операций</CardTitle>
          <CardDescription>
            {syncOutbox.isLoading ? 'Загрузка...' : 'Новые операции показаны первыми.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OperationsTable operations={syncOutbox.operations} />
        </CardContent>
      </Card>

      <Card className="rounded-lg border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Конфликты</CardTitle>
          <CardDescription>Конфликтные операции должен проверить старший смены или администратор.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {syncOutbox.conflicts.length > 0 ? (
            syncOutbox.conflicts.map((conflict) => (
              <ConflictItem key={conflict.id} conflict={conflict} />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
              Конфликтов нет.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
