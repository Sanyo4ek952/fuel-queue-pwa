import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Power, UserCheck, UserX } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'

import { useCurrentProfile } from '@/entities/profile'
import { ROLE_LABELS, type UserRole } from '@/shared/config/roles'
import { STATIONS } from '@/shared/config/stations'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'

import {
  approveRegistrationSchema,
  deactivateProfileSchema,
  rejectRegistrationSchema,
  type ApproveRegistrationValues,
  type DeactivateProfileValues,
  type RejectRegistrationValues,
} from '../model/schema'
import {
  useApproveRegistration,
  useDeactivateProfile,
  useManagedProfiles,
  useRejectRegistration,
  type ManagedProfile,
} from '../model/use-managed-profiles'

const statusLabels = {
  pending: 'Ожидает',
  approved: 'Одобрен',
  rejected: 'Отклонен',
} as const

function formatDateTime(value: string | null) {
  if (!value) {
    return '—'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getStationOptions(currentRole?: UserRole, currentStations: ManagedProfile['stations'] = []) {
  if (currentRole === 'mayor') {
    return STATIONS
  }

  return currentStations
}

function ProfileSummary({ profile }: { profile: ManagedProfile }) {
  return (
    <div className="min-w-48">
      <div className="font-medium text-slate-950">{profile.full_name}</div>
      <div className="mt-1 text-xs text-slate-500">
        {profile.position ?? 'Должность не указана'} · {profile.signature_name ?? 'Подпись не указана'}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Заявка: {profile.requested_station_name ?? 'АЗС не указана'}
      </div>
    </div>
  )
}

function StationCheckboxes({
  stationIds,
  setStationIds,
  stationOptions,
}: {
  stationIds: string[]
  setStationIds: (stationIds: string[]) => void
  stationOptions: Array<{ id: string; name: string }>
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {stationOptions.map((station) => {
        const checked = stationIds.includes(station.id)

        return (
          <label
            key={station.id}
            className="flex min-h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"
          >
            <input
              type="checkbox"
              className="size-4"
              checked={checked}
              onChange={(event) => {
                if (event.target.checked) {
                  setStationIds([...stationIds, station.id])
                  return
                }

                setStationIds(stationIds.filter((stationId) => stationId !== station.id))
              }}
            />
            <span>{station.name}</span>
          </label>
        )
      })}
    </div>
  )
}

function PendingProfileActions({
  profile,
  stationOptions,
}: {
  profile: ManagedProfile
  stationOptions: Array<{ id: string; name: string }>
}) {
  const approveMutation = useApproveRegistration()
  const rejectMutation = useRejectRegistration()
  const needsStations = profile.role === 'cashier'
  const defaultStationIds = needsStations && profile.requested_station_id
    ? [profile.requested_station_id]
    : needsStations && stationOptions[0]
      ? [stationOptions[0].id]
      : []
  const approveForm = useForm<ApproveRegistrationValues>({
    resolver: zodResolver(approveRegistrationSchema),
    defaultValues: {
      profileId: profile.id,
      role: profile.role === 'mayor_assistant' ? 'mayor_assistant' : 'cashier',
      stationIds: defaultStationIds,
    },
  })
  const rejectForm = useForm<RejectRegistrationValues>({
    resolver: zodResolver(rejectRegistrationSchema),
    defaultValues: {
      profileId: profile.id,
      reason: '',
    },
  })

  return (
    <div className="grid min-w-80 gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Form {...approveForm}>
        <form
          className="space-y-3 rounded-md border border-slate-200 p-3"
          onSubmit={approveForm.handleSubmit((values) =>
            approveMutation.mutate({
              ...values,
              stationIds: needsStations ? values.stationIds : [],
            }),
          )}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormItem>
              <FormLabel>Роль</FormLabel>
              <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm">
                {ROLE_LABELS[profile.role]}
              </div>
            </FormItem>
            <div className="flex items-end">
              <Button
                type="submit"
                className="h-10 w-full gap-2"
                disabled={approveMutation.isPending || (needsStations && stationOptions.length === 0)}
              >
                <Check className="size-4" aria-hidden="true" />
                Одобрить
              </Button>
            </div>
          </div>

          {needsStations ? (
            <FormItem>
              <FormLabel>Доступ к АЗС</FormLabel>
              <StationCheckboxes
                stationIds={approveForm.watch('stationIds')}
                setStationIds={(stationIds) =>
                  approveForm.setValue('stationIds', stationIds, { shouldValidate: true })
                }
                stationOptions={stationOptions}
              />
              {approveForm.formState.errors.stationIds ? (
                <FormMessage>{approveForm.formState.errors.stationIds.message}</FormMessage>
              ) : null}
            </FormItem>
          ) : null}

          {approveMutation.error ? (
            <p className="text-sm text-red-600">{approveMutation.error.message}</p>
          ) : null}
        </form>
      </Form>

      <Form {...rejectForm}>
        <form
          className="space-y-3 rounded-md border border-slate-200 p-3"
          onSubmit={rejectForm.handleSubmit((values) => rejectMutation.mutate(values))}
        >
          <FormItem>
            <FormLabel htmlFor={`reject-${profile.id}`}>Причина отклонения</FormLabel>
            <Input id={`reject-${profile.id}`} {...rejectForm.register('reason')} />
            {rejectForm.formState.errors.reason ? (
              <FormMessage>{rejectForm.formState.errors.reason.message}</FormMessage>
            ) : null}
          </FormItem>
          <Button
            type="submit"
            variant="outline"
            className="h-10 w-full gap-2"
            disabled={rejectMutation.isPending}
          >
            <UserX className="size-4" aria-hidden="true" />
            Отклонить
          </Button>
          {rejectMutation.error ? (
            <p className="text-sm text-red-600">{rejectMutation.error.message}</p>
          ) : null}
        </form>
      </Form>
    </div>
  )
}

function DeactivateProfileForm({ profile }: { profile: ManagedProfile }) {
  const deactivateMutation = useDeactivateProfile()
  const form = useForm<DeactivateProfileValues>({
    resolver: zodResolver(deactivateProfileSchema),
    defaultValues: {
      profileId: profile.id,
      reason: '',
    },
  })

  return (
    <Form {...form}>
      <form
        className="flex min-w-72 gap-2"
        onSubmit={form.handleSubmit((values) => deactivateMutation.mutate(values))}
      >
        <div className="min-w-0 flex-1">
          <Input placeholder="Причина отключения" {...form.register('reason')} />
          {form.formState.errors.reason ? (
            <FormMessage>{form.formState.errors.reason.message}</FormMessage>
          ) : null}
          {deactivateMutation.error ? (
            <p className="mt-1 text-sm text-red-600">{deactivateMutation.error.message}</p>
          ) : null}
        </div>
        <Button
          type="submit"
          variant="outline"
          className="h-10 gap-2"
          disabled={deactivateMutation.isPending}
        >
          <Power className="size-4" aria-hidden="true" />
          Отключить
        </Button>
      </form>
    </Form>
  )
}

function ProfilesTable({
  title,
  description,
  profiles,
  children,
}: {
  title: string
  description: string
  profiles: ManagedProfile[]
  children: (profile: ManagedProfile) => ReactNode
}) {
  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="size-5 text-slate-500" aria-hidden="true" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {profiles.length === 0 ? (
          <p className="text-sm text-slate-500">Нет записей.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Сотрудник</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Роль и АЗС</TableHead>
                <TableHead>История</TableHead>
                <TableHead>Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => (
                <TableRow key={profile.id}>
                  <TableCell>
                    <ProfileSummary profile={profile} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        profile.approval_status === 'rejected'
                          ? 'destructive'
                          : profile.approval_status === 'pending'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {statusLabels[profile.approval_status]}
                    </Badge>
                    {!profile.is_active ? (
                      <div className="mt-2">
                        <Badge variant="destructive">Отключен</Badge>
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div>{ROLE_LABELS[profile.role]}</div>
                    <div className="mt-1 max-w-56 whitespace-normal text-xs text-slate-500">
                      {profile.stations.length > 0
                        ? profile.stations.map((station) => station.name).join(', ')
                        : 'АЗС не назначены'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-64 whitespace-normal text-xs text-slate-500">
                      {profile.approved_at
                        ? `Одобрил: ${profile.approved_by_name ?? '—'}, ${formatDateTime(profile.approved_at)}`
                        : null}
                      {profile.rejected_at
                        ? `Отклонил: ${profile.rejected_by_name ?? '—'}, ${formatDateTime(profile.rejected_at)}`
                        : null}
                      {profile.deactivated_at
                        ? `Отключил: ${profile.deactivated_by_name ?? '—'}, ${formatDateTime(profile.deactivated_at)}`
                        : null}
                      {!profile.approved_at && !profile.rejected_at && !profile.deactivated_at
                        ? `Создан: ${formatDateTime(profile.created_at)}`
                        : null}
                    </div>
                  </TableCell>
                  <TableCell>{children(profile)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function UsersManagementPanel() {
  const currentProfileQuery = useCurrentProfile()
  const managedProfilesQuery = useManagedProfiles()
  const currentProfile = currentProfileQuery.data
  const stationOptions = useMemo(
    () => getStationOptions(currentProfile?.role, currentProfile?.stations),
    [currentProfile?.role, currentProfile?.stations],
  )
  const profiles = managedProfilesQuery.data ?? []
  const pendingProfiles = profiles.filter((profile) => profile.approval_status === 'pending')
  const activeProfiles = profiles.filter(
    (profile) => profile.approval_status === 'approved' && profile.is_active,
  )
  const inactiveProfiles = profiles.filter(
    (profile) => profile.approval_status === 'rejected' || !profile.is_active,
  )

  if (managedProfilesQuery.isLoading) {
    return <p className="text-sm text-slate-500">Загрузка сотрудников...</p>
  }

  if (managedProfilesQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Не удалось загрузить сотрудников</AlertTitle>
        <AlertDescription>{managedProfilesQuery.error.message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4">
            <div className="text-2xl font-semibold">{pendingProfiles.length}</div>
            <div className="text-sm text-slate-500">Заявки</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4">
            <div className="text-2xl font-semibold">{activeProfiles.length}</div>
            <div className="text-sm text-slate-500">Действующие</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4">
            <div className="text-2xl font-semibold">{inactiveProfiles.length}</div>
            <div className="text-sm text-slate-500">Отклоненные/отключенные</div>
          </CardContent>
        </Card>
      </div>

      <ProfilesTable
        title="Заявки на регистрацию"
        description="Проверьте сотрудника, назначьте роль и доступные АЗС."
        profiles={pendingProfiles}
      >
        {(profile) => (
          <PendingProfileActions
            profile={profile}
            stationOptions={stationOptions}
          />
        )}
      </ProfilesTable>

      <ProfilesTable
        title="Действующие сотрудники"
        description="Аккаунты с активным доступом к приложению."
        profiles={activeProfiles}
      >
        {(profile) => <DeactivateProfileForm profile={profile} />}
      </ProfilesTable>

      <ProfilesTable
        title="Отклоненные и отключенные"
        description="История заявок и сотрудников без текущего доступа."
        profiles={inactiveProfiles}
      >
        {(profile) => (
          <span className="text-sm text-slate-500">
            {profile.rejection_reason ?? profile.deactivation_reason ?? 'Действий нет'}
          </span>
        )}
      </ProfilesTable>
    </div>
  )
}
