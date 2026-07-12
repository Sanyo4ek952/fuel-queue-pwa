import { zodResolver } from '@hookform/resolvers/zod'
import { Check, MoreHorizontal, Power, UserCheck, UserX } from 'lucide-react'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'

import { useCurrentProfile } from '@/entities/profile'
import { ROLE_LABELS, type UserRole } from '@/shared/config/roles'
import { STATIONS } from '@/shared/config/stations'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/shared/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
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
  managedProfileSections,
  useApproveRegistration,
  useDeactivateProfile,
  useManagedProfiles,
  useRejectRegistration,
  type ManagedProfile,
  type ManagedProfilesSection,
} from '../model/use-managed-profiles'

const statusLabels = {
  pending: 'Ожидает',
  approved: 'Одобрен',
  rejected: 'Отклонен',
} as const

const sectionLabels: Record<ManagedProfilesSection, { title: string; description: string; metric: string }> = {
  pending: {
    title: 'Заявки на регистрацию',
    description: 'Проверьте сотрудника, назначьте роль и доступные АЗС.',
    metric: 'Заявки',
  },
  active: {
    title: 'Действующие сотрудники',
    description: 'Аккаунты с активным доступом к приложению.',
    metric: 'Действующие',
  },
  rejected: {
    title: 'Отклоненные',
    description: 'Заявки, которым отказали в доступе.',
    metric: 'Отклоненные',
  },
  disabled: {
    title: 'Отключенные',
    description: 'Сотрудники без текущего доступа к приложению.',
    metric: 'Отключенные',
  },
}

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

function getStationsLabel(profile: ManagedProfile) {
  return profile.stations.length > 0
    ? profile.stations.map((station) => station.name).join(', ')
    : 'АЗС не назначены'
}

function getHistoryLabel(profile: ManagedProfile) {
  const history = [
    profile.approved_at
      ? `Одобрил: ${profile.approved_by_name ?? '—'}, ${formatDateTime(profile.approved_at)}`
      : null,
    profile.rejected_at
      ? `Отклонил: ${profile.rejected_by_name ?? '—'}, ${formatDateTime(profile.rejected_at)}`
      : null,
    profile.deactivated_at
      ? `Отключил: ${profile.deactivated_by_name ?? '—'}, ${formatDateTime(profile.deactivated_at)}`
      : null,
  ].filter(Boolean)

  return history.length > 0 ? history.join(' · ') : `Создан: ${formatDateTime(profile.created_at)}`
}

function StatusBadges({ profile }: { profile: ManagedProfile }) {
  return (
    <div className="flex flex-wrap gap-1.5">
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
      {!profile.is_active ? <Badge variant="destructive">Отключен</Badge> : null}
    </div>
  )
}

function ProfileSummary({ profile }: { profile: ManagedProfile }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-slate-950">{profile.full_name}</div>
      <div className="mt-1 truncate text-xs text-slate-500">
        {profile.position ?? 'Должность не указана'}
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
    <div className="grid gap-2">
      {stationOptions.map((station) => {
        const checked = stationIds.includes(station.id)

        return (
          <label
            key={station.id}
            className="flex min-h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"
          >
            <input
              type="checkbox"
              className="size-4 shrink-0"
              checked={checked}
              onChange={(event) => {
                if (event.target.checked) {
                  setStationIds([...stationIds, station.id])
                  return
                }

                setStationIds(stationIds.filter((stationId) => stationId !== station.id))
              }}
            />
            <span className="min-w-0 truncate">{station.name}</span>
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
    <div className="w-full space-y-3">
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
          <FormItem>
            <FormLabel>Роль</FormLabel>
            <div className="flex min-h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm">
              {ROLE_LABELS[profile.role]}
            </div>
          </FormItem>

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

          <Button
            type="submit"
            className="w-full gap-2"
            disabled={approveMutation.isPending || (needsStations && stationOptions.length === 0)}
          >
            <Check className="size-4" aria-hidden="true" />
            Одобрить
          </Button>
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
            className="w-full gap-2"
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
        className="w-full space-y-3 rounded-md border border-slate-200 p-3"
        onSubmit={form.handleSubmit((values) => deactivateMutation.mutate(values))}
      >
        <FormItem>
          <FormLabel htmlFor={`deactivate-${profile.id}`}>Причина отключения</FormLabel>
          <Input id={`deactivate-${profile.id}`} {...form.register('reason')} />
          {form.formState.errors.reason ? (
            <FormMessage>{form.formState.errors.reason.message}</FormMessage>
          ) : null}
        </FormItem>
        <Button
          type="submit"
          variant="outline"
          className="w-full gap-2"
          disabled={deactivateMutation.isPending}
        >
          <Power className="size-4" aria-hidden="true" />
          Отключить
        </Button>
        {deactivateMutation.error ? (
          <p className="text-sm text-red-600">{deactivateMutation.error.message}</p>
        ) : null}
      </form>
    </Form>
  )
}

function ProfileActions({
  profile,
  section,
  stationOptions,
  compact = false,
}: {
  profile: ManagedProfile
  section: ManagedProfilesSection
  stationOptions: Array<{ id: string; name: string }>
  compact?: boolean
}) {
  if (section === 'pending') {
    return <PendingProfileActions profile={profile} stationOptions={stationOptions} />
  }

  if (section === 'active') {
    return <DeactivateProfileForm profile={profile} />
  }

  return (
    <span className={compact ? 'text-xs text-slate-500' : 'text-sm text-slate-500'}>
      {profile.rejection_reason ?? profile.deactivation_reason ?? 'Действий нет'}
    </span>
  )
}

function DesktopActions({
  profile,
  section,
  stationOptions,
}: {
  profile: ManagedProfile
  section: ManagedProfilesSection
  stationOptions: Array<{ id: string; name: string }>
}) {
  if (section !== 'pending' && section !== 'active') {
    return <ProfileActions profile={profile} section={section} stationOptions={stationOptions} compact />
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Действия: ${profile.full_name}`}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-2">
        <ProfileActions profile={profile} section={section} stationOptions={stationOptions} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProfileDetails({ profile }: { profile: ManagedProfile }) {
  return (
    <dl className="grid gap-2 text-xs text-slate-500">
      <div>
        <dt className="font-medium text-slate-700">История</dt>
        <dd>{getHistoryLabel(profile)}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-700">Должность и подпись</dt>
        <dd>
          {profile.position ?? 'Должность не указана'} · {profile.signature_name ?? 'Подпись не указана'}
        </dd>
      </div>
      <div>
        <dt className="font-medium text-slate-700">Заявка</dt>
        <dd>{profile.requested_station_name ?? 'АЗС не указана'}</dd>
      </div>
      {profile.rejection_reason || profile.deactivation_reason ? (
        <div>
          <dt className="font-medium text-slate-700">Причина</dt>
          <dd>{profile.rejection_reason ?? profile.deactivation_reason}</dd>
        </div>
      ) : null}
    </dl>
  )
}

function MobileProfileCard({
  profile,
  section,
  stationOptions,
}: {
  profile: ManagedProfile
  section: ManagedProfilesSection
  stationOptions: Array<{ id: string; name: string }>
}) {
  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm md:hidden">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-950">{profile.full_name}</div>
            <div className="mt-1 text-sm text-slate-600">{ROLE_LABELS[profile.role]}</div>
          </div>
          <StatusBadges profile={profile} />
        </div>
        <div className="text-sm text-slate-600">{getStationsLabel(profile)}</div>
        <Accordion type="single" collapsible>
          <AccordionItem value="details">
            <AccordionTrigger className="py-2 text-xs text-slate-600 hover:no-underline">
              История и данные
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <ProfileDetails profile={profile} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <div className="pt-1">
          <ProfileActions profile={profile} section={section} stationOptions={stationOptions} />
        </div>
      </CardContent>
    </Card>
  )
}

function ProfilesSection({
  title,
  description,
  section,
  profiles,
  totalCount,
  hasMore,
  isFetchingNextPage,
  onLoadMore,
  stationOptions,
}: {
  title: string
  description: string
  section: ManagedProfilesSection
  profiles: ManagedProfile[]
  totalCount: number
  hasMore: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  stationOptions: Array<{ id: string; name: string }>
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
      <CardContent className="space-y-3">
        {profiles.length === 0 ? (
          <p className="text-sm text-slate-500">Нет записей.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[24%]">Сотрудник</TableHead>
                    <TableHead className="w-[14%]">Статус</TableHead>
                    <TableHead className="w-[24%]">Роль и АЗС</TableHead>
                    <TableHead className="w-[26%]">История</TableHead>
                    <TableHead className="w-[12%] text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((profile) => (
                    <TableRow key={profile.id}>
                      <TableCell className="min-w-0">
                        <ProfileSummary profile={profile} />
                      </TableCell>
                      <TableCell>
                        <StatusBadges profile={profile} />
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="truncate">{ROLE_LABELS[profile.role]}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-slate-500">
                          {getStationsLabel(profile)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="line-clamp-2 text-xs text-slate-500">
                          {getHistoryLabel(profile)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DesktopActions
                          profile={profile}
                          section={section}
                          stationOptions={stationOptions}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 md:hidden" data-testid={`${section}-mobile-cards`}>
              {profiles.map((profile) => (
                <MobileProfileCard
                  key={profile.id}
                  profile={profile}
                  section={section}
                  stationOptions={stationOptions}
                />
              ))}
            </div>
          </>
        )}

        {hasMore ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {isFetchingNextPage ? 'Загрузка...' : `Показать ещё (${profiles.length} из ${totalCount})`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function getQueryItems(query: ReturnType<typeof useManagedProfiles>) {
  return query.data?.pages.flatMap((page) => page.items) ?? []
}

function getQueryTotal(query: ReturnType<typeof useManagedProfiles>) {
  return query.data?.pages[0]?.totalCount ?? 0
}

export function UsersManagementPanel() {
  const currentProfileQuery = useCurrentProfile()
  const pendingQuery = useManagedProfiles('pending')
  const activeQuery = useManagedProfiles('active')
  const rejectedQuery = useManagedProfiles('rejected')
  const disabledQuery = useManagedProfiles('disabled')
  const currentProfile = currentProfileQuery.data
  const stationOptions = useMemo(
    () => getStationOptions(currentProfile?.role, currentProfile?.stations),
    [currentProfile?.role, currentProfile?.stations],
  )
  const queries = {
    pending: pendingQuery,
    active: activeQuery,
    rejected: rejectedQuery,
    disabled: disabledQuery,
  }
  const isInitialLoading = managedProfileSections.some((section) => queries[section].isLoading)
  const failedQuery = managedProfileSections
    .map((section) => queries[section])
    .find((query) => query.isError)

  if (isInitialLoading) {
    return <p className="text-sm text-slate-500">Загрузка сотрудников...</p>
  }

  if (failedQuery?.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Не удалось загрузить сотрудников</AlertTitle>
        <AlertDescription>{failedQuery.error.message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {managedProfileSections.map((section) => (
          <Card key={section} className="rounded-lg border-slate-200 bg-white shadow-sm">
            <CardContent className="p-4">
              <div className="text-2xl font-semibold">{getQueryTotal(queries[section])}</div>
              <div className="text-sm text-slate-500">{sectionLabels[section].metric}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {managedProfileSections.map((section) => {
        const query = queries[section]
        const profiles = getQueryItems(query)

        return (
          <ProfilesSection
            key={section}
            title={sectionLabels[section].title}
            description={sectionLabels[section].description}
            section={section}
            profiles={profiles}
            totalCount={getQueryTotal(query)}
            hasMore={Boolean(query.hasNextPage)}
            isFetchingNextPage={query.isFetchingNextPage}
            onLoadMore={() => {
              void query.fetchNextPage()
            }}
            stationOptions={stationOptions}
          />
        )
      })}
    </div>
  )
}
